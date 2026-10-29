import asyncio
from common import *
async def ev(pg, js): return await pg.evaluate(f"() => {{ const c = window._n.spll; return {js}; }}")
STYLE = "() => [...document.querySelectorAll('.spll-active-list .spll-lora')].map(r => { const cs = getComputedStyle(r); return cs.backgroundColor + ' | line ' + cs.borderLeftColor; })"
GROUP = "() => [...document.querySelectorAll('.spll-tree .spll-group')].slice(0,2).map(r => { const cs = getComputedStyle(r); return cs.backgroundColor + ' | line ' + cs.borderLeftColor; })"
async def main():
    logs=[]
    async with async_playwright() as p:
        b, pg = await open_page(p, logs)
        await pg.evaluate(SETUP); await pg.wait_for_timeout(1500)
        await choose_root(pg); await pg.wait_for_timeout(1500)
        await pg.evaluate("() => { const c = window._n.spll; c.commit(s => { s.settings.colorMode = 'individual'; const g = s.groups.find(g => g.name === 'styles'); g.color = '#2e9e5b'; }); const ks = [...c.files.keys()].filter(k => k.includes('styles/')); ks.slice(0,3).forEach(k => c.setActive(k, true)); }"); await pg.wait_for_timeout(400)
        print("individual ENABLED:", await pg.evaluate(STYLE))
        await pg.screenshot(path=OUT+"120_individual.png", clip={"x":300,"y":60,"width":440,"height":360})
        await ev(pg, "c.commit(s => { s.settings.colorMode = 'alternating'; })"); await pg.wait_for_timeout(300)
        print("alternating ENABLED:", await pg.evaluate(STYLE))
        print("alternating GROUPS: ", await pg.evaluate(GROUP))
        await pg.screenshot(path=OUT+"121_alternating.png", clip={"x":300,"y":60,"width":440,"height":360})
        await pg.click(".spll-strip .spll-gear"); await pg.click(".spll-tab:text-is('Display')"); await pg.wait_for_timeout(200)
        print("pickers shown:", await pg.locator(".spll-settings [data-act=set-color-a]").count(), "| build:", await pg.locator(".spll-build").inner_text())
        await ev(pg, "c.commit(s => { s.settings.colorMode = 'individual'; })"); await pg.wait_for_timeout(200)
        print("pickers shown in individual:", await pg.locator(".spll-settings [data-act=set-color-a]").count())
        print("ERRORS", errs(logs)[:6])
        await b.close()
asyncio.run(main())
