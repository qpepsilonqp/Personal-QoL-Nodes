import asyncio, json
from common import *
S = "() => window._n.spll.state"
NEW = "/root/work/ComfyUI/models/loras"
async def tipof(pg, sel):
    await pg.mouse.move(5,5); await pg.wait_for_timeout(100); await pg.hover(sel); await pg.wait_for_timeout(600)
    return (await pg.locator(".spll-tip").inner_text()).replace("\n"," | ")
async def main():
    logs=[]
    async with async_playwright() as p:
        b, pg = await open_page(p, logs)
        await pg.evaluate(SETUP); await pg.wait_for_timeout(1500)
        await pg.screenshot(path=OUT+"60_setup.png")
        # tick two LoRAs from the old install and one from the new install
        await pg.click(f".spll-expander[data-key='{OLD}|']"); await pg.click(f".spll-expander[data-key='{OLD}|styles']"); await pg.click(f".spll-expander[data-key='{OLD}|styles/anime']")
        await pg.click(f".spll-picker-check[data-sel='lora|{OLD}|styles/anime/anime_soft.safetensors']")
        await pg.click(f".spll-picker-check[data-sel='lora|{OLD}|detail_v2.safetensors']")
        await pg.click(f".spll-expander[data-key='{NEW}|']")
        await pg.click(f".spll-picker-check[data-sel='lora|{NEW}|mystery_lora.safetensors']")
        print("A add button:", await pg.locator(".spll-picker [data-act=picker-use]").inner_text())
        await pg.screenshot(path=OUT+"61_setup_ticked.png")
        await pg.click(".spll-picker [data-act=picker-use]"); await pg.wait_for_timeout(1500)
        st = await pg.evaluate(S)
        print("  bases:", st["bases"], "| sources:", st["sources"])
        print("  titles:", await pg.locator(".spll-section-title > span:first-child").all_inner_texts(), "| dis search visible:", await pg.locator(".spll-dis-search").is_visible(), "| footer:", await pg.locator(".spll-strip").is_visible())
        print("  disabled list:", await pg.locator(".spll-tree .spll-lora .spll-name").all_inner_texts())
        print("B rescan tooltip:", await tipof(pg, ".spll-strip .spll-rescan"))
        print("  search files tooltip:", await tipof(pg, ".spll-fs-btn"))
        await pg.screenshot(path=OUT+"62_disabled_mode.png")
        # enable two (one from each loras folder), then run
        await pg.click(".spll-tree .spll-lora:has(.spll-name:text-is('anime_soft')) .spll-switch"); await pg.wait_for_timeout(200)
        await pg.click(".spll-tree .spll-lora:has(.spll-name:text-is('mystery_lora')) .spll-switch"); await pg.wait_for_timeout(200)
        print("C disabled list now:", await pg.locator(".spll-tree .spll-lora .spll-name").all_inner_texts(), "| title:", (await pg.locator(".spll-section-title > span:first-child").all_inner_texts()))
        open("/tmp/spll_calls.jsonl","w").close()
        await pg.evaluate("() => window.comfyAPI.app.app.queuePrompt(0)"); await pg.wait_for_timeout(3500)
        print("  run:", [json.loads(l).get("keys", json.loads(l).get("final")) for l in open("/tmp/spll_calls.jsonl").read().splitlines()])
        # footer Search Files: add a folder
        await pg.click(".spll-fs-btn"); await pg.wait_for_timeout(300)
        await pg.keyboard.type("cyber"); await pg.wait_for_timeout(1200)
        print("D results:", [r.replace("\n"," | ") for r in await pg.locator(".spll-fs-results .spll-fs-row").all_inner_texts()][:4])
        await pg.screenshot(path=OUT+"63_search_files.png")
        await pg.click(".spll-fs-results .spll-fs-row.is-folder [data-fs=add]"); await pg.wait_for_timeout(1500)
        print("  after add: titles", await pg.locator(".spll-section-title > span:first-child").all_inner_texts(), "| groups:", await pg.locator(".spll-group .spll-gname").all_inner_texts(), "| dis search:", await pg.locator(".spll-dis-search").is_visible())
        print("  results now say:", await pg.locator(".spll-fs-results .spll-fs-row.is-folder .spll-fs-added").all_inner_texts())
        await pg.keyboard.press("Escape"); await pg.wait_for_timeout(200)
        print("  footer closed:", not await pg.locator(".spll-strip.is-open").count(), "| results gone:", await pg.locator(".spll-fs-results").count() == 0)
        print("  rescan enabled now:", await pg.locator(".spll-strip .spll-rescan.is-disabled").count() == 0)
        await pg.screenshot(path=OUT+"64_groups_mode.png")
        # delete the only group -> DISABLED again
        await pg.click(".spll-group:has(.spll-gname:text-is('cyberpunk')) [data-act=gmenu]"); await pg.click(".spll-menu-item:has-text('Delete group')")
        await confirm(pg, True); await pg.wait_for_timeout(500)
        print("E after deleting group:", await pg.locator(".spll-section-title > span:first-child").all_inner_texts(), "| list:", await pg.locator(".spll-tree .spll-lora .spll-name").all_inner_texts())
        # DISABLED search box adds a LoRA
        await pg.click(".spll-dis-input"); await pg.keyboard.type("hero"); await pg.wait_for_timeout(1200)
        await pg.click(".spll-fs-results .spll-fs-row [data-fs=add]"); await pg.wait_for_timeout(1200)
        print("F after dis add:", await pg.locator(".spll-tree .spll-lora .spll-name").all_inner_texts())
        await pg.keyboard.press("Escape")
        # remove a LoRA added on its own
        await pg.click(".spll-tree .spll-lora:has(.spll-name:text-is('hero_a')) .spll-name", button="right")
        await pg.click(".spll-menu-item:text-is('Remove from node')"); await pg.wait_for_timeout(400)
        print("G removed hero:", "b1:characters/hero_a.safetensors" not in (await pg.evaluate(S))["sources"]["loras"], await pg.locator(".spll-tree .spll-lora .spll-name").all_inner_texts())
        # settings sources + remove folder
        await pg.click(".spll-strip .spll-gear"); await pg.wait_for_timeout(300)
        print("H settings sources:", [r.replace("\n"," ") for r in await pg.locator(".spll-source-row").all_inner_texts()])
        await pg.screenshot(path=OUT+"65_settings_sources.png")
        await pg.click(".spll-source-row [data-act=remove-folder]")
        txt,_ = await confirm(pg, True); await pg.wait_for_timeout(800)
        st = await pg.evaluate(S)
        print("  removed folder:", txt.split("\n")[0], "| sources:", st["sources"])
        print("ERRORS", errs(logs)[:6])
        await b.close()
asyncio.run(main())
