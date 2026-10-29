import asyncio
from common import *
async def ev(pg, js): return await pg.evaluate(f"() => {{ const c = window._n.spll; return {js}; }}")
async def main():
    logs=[]
    async with async_playwright() as p:
        b, pg = await open_page(p, logs)
        await pg.evaluate(SETUP); await pg.wait_for_timeout(1500)
        await choose_root(pg); await pg.wait_for_timeout(1500)
        await pg.evaluate("() => { const c = window._n.spll; c.commit(s => { for (const g of s.groups) g.collapsed = !['styles','anime','painterly'].includes(g.name); }); const ks = [...c.files.keys()].filter(k => k.includes('styles/')); c.addFav(ks[0], 't1'); c.addFav(ks[1], 't2'); c.addFav(ks[2], 't3'); c.addTier(); c.commit(s => { s.tiers[3].name = 'Platinum'; s.tiers[3].color = '#c9d6df'; s.tiers[3].shine = '#f4fbff'; }); c.addFav(ks[3], 't4'); }"); await pg.wait_for_timeout(400)
        print("1 star glyph styles:", await pg.evaluate("() => [...document.querySelectorAll('.spll-tree .spll-star-glyph.is-metal')].map(e => getComputedStyle(e).getPropertyValue('--st-a') + '/' + getComputedStyle(e).getPropertyValue('--st-o'))"))
        await pg.screenshot(path=OUT+"140_stars.png", clip={"x":560,"y":250,"width":160,"height":200})
        # highlight colour change applies to the node and menus
        await ev(pg, "c.commit(s => { s.settings.hl.accent = '#ff00aa'; s.settings.hl.on = '#00ffcc'; })")
        print("2 node vars:", await ev(pg, "[getComputedStyle(c.el).getPropertyValue('--spll-accent'), getComputedStyle(c.el).getPropertyValue('--spll-on')]"))
        await pg.click(".spll-fav-menu-btn"); await pg.wait_for_timeout(200)
        print("  menu layer vars:", await pg.evaluate("() => getComputedStyle(document.querySelector('.spll-pmenu-layer')).getPropertyValue('--spll-accent')"))
        await pg.hover(".spll-pmenu-item:has-text('Favourites')"); await pg.wait_for_timeout(400)
        await pg.screenshot(path=OUT+"141_tier_menu.png")
        await pg.keyboard.press("Escape")
        await pg.click(".spll-strip .spll-gear"); await pg.click(".spll-tab:text-is('Display')"); await pg.wait_for_timeout(200)
        print("3 highlight rows:", await pg.locator(".spll-hl-row").count())
        await pg.screenshot(path=OUT+"142_display.png", clip={"x":300,"y":60,"width":440,"height":620})
        await pg.click(".spll-tab:text-is('Favourites')"); await pg.wait_for_timeout(200)
        print("4 tier rows colour inputs:", await pg.locator(".spll-tier-item").first.locator("input[type=color]").count())
        await pg.screenshot(path=OUT+"143_tier_settings.png", clip={"x":300,"y":60,"width":440,"height":620})
        print("ERRORS", errs(logs)[:6])
        await b.close()
asyncio.run(main())
