import asyncio, json, os
from common import *
async def hold_drag(pg, src, dst):
    a = await pg.locator(src).bounding_box(); b = await pg.locator(dst).bounding_box()
    await pg.mouse.move(a["x"]+a["width"]*0.3, a["y"]+a["height"]/2); await pg.mouse.down(); await pg.wait_for_timeout(420)
    await pg.mouse.move(b["x"]+b["width"]*0.3, b["y"]+b["height"]/2, steps=8); await pg.wait_for_timeout(120); await pg.mouse.up()
S = "() => window._n.spll.state"
async def main():
    logs=[]
    async with async_playwright() as p:
        b, pg = await open_page(p, logs)
        await pg.evaluate(SETUP); await pg.wait_for_timeout(1500)
        await choose_root(pg); await pg.wait_for_timeout(1200)
        print("socket dots on node left:", await pg.evaluate("() => window._n.inputs.map(i=>i.name)"))
        # strength typing
        await pg.click(".spll-group:has(.spll-gname:text-is('Unsorted')) .spll-caret")
        r2 = ".spll-lora[data-where=tree][data-path='b1:detail_v2.safetensors']"
        await pg.click(r2+" .spll-num"); await pg.keyboard.type("-0.4"); await pg.keyboard.press("Enter")
        await pg.wait_for_timeout(300)
        print("typed strength:", (await pg.evaluate(S))["strengths"])
        # --- drag detail_v2 into characters (confirm)
        await hold_drag(pg, r2+" .spll-name", ".spll-group:has(.spll-gname:text-is('characters'))")
        txt, labels = await confirm(pg, True, "07_drag_confirm.png")
        print("drag dialog:", txt.replace("\n"," | "), labels)
        await pg.wait_for_timeout(400)
        print("placements:", (await pg.evaluate(S))["placements"])
        # --- drag group 'fantasy' -> 'styles' , cancel
        await pg.click(".spll-group:has(.spll-gname:text-is('concepts')) .spll-caret"); await pg.wait_for_timeout(200)
        await hold_drag(pg, ".spll-group:has(.spll-gname:text-is('fantasy')) .spll-gname", ".spll-group:has(.spll-gname:text-is('styles'))")
        await confirm(pg, False)
        g = {x["name"]: x for x in (await pg.evaluate(S))["groups"]}
        print("fantasy parent after cancel ->", g["fantasy"]["parent"] == g["concepts"]["id"])
        # --- nickname (creates sidecar, confirm)
        r3 = ".spll-lora[data-where=tree][data-path='b1:characters/hero_a.safetensors']"
        await pg.click(r3+" .spll-name", button="right"); await pg.click(".spll-menu-item:text-is('Edit nickname…')"); await pg.wait_for_timeout(300)
        print("DBG", await pg.evaluate("() => [document.activeElement.className, window._n.spll.editing, !!document.querySelector(\"[data-path='b1:characters/hero_a.safetensors']\")]"))
        await pg.screenshot(path=OUT+"dbg2.png")
        await pg.keyboard.type("The Hero"); await pg.keyboard.press("Enter")
        txt, _ = await confirm(pg, True, "08_nick_confirm.png")
        await pg.wait_for_timeout(500)
        print("sidecar:", open("/root/old_comfy/models/loras/characters/hero_a.safetensors.spll.json").read().replace("\n",""))
        # search by nickname
        await pg.fill(".spll-search", "hero"); await pg.wait_for_timeout(300)
        print("search 'hero' results:", await pg.locator(".spll-dropdown .spll-result").all_inner_texts())
        await pg.click(".spll-dropdown .spll-result-lora"); await pg.wait_for_timeout(400)
        # --- group menu: colour + new subgroup
        await pg.click(".spll-group:has(.spll-gname:text-is('styles')) [data-act=gmenu]")
        await pg.click(".spll-menu-item:text-is('Colour…')")
        await pg.click(".spll-swatch-btn >> nth=5")
        await pg.click(".spll-pop [data-act=close]")
        await pg.click(".spll-group:has(.spll-gname:text-is('styles')) [data-act=gmenu]")
        await pg.click(".spll-menu-item:text-is('New subgroup…')")
        await pg.keyboard.type("Favourites"); await pg.keyboard.press("Enter")
        await pg.wait_for_timeout(300)
        await pg.screenshot(path=OUT+"09_colour_subgroup.png")
        # --- right click lora -> move to…
        await pg.click(".spll-group:has(.spll-gname:text-is('anime')) .spll-caret")
        r4 = ".spll-lora[data-where=tree][data-path='b1:styles/anime/anime_bold.safetensors']"
        await pg.click(r4+" .spll-name", button="right")
        await pg.click(".spll-menu-item:text-is('Move to…')")
        await pg.keyboard.type("fav"); await pg.wait_for_timeout(200)
        await pg.screenshot(path=OUT+"10_moveto.png")
        await pg.keyboard.press("Enter"); await pg.wait_for_timeout(300)
        st = await pg.evaluate(S)
        fav = [x for x in st["groups"] if x["name"]=="Favourites"][0]
        print("anime_bold moved to Favourites:", st["placements"].get("b1:styles/anime/anime_bold.safetensors")==fav["id"])
        # --- wheel over tree scrolls list, not canvas
        await pg.click(".spll-group:has(.spll-gname:text-is('bulk')) .spll-caret"); await pg.wait_for_timeout(200)
        before = await pg.evaluate("() => [window.comfyAPI.app.app.canvas.ds.scale, document.querySelector('.spll-tree').scrollTop]")
        box = await pg.locator(".spll-tree").bounding_box()
        await pg.mouse.move(box["x"]+100, box["y"]+150)
        for _ in range(3): await pg.mouse.wheel(0, 200); await pg.wait_for_timeout(100)
        after = await pg.evaluate("() => [window.comfyAPI.app.app.canvas.ds.scale, document.querySelector('.spll-tree').scrollTop]")
        print("wheel: canvas scale", before[0], "->", after[0], "| tree scrollTop", before[1], "->", after[1])
        # --- undo
        n_groups = len((await pg.evaluate(S))["groups"])
        await pg.mouse.click(1300, 700)  # canvas focus
        await pg.keyboard.press("Control+z"); await pg.wait_for_timeout(1500)
        st2 = await pg.evaluate("() => { const n = window.comfyAPI.app.app.graph.nodes.find(n=>n.comfyClass==='SuperPowerLoraLoader'); window._n=n; return n.spll.state }")
        print("undo: bulk collapsed again?", [x for x in st2["groups"] if x["name"]=="bulk"][0]["collapsed"], "groups", n_groups, "->", len(st2["groups"]))
        # --- settings: unlimited
        await pg.evaluate("() => window._n.spll.settingsTab = 'display'"); await pg.click(".spll-gear >> visible=true"); await pg.wait_for_timeout(300)
        await pg.screenshot(path=OUT+"11_settings.png")
        await pg.click(".spll-tab:text-is('Display')"); await pg.click("text=Unlimited"); await pg.wait_for_timeout(300)
        await pg.click(".spll-sheet [data-act=close]"); await pg.wait_for_timeout(500)
        await pg.screenshot(path=OUT+"12_unlimited.png", full_page=True)
        print("listHeight:", (await pg.evaluate("() => window._n.spll.state.settings")))
        # --- save/reload via serialize/configure
        wf = await pg.evaluate("() => window.comfyAPI.app.app.graph.serialize()")
        node = [n for n in wf["nodes"] if n["type"]=="SuperPowerLoraLoader"][0]
        print("workflow widget value bytes:", len(json.dumps(node["widgets_values"])))
        await pg.evaluate("(wf) => window.comfyAPI.app.app.loadGraphData(wf)", wf); await pg.wait_for_timeout(1500)
        st3 = await pg.evaluate("() => window.comfyAPI.app.app.graph.nodes.find(n=>n.comfyClass==='SuperPowerLoraLoader').spll.state")
        print("reload equal:", json.dumps(st3, sort_keys=True)==json.dumps(node["widgets_values"][0], sort_keys=True))
        print("ERRORS", errs(logs)[:10])
        await b.close()
asyncio.run(main())
