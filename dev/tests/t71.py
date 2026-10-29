import asyncio
from common import *
async def ev(pg, js): return await pg.evaluate(f"() => {{ const c = window._n.spll; return {js}; }}")
async def main():
    logs=[]
    async with async_playwright() as p:
        b, pg = await open_page(p, logs)
        await pg.evaluate(SETUP); await pg.wait_for_timeout(1500)
        await choose_root(pg); await pg.wait_for_timeout(1500)
        print("1 button:", await pg.locator(".spll-fav-menu-btn").inner_text(), "| narrow:", await pg.locator(".spll-active .spll-section-title.is-narrow").count())
        await pg.evaluate("() => { const c = window._n.spll; const ks = [...c.files.keys()]; for (const k of [ks[0], ks[5], ks[9]]) c.addFav(k); c.setActive(ks[5], true); c.setActive(ks[2], true); c.setActive(ks[2], false); }"); await pg.wait_for_timeout(5600)
        await pg.click(".spll-fav-menu-btn"); await pg.wait_for_timeout(200)
        await pg.hover(".spll-pmenu-item:has-text('Favourites')"); await pg.wait_for_timeout(400)
        fav = pg.locator(".spll-pmenu.is-favs")
        print("2 rows:", [x.replace("\n"," ") for x in await fav.locator(".spll-pmenu-lora").all_inner_texts()], "| switches:", await fav.locator(".spll-switch").count(), "| paths:", await fav.locator(".spll-result-path").count(), "| ⌖:", await fav.locator(".spll-locate").count())
        print("  width:", (await fav.bounding_box())["width"], "| green rows:", await fav.locator(".spll-pmenu-lora.is-on").count())
        r0 = fav.locator(".spll-pmenu-lora:not(.is-on)").first
        await r0.locator(".spll-result-name").click(); await pg.wait_for_timeout(250)
        print("  row click switched on -> green:", await fav.locator(".spll-pmenu-lora.is-on").count())
        await fav.locator(".spll-pmenu-lora").first.hover(); await pg.wait_for_timeout(700)
        print("  tooltip:", (await pg.locator(".spll-pmenu-tip").inner_text()).replace("\n"," | ") if await pg.locator(".spll-pmenu-tip").count() else None)
        await pg.screenshot(path=OUT+"110_fav_slim.png")
        await fav.locator(".spll-pmenu-lora").first.click(button="right"); await pg.wait_for_timeout(250)
        print("  right-click:", [x for x in await pg.locator(".spll-pmenu").last.locator(".spll-pmenu-item").all_inner_texts()])
        await pg.keyboard.press("Escape"); await pg.wait_for_timeout(150)
        # history
        await pg.click(".spll-fav-menu-btn"); await pg.hover(".spll-pmenu-item:has-text('History')"); await pg.wait_for_timeout(400)
        hist = pg.locator(".spll-pmenu.is-hist")
        print("3 history rows:", await hist.locator(".spll-pmenu-lora").all_inner_texts(), "| switches:", await hist.locator(".spll-switch").count(), "| width:", (await hist.bounding_box())["width"])
        await hist.locator(".spll-pmenu-lora").first.click(button="right"); await pg.wait_for_timeout(250)
        print("  right-click:", await pg.locator(".spll-pmenu").last.locator(".spll-pmenu-item").all_inner_texts())
        await pg.keyboard.press("Escape")
        # tiers panel fits names
        await ev(pg, "c.commit(s => { s.settings.tierSubmenus = 'always'; })")
        async def tierw():
            await pg.click(".spll-fav-menu-btn"); await pg.hover(".spll-pmenu-item:has-text('Favourites')"); await pg.wait_for_timeout(400)
            w = (await pg.locator(".spll-pmenu.is-tiers").bounding_box())["width"]; await pg.keyboard.press("Escape"); await pg.wait_for_timeout(150); return w
        w1 = await tierw()
        await ev(pg, "c.renameTier('t1', 'Absolutely essential everyday favourites')")
        w2 = await tierw()
        print("4 tier panel width:", w1, "->", w2)
        # narrow node -> icon
        await pg.evaluate("() => { const n = window._n; n.setSize([200, n.size[1]]); n.setDirtyCanvas(true,true); }"); await pg.wait_for_timeout(600)
        print("5 narrow node: icon only:", await pg.locator(".spll-active .spll-section-title.is-narrow").count(), "| node width:", (await pg.locator(".spll-active").bounding_box())["width"])
        await pg.screenshot(path=OUT+"111_narrow.png", clip={"x":300,"y":60,"width":440,"height":300})
        print("ERRORS", errs(logs)[:6])
        await b.close()
asyncio.run(main())
