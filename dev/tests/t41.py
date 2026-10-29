import asyncio, json
from common import *
S = "() => window._n.spll.state"
EN = ".spll-active-list"
async def enabled(pg):
    return await pg.evaluate("() => [...document.querySelectorAll('.spll-active-list > .spll-row')].map(r => (r.classList.contains('spll-fading')?'~':'') + r.querySelector('.spll-name').textContent)")
async def main():
    logs=[]
    async with async_playwright() as p:
        b, pg = await open_page(p, logs)
        await pg.evaluate(SETUP); await pg.wait_for_timeout(1500)
        await choose_root(pg); await pg.wait_for_timeout(1500)
        # open a group and enable three
        await pg.evaluate("() => { const c = window._n.spll; c.commit(s => { for (const g of s.groups) g.collapsed = false; }); }")
        await pg.wait_for_timeout(400)
        names = await pg.locator(".spll-tree .spll-lora .spll-name").all_inner_texts()
        print("tree:", names[:8])
        await pg.evaluate("() => { const c = window._n.spll; window._k = (n) => [...c.files.keys()].find(k => k.endsWith('/'+n+'.safetensors') || k.endsWith(':'+n+'.safetensors')); for (const n of ['anime_soft','detail_v2','neon_city']) c.setActive(window._k(n), true); }")
        await pg.wait_for_timeout(300)
        await pg.evaluate("() => window._n.spll.setStrength('b1:detail_v2.safetensors', 0.65)") if False else None
        print("A enabled:", await enabled(pg))
        # switch off the middle one from ENABLED
        await pg.click(f"{EN} .spll-lora:has(.spll-name:text-is('detail_v2')) .spll-switch"); await pg.wait_for_timeout(300)
        st = await pg.evaluate(S)
        print("B after off:", await enabled(pg), "| active:", [a["path"] for a in st["active"]], "| history:", st["history"])
        await pg.screenshot(path=OUT+"70_fading.png", clip={"x":300,"y":80,"width":600,"height":360})
        await pg.wait_for_timeout(1000)
        await pg.click(f"{EN} .spll-fading"); await pg.wait_for_timeout(300)
        st = await pg.evaluate(S)
        print("C undo:", await enabled(pg), "| history:", st["history"])
        # off via the tree switch, then hover to pause for 7s
        await pg.evaluate("() => window._n.spll.setActive(window._k('anime_soft'), false)"); await pg.wait_for_timeout(300)
        await pg.hover(f"{EN} .spll-fading"); await pg.wait_for_timeout(7000)
        print("D still there after 7s hover:", await enabled(pg))
        await pg.mouse.move(5,5); await pg.wait_for_timeout(5600)
        print("E after leaving 5.6s:", await enabled(pg), "| history:", (await pg.evaluate(S))["history"])
        # favourites: star four, then sort
        for n in ["neon_city", "anime_soft", "chrome_skin", "detail_v2"]:
            await pg.evaluate(f"() => window._n.spll.toggleFav(window._k('{n}'))"); await pg.wait_for_timeout(30)
        print("F favourites (custom, newest on top):", [x.split('/')[-1] for x in (await pg.evaluate(S))["favourites"]])
        async def favmenu():
            await pg.click(f"{EN}", button="right"); await pg.wait_for_timeout(200)
            await pg.hover(".spll-pmenu-item:has-text('Favourites')"); await pg.wait_for_timeout(400)
            return await pg.locator(".spll-pmenu.is-favs .spll-result-name").all_inner_texts()
        print("  menu:", await favmenu())
        await pg.hover(".spll-fav-sort"); await pg.wait_for_timeout(300)
        print("  sort options:", await pg.locator(".spll-pmenu.is-items .spll-pmenu-item").all_inner_texts())
        await pg.screenshot(path=OUT+"71_fav_sort.png")
        await pg.click(".spll-pmenu.is-items .spll-pmenu-item:has-text('A to Z')"); await pg.wait_for_timeout(300)
        print("G A-Z:", await pg.locator(".spll-pmenu.is-favs .spll-result-name").all_inner_texts(), "| btn:", await pg.locator(".spll-fav-sort").inner_text())
        await pg.screenshot(path=OUT+"72_after_az.png")
        for i in range(6):
            print("   sub count", await pg.locator(".spll-pmenu-sub").count(), await pg.evaluate("() => document.querySelector('.spll-pmenu-sub')?.getBoundingClientRect().x"))
            await pg.wait_for_timeout(150)
        for k in ["za", "old", "new"]:
            await pg.click(".spll-pmenu.is-items .spll-pmenu-item:has-text('" + {"za":"Z to A","new":"Newest added","old":"Oldest added"}[k] + "')"); await pg.wait_for_timeout(250)
            print(f"  {k}:", await pg.locator(".spll-pmenu.is-favs .spll-result-name").all_inner_texts())
        # drag the last onto the top under "new" -> becomes custom
        rows = pg.locator(".spll-pmenu.is-favs .spll-pmenu-lora")
        g = await rows.nth(3).locator(".spll-grip").bounding_box(); t = await rows.nth(0).bounding_box()
        await pg.mouse.move(g["x"]+5, g["y"]+8); await pg.mouse.down()
        await pg.mouse.move(g["x"]+5, t["y"]+10, steps=8); await pg.wait_for_timeout(100); await pg.mouse.up(); await pg.wait_for_timeout(300)
        st = await pg.evaluate(S)
        print("H after drag:", await pg.locator(".spll-pmenu.is-favs .spll-result-name").all_inner_texts(), "| sort:", st["settings"]["favSort"], "| dialog:", await pg.locator("[role=dialog]:not(.spll-modal)").count())
        # switch to custom from az keeps shown order
        await pg.hover(".spll-fav-sort"); await pg.wait_for_timeout(300); await pg.click(".spll-pmenu.is-items .spll-pmenu-item:has-text('A to Z')"); await pg.wait_for_timeout(250)
        await pg.click(".spll-pmenu.is-items .spll-pmenu-item:has-text('Custom')"); await pg.wait_for_timeout(250)
        print("I custom from A-Z:", await pg.locator(".spll-pmenu.is-favs .spll-result-name").all_inner_texts())
        print("ERRORS", errs(logs)[:6])
        await b.close()
asyncio.run(main())
