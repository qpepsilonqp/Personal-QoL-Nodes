import asyncio
from common import *
async def ev(pg, js): return await pg.evaluate(f"() => {{ const c = window._n.spll; return {js}; }}")
async def main():
    logs=[]
    async with async_playwright() as p:
        b, pg = await open_page(p, logs)
        await pg.evaluate("async () => { await window.comfyAPI.app.app.extensionManager.setting.set('Comfy.VueNodes.Enabled', false); }")
        await pg.reload(); await pg.wait_for_function("window.comfyAPI && window.comfyAPI.app && window.comfyAPI.app.app.graph", timeout=60000); await pg.wait_for_timeout(2500); await pg.keyboard.press("Escape")
        await pg.evaluate(SETUP); await pg.wait_for_timeout(1500)
        await choose_root(pg); await pg.wait_for_timeout(1500)
        g = ".spll-header .spll-gear"
        await pg.click(g); await pg.wait_for_timeout(200); a = await ev(pg, "c.overlay?.kind ?? null")
        await pg.click(g); await pg.wait_for_timeout(200)
        print("gear toggle:", a, "->", await ev(pg, "c.overlay?.kind ?? null"))
        await pg.click(".spll-tree .spll-group:has(.spll-gname:text-is('styles')) [data-act=gmenu]"); await pg.wait_for_timeout(200)
        await pg.mouse.click(1180, 520); await pg.wait_for_timeout(250)
        print("menu closed by canvas click:", await ev(pg, "c.overlay?.kind ?? null"))
        await pg.click("[data-act=select-groups]"); await pg.wait_for_timeout(200)
        print("select bar:", (await pg.locator(".spll-tree-title").inner_text()).replace("\n", " "))
        await pg.click("[data-act=sel-cancel]"); await pg.wait_for_timeout(150)
        await pg.click("[data-act=expand-all]"); await pg.wait_for_timeout(200)
        print("expand all collapsed count:", await ev(pg, "c.state.groups.filter(g => g.collapsed).length"))
        await pg.screenshot(path=OUT+"95_classic.png", clip={"x":300,"y":50,"width":440,"height":600})
        await pg.evaluate("async () => { await window.comfyAPI.app.app.extensionManager.setting.set('Comfy.VueNodes.Enabled', true); }")
        print("ERRORS", errs(logs)[:4])
        await b.close()
asyncio.run(main())
