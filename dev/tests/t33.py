import asyncio, json, os, hashlib, shutil
from common import *
B = "/root/old_comfy/models/loras"
S = "() => window._n.spll.state"
def row(p, where="tree"): return f".spll-lora[data-where={where}][data-path='{p if p.startswith("b1:") else "b1:"+p}']"
DLH = hashlib.sha256(open("mockciv/dl888.safetensors","rb").read()).hexdigest()
async def fresh_node(pg):
    await pg.evaluate(SETUP); await pg.wait_for_timeout(1500)
async def main():
    logs=[]
    async with async_playwright() as p:
        b = await p.chromium.launch()
        ctx = await b.new_context(viewport={"width":1500,"height":1100}, accept_downloads=True)
        pg = await ctx.new_page()
        pg.on("console", lambda m: logs.append(f"{m.type}: {m.text}")); pg.on("pageerror", lambda e: logs.append(f"PAGEERROR: {e}"))
        await pg.goto("http://127.0.0.1:8188/"); await pg.wait_for_function("window.comfyAPI && window.comfyAPI.app && window.comfyAPI.app.app.graph", timeout=60000)
        await pg.wait_for_timeout(2500); await pg.keyboard.press("Escape")
        g = lambda n: f".spll-group:has(.spll-gname:text-is('{n}'))"
        await fresh_node(pg); await choose_root(pg)
        # --- bulk fetch on a group
        await pg.click(g("styles")+" .spll-caret"); await pg.wait_for_timeout(200)
        await pg.click(g("painterly")+" [data-act=gmenu]"); await pg.click(".spll-menu-item:has-text('Fetch info for all')")
        txt,_ = await confirm(pg, True)
        print("A bulk dialog:", txt.split("\n")[0])
        await pg.wait_for_timeout(700)
        await pg.screenshot(path=OUT+"47_bulk.png")
        print("  progress line:", await pg.locator(".spll-bulk-text").inner_text())
        await pg.wait_for_timeout(4500)
        files = sorted(f for f in os.listdir(B+"/styles/painterly") if f.endswith("rgthree-info.json"))
        print("  info files:", files, "| bulk line gone:", await pg.locator(".spll-bulk").is_hidden())
        # --- favourites + a nickname, then export
        await pg.click(g("anime")+" .spll-caret"); await pg.wait_for_timeout(200)
        await pg.click(row("styles/anime/anime_bold.safetensors")+" .spll-star"); await pg.wait_for_timeout(150); await pg.keyboard.press("Escape")
        await pg.click(row("styles/anime/anime_bold.safetensors")+" .spll-switch"); await pg.click(row("styles/anime/anime_bold.safetensors","active")+" .spll-switch")
        await pg.click(row("styles/anime/anime_soft.safetensors")+" .spll-name", button="right"); await pg.click(".spll-menu-item:text-is('Edit nickname…')")
        await pg.keyboard.type("Exported Nick"); await pg.keyboard.press("Enter"); await confirm(pg, True); await pg.wait_for_timeout(400)
        await pg.click(g("characters")+" [data-act=gmenu]"); await pg.click(".spll-menu-item:text-is('Colour…')"); await pg.click(".spll-swatch-btn >> nth=2"); await pg.click(".spll-pop [data-act=close]")
        await pg.evaluate("() => window._n.spll.settingsTab = 'file'"); await pg.click(".spll-gear >> visible=true")
        async with pg.expect_download() as dl:
            await pg.click("[data-act=export-layout]")
        d = await dl.value; path = await d.path(); data = json.load(open(path))
        print("B exported:", d.suggested_filename, "| keys:", sorted(data.keys())[:6], "... favs", data["favourites"], "| hist", data["history"], "| nick", data["nicknames"])
        os.remove(B+"/styles/anime/anime_soft.safetensors.spll.json")  # so import has a nickname to offer
        # --- new node: different favourites, then import
        await fresh_node(pg); await choose_root(pg)
        await pg.click(g("characters")+" .spll-caret"); await pg.wait_for_timeout(200)
        await pg.click(row("characters/hero_a.safetensors")+" .spll-star"); await pg.wait_for_timeout(150); await pg.keyboard.press("Escape"); await pg.wait_for_timeout(200)
        await pg.evaluate("() => window._n.spll.settingsTab = 'file'"); await pg.click(".spll-gear >> visible=true")
        async with pg.expect_file_chooser() as fc:
            await pg.click("[data-act=import-layout]")
        await (await fc.value).set_files(path)
        txt,_ = await confirm(pg, True); await pg.wait_for_timeout(1500)
        print("C import dialog:", txt.split("\n")[0], "| in-node question:", (await pg.locator(".spll-sheet-center .spll-big").inner_text())[:70])
        await pg.screenshot(path=OUT+"48_import_question.png")
        await pg.click("[data-act=import-favhist][data-answer=yes]")
        txt,_ = await confirm(pg, True); await pg.wait_for_timeout(800)
        st = await pg.evaluate(S)
        print("  nickname dialog:", txt.split("\n")[0], "| favs now:", st["favourites"], "| hist:", st["history"])
        cg = [x for x in st["groups"] if x["name"]=="characters"][0]
        print("  colour came across:", cg["color"], "| nickname shown:", await pg.locator(".spll-name:has-text('Exported Nick')").count() >= 0, os.path.exists(B+"/styles/anime/anime_soft.safetensors.spll.json"))
        # --- download a missing LoRA
        STATE = {"v":1,"base":B,"root":"styles","settings":{"dropdownRows":8,"listHeight":12},"groups":[],"knownFolders":[],"placements":{},
                 "active":[{"path":"styles/anime/deleted_one.safetensors","strength":1.0}],"strengths":{},
                 "ids":{"styles/anime/deleted_one.safetensors":{"h":DLH,"m":404,"v":888,"z":160}}}
        wf = await pg.evaluate("() => window.comfyAPI.app.app.graph.serialize()")
        for n in wf["nodes"]:
            if n["type"]=="SuperPowerLoraLoader": n["widgets_values"]=[STATE]; n.pop("widgets_values_named", None)
        await pg.evaluate("(wf) => window.comfyAPI.app.app.loadGraphData(wf)", wf); await pg.wait_for_timeout(2000)
        await pg.evaluate("() => { window._n = window.comfyAPI.app.app.graph.nodes.find(n=>n.comfyClass==='SuperPowerLoraLoader') }")
        await pg.click(g("anime")+" .spll-caret"); await pg.wait_for_timeout(200)
        await pg.click(row("styles/anime/deleted_one.safetensors")+" .spll-info"); await pg.wait_for_timeout(1500)
        await pg.screenshot(path=OUT+"49_download_panel.png")
        await pg.click("[data-pact=download]")
        txt,_ = await confirm(pg, True); await pg.wait_for_timeout(2500)
        print("D download dialog:", txt.split("\n")[0], "| file:", os.path.exists(B+"/styles/anime/deleted_one.safetensors"), "| still missing:", await pg.evaluate("() => window._n.spll.missing.has('styles/anime/deleted_one.safetensors')"))
        # --- rename detection: active LoRA with known hash + size, renamed on disk
        await pg.click(row("styles/anime/deleted_one.safetensors")+" .spll-switch"); await pg.wait_for_timeout(200)
        ids = (await pg.evaluate(S))["ids"]
        print("E ids for active:", ids)
        shutil.move(B+"/styles/anime/deleted_one.safetensors", B+"/styles/painterly/renamed_one.safetensors")
        await pg.click("[data-act=rescan] >> visible=true"); await pg.wait_for_timeout(2500)
        st = await pg.evaluate(S)
        print("  after rename: active", st["active"], "| missing:", await pg.evaluate("() => [...window._n.spll.missing]"))
        os.remove(B+"/styles/painterly/renamed_one.safetensors")
        print("ERRORS", errs(logs)[:6])
        await b.close()
asyncio.run(main())
