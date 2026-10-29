import asyncio
from common import *
S = "() => window._n.spll.state"
async def hold_drag(pg, src, dst, hold=450, steps=8):
    a = await pg.locator(src).bounding_box(); b = await pg.locator(dst).bounding_box()
    await pg.mouse.move(a["x"]+a["width"]*0.35, a["y"]+a["height"]/2); await pg.mouse.down()
    # move a bit during the hold: must not cancel
    await pg.mouse.move(a["x"]+a["width"]*0.35+15, a["y"]+a["height"]/2+6, steps=3)
    await pg.wait_for_timeout(hold)
    await pg.mouse.move(b["x"]+b["width"]*0.3, b["y"]+b["height"]/2, steps=steps)
    await pg.wait_for_timeout(150)
    shot = await pg.screenshot(path=OUT+"40_dragging.png")
    await pg.mouse.up()
async def main():
    logs=[]
    async with async_playwright() as p:
        b, pg = await open_page(p, logs)
        await pg.evaluate(SETUP); await pg.wait_for_timeout(1500)
        await choose_root(pg)
        g = lambda n: f".spll-group:has(.spll-gname:text-is('{n}'))"
        # click on the empty middle of the bar (between count and search)
        bb = await pg.locator(g("styles")).bounding_box()
        await pg.mouse.click(bb["x"]+150, bb["y"]+bb["height"]/2); await pg.wait_for_timeout(300)
        st = {x["name"]: x["collapsed"] for x in (await pg.evaluate(S))["groups"]}
        print("bar click opened styles:", st["styles"] is False)
        # click 4px left of the search box: dead zone, no toggle
        sb = await pg.locator(g("styles")+" .spll-gsearch-wrap").bounding_box()
        await pg.mouse.click(sb["x"]-4, sb["y"]+sb["height"]/2); await pg.wait_for_timeout(300)
        st = {x["name"]: x["collapsed"] for x in (await pg.evaluate(S))["groups"]}
        print("dead-zone click left it open:", st["styles"] is False)
        # quick press = click, no drag
        await pg.click(g("anime")+" .spll-gname"); await pg.wait_for_timeout(300)
        print("anime opened by name click:", {x["name"]: x["collapsed"] for x in (await pg.evaluate(S))["groups"]}["anime"] is False)
        # hold-drag a LoRA into characters
        await hold_drag(pg, ".spll-lora[data-where=tree][data-path='b1:styles/anime/anime_bold.safetensors'] .spll-name", g("characters"))
        txt,_ = await confirm(pg, True)
        print("drop dialog:", txt.split("\n")[1])
        await pg.wait_for_timeout(300)
        print("placement set:", "b1:styles/anime/anime_bold.safetensors" in (await pg.evaluate(S))["placements"])
        # short press-and-move (less than hold) must not drag
        a = await pg.locator(g("painterly")).bounding_box()
        await pg.mouse.move(a["x"]+60, a["y"]+10); await pg.mouse.down(); await pg.mouse.move(a["x"]+60, a["y"]+120, steps=4); await pg.wait_for_timeout(100); await pg.mouse.up()
        await pg.wait_for_timeout(400)
        print("no dialog after quick move:", await pg.locator("[role=dialog]:not(.spll-modal)").count() == 0)
        # hold-drag a group onto another group (collapse open groups first so both are in view)
        for n in ["characters", "styles"]:
            gb = await pg.locator(g(n)).bounding_box()
            await pg.mouse.click(gb["x"]+150, gb["y"]+gb["height"]/2); await pg.wait_for_timeout(250)
        await hold_drag(pg, g("video")+" .spll-gname", g("concepts"))
        txt,_ = await confirm(pg, True)
        print("group drop dialog:", txt.split("\n")[1])
        await pg.wait_for_timeout(300)
        gs = {x["name"]: x for x in (await pg.evaluate(S))["groups"]}
        print("video now inside concepts:", gs["video"]["parent"] == gs["concepts"]["id"])
        print("ERRORS", errs(logs)[:5])
        await b.close()
asyncio.run(main())
