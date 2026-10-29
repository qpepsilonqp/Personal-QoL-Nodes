import asyncio, json, os
from common import *
B = "/root/old_comfy/models/loras"
S = "() => window._n.spll.state"
SOFT = "b1:styles/anime/anime_soft.safetensors"; OIL = "b1:styles/painterly/oil_v2.safetensors"; GOU = "b1:styles/painterly/gouache_dreamy.safetensors"; WAT = "b1:styles/painterly/watercolor.safetensors"
def row(p, where="tree"): return f".spll-lora[data-where={where}][data-path='{p}']"
async def tcls(pg, p): return (await pg.locator(row(p)+" .spll-trig").get_attribute("class")).split("is-")[-1]
async def main():
    logs=[]
    async with async_playwright() as p:
        b = await p.chromium.launch()
        ctx = await b.new_context(viewport={"width":1500,"height":1100}, permissions=["clipboard-read","clipboard-write"])
        pg = await ctx.new_page()
        pg.on("console", lambda m: logs.append(f"{m.type}: {m.text}")); pg.on("pageerror", lambda e: logs.append(f"PAGEERROR: {e}"))
        await pg.goto("http://127.0.0.1:8188/"); await pg.wait_for_function("window.comfyAPI && window.comfyAPI.app && window.comfyAPI.app.app.graph", timeout=60000)
        await pg.wait_for_timeout(2500); await pg.keyboard.press("Escape")
        await pg.evaluate(SETUP); await pg.wait_for_timeout(1500)
        await choose_root(pg)
        g = lambda n: f".spll-group:has(.spll-gname:text-is('{n}'))"
        for n in ["styles","anime","painterly"]:
            await pg.click(g(n)+" .spll-caret"); await pg.wait_for_timeout(150)
        # blocked Civitai: grey stays grey, nothing saved, no dialog
        open("mockciv/OFFLINE","w").close()
        await pg.click(row(GOU)+" .spll-trig"); await pg.wait_for_timeout(1500)
        print("A offline: T state", await tcls(pg, GOU), "| dialog:", await pg.locator("[role=dialog]:not(.spll-modal)").count(), "| info file:", os.path.exists(B+"/"+GOU[3:]+".rgthree-info.json"))
        print("  toast:", [t for t in await pg.locator("text=Couldn't reach Civitai").all_inner_texts()][:1])
        await pg.click(row(GOU)+" .spll-info"); await pg.wait_for_timeout(2000)
        print("  panel status:", (await pg.locator(".spll-modal-status").inner_text())[:90], "| save btn:", await pg.locator("[data-pact=save-info]").count())
        await pg.keyboard.press("Escape"); await pg.wait_for_timeout(200)
        os.remove("mockciv/OFFLINE")
        # oil: found but no triggers -> red -> mark no-trigger
        await pg.click(row(OIL)+" .spll-trig"); await confirm(pg, True); await pg.wait_for_timeout(500)
        print("B oil:", await tcls(pg, OIL))
        await pg.click(row(OIL)+" .spll-trig"); await pg.wait_for_timeout(300)
        await pg.screenshot(path=OUT+"43_notrig_box.png")
        await pg.click(".spll-pop [data-act=trig-notrig]")
        await confirm(pg, True); await pg.wait_for_timeout(500)
        print("  after No trigger words:", await tcls(pg, OIL), "| sidecar:", open(B+"/"+OIL[3:]+".spll.json").read().replace("\n","").replace(" ",""))
        # anime_soft ready: chip picker
        await pg.click(row(SOFT)+" .spll-trig"); await confirm(pg, True); await pg.wait_for_timeout(500)
        await pg.click(row(SOFT)+" .spll-trig"); await pg.wait_for_timeout(300)
        print("C chips:", await pg.locator(".spll-pop .spll-chip").all_inner_texts(), "| button:", await pg.locator("[data-act=trig-copy]").inner_text())
        await pg.click(".spll-pop .spll-chip:text-is('soft lighting')"); await pg.wait_for_timeout(150)
        print("  after select:", await pg.locator("[data-act=trig-copy]").inner_text())
        await pg.screenshot(path=OUT+"44_trig_chips.png")
        await pg.click("[data-act=trig-copy]"); await pg.wait_for_timeout(300)
        print("  clipboard:", await pg.evaluate("navigator.clipboard.readText()"))
        await pg.click(row(SOFT)+" .spll-trig"); await pg.wait_for_timeout(300)
        await pg.click("[data-act=trig-copy]"); await pg.wait_for_timeout(300)
        print("  copy all:", await pg.evaluate("navigator.clipboard.readText()"))
        # info window chips
        await pg.click(row(SOFT)+" .spll-info"); await pg.wait_for_timeout(800)
        print("D panel button:", await pg.locator("[data-pact=copy-sel]").inner_text())
        await pg.click(".spll-modal .spll-chip.is-meta:has-text('1girl')"); await pg.click(".spll-modal .spll-chip.is-civitai:text-is('anime style')"); await pg.wait_for_timeout(200)
        print("  after 2 selected:", await pg.locator("[data-pact=copy-sel]").inner_text())
        await pg.click("[data-pact=copy-sel]"); await pg.wait_for_timeout(300)
        print("  copied (listed order):", await pg.evaluate("navigator.clipboard.readText()"))
        await pg.screenshot(path=OUT+"45_panel_select.png")
        await pg.keyboard.press("Escape"); await pg.wait_for_timeout(200)
        # unchecked state (rgthree file with no civitai data)
        await pg.click(g("characters")+" .spll-caret"); await pg.wait_for_timeout(200)
        print("E villain_b:", await tcls(pg, "b1:characters/villain_b.safetensors"))
        # watercolor: not on civitai -> red; No Trigger All
        await pg.click(row(WAT)+" .spll-trig"); await confirm(pg, True); await pg.wait_for_timeout(500)
        print("F watercolor:", await tcls(pg, WAT))
        await pg.evaluate("() => window._n.spll.settingsTab = 'info'"); await pg.click(".spll-gear >> visible=true"); await pg.click("[data-act=no-trigger-all]")
        txt,_ = await confirm(pg, True); await pg.wait_for_timeout(600)
        print("  no-trigger-all dialog:", txt.split("\n")[1][:80], "| watercolor now:", await tcls(pg, WAT))
        # unlist a LoRA and a group, then relist
        await pg.click(row(SOFT)+" .spll-name", button="right"); await pg.click(".spll-menu-item:text-is('Unlist')"); await pg.wait_for_timeout(300)
        print("G unlisted soft hidden:", await pg.locator(row(SOFT)).count() == 0)
        await pg.fill(".spll-search", "soft"); await pg.wait_for_timeout(200)
        print("  search hides it:", await pg.locator(f".spll-dropdown [data-path='{SOFT}']").count() == 0)
        await pg.click(".spll-search-clear")
        await pg.click(g("video")+" [data-act=gmenu]"); await pg.click(".spll-menu-item:text-is('Unlist group')"); await pg.wait_for_timeout(300)
        print("  video group hidden:", await pg.locator(g("video")).count() == 0)
        await pg.evaluate("() => window._n.spll.settingsTab = 'lists'"); await pg.click(".spll-gear >> visible=true"); await pg.wait_for_timeout(200)
        print("  unlisted sheet:", [t.replace("\n"," ") for t in await pg.locator(".spll-unlisted-item").all_inner_texts()])
        await pg.screenshot(path=OUT+"46_unlisted.png")
        await pg.click(".spll-unlisted-item:has-text('video') [data-act=relist]"); await pg.click(".spll-unlisted-item:has-text('anime_soft') [data-act=relist]"); await pg.wait_for_timeout(200)
        await pg.click(".spll-sheet [data-act=close]"); await pg.wait_for_timeout(300)
        print("  relisted:", await pg.locator(g("video")).count() == 1, await pg.locator(row(SOFT)).count() == 1)
        print("ERRORS", errs(logs)[:6])
        await b.close()
asyncio.run(main())
