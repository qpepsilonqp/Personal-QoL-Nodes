import asyncio, sys
from common import *
VUE = sys.argv[1] != "classic" if len(sys.argv) > 1 else True
async def ev(pg, js): return await pg.evaluate(f"() => {{ const c = window._n.spll; return {js}; }}")
def grp(n): return f".spll-tree .spll-group:has(.spll-gname:text-is('{n}'))"
async def main():
    logs=[]
    async with async_playwright() as p:
        b, pg = await open_page(p, logs)
        if not VUE:
            await pg.evaluate("async () => { await window.comfyAPI.app.app.extensionManager.setting.set('Comfy.VueNodes.Enabled', false); }")
            await pg.reload(); await pg.wait_for_function("window.comfyAPI && window.comfyAPI.app && window.comfyAPI.app.app.graph", timeout=60000); await pg.wait_for_timeout(2500); await pg.keyboard.press("Escape")
        await pg.evaluate(SETUP); await pg.wait_for_timeout(1500)
        await choose_root(pg); await pg.wait_for_timeout(1500)
        await pg.evaluate("() => { const c = window._n.spll; c.commit(s => { for (const g of s.groups) g.collapsed = !['styles','anime'].includes(g.name); }); const ks = [...c.files.keys()].filter(k => k.includes('anime/')); c.setActive(ks[0], true); c.setStrength(ks[0], -0.5); c.setActive(ks[1], true); c.setStrength(ks[1], 1.75); }"); await pg.wait_for_timeout(300)
        # group search icon
        print("1 group search inputs visible:", await pg.locator(grp("styles") + " .spll-gsearch").is_visible())
        await pg.hover(grp("styles") + " .spll-gsearch-icon"); await pg.wait_for_timeout(400)
        print("  hover -> box visible:", await pg.locator(grp("styles") + " .spll-gsearch").is_visible())
        await pg.click(grp("styles") + " .spll-gsearch"); await pg.keyboard.type("soft"); await pg.wait_for_timeout(400)
        print("  typed -> results:", await ev(pg, "c.gOpen && c.gDropEl.querySelectorAll('.spll-result-lora').length"), "| lit:", await pg.locator(grp("styles") + " .spll-gsearch-wrap.has-term").count())
        await pg.mouse.move(1180, 520, steps=4); await pg.wait_for_timeout(900)
        print("  left -> box hidden:", not await pg.locator(grp("styles") + " .spll-gsearch").is_visible(), "| results closed:", not await ev(pg, "c.gOpen"), "| term kept:", await ev(pg, "[...c.groupQueries.values()]"))
        await pg.screenshot(path=OUT+f"130_wide_{'vue' if VUE else 'classic'}.png", clip={"x":300,"y":50,"width":440,"height":420})
        # narrow
        await pg.evaluate("() => { const n = window._n; n.setSize([250, n.size[1]]); n.setDirtyCanvas(true,true); }"); await pg.wait_for_timeout(700)
        w = await pg.evaluate("() => window._n.spll.el.offsetWidth")
        print("2 width", w, "| narrow:", await ev(pg, "c.el.classList.contains('is-narrow')"))
        comp = await pg.locator(".spll-active-list .spll-num-compact").all_inner_texts()
        neg = await pg.locator(".spll-active-list .spll-num-compact.is-neg").count()
        print("  compact strengths:", comp, "| red:", neg, "| folder text visible:", await pg.locator(".spll-active-list .spll-name-folder").first.is_visible() if await pg.locator(".spll-active-list .spll-name-folder").count() else False)
        print("  i visible before hover:", await pg.locator(".spll-active-list .spll-info").first.is_visible())
        rb = await pg.locator(".spll-active-list .spll-rt-handle >> nth=0").bounding_box()
        await pg.mouse.move(rb["x"] + rb["width"]/2, rb["y"] + rb["height"]/2, steps=3); await pg.wait_for_timeout(400)
        print("  hover ⋮ -> i/T/☆ visible:", await pg.locator(".spll-active-list .spll-lora").first.locator(".spll-info").is_visible())
        cb = await pg.locator(".spll-active-list .spll-num-compact >> nth=1").bounding_box()
        await pg.mouse.move(cb["x"] + cb["width"]/2, cb["y"] + cb["height"]/2, steps=3); await pg.wait_for_timeout(400)
        print("  hover strength -> full control:", await pg.locator(".spll-active-list .spll-lora").nth(1).locator(".spll-num").is_visible(), await pg.locator(".spll-active-list .spll-lora").nth(1).locator(".spll-num").input_value())
        await pg.locator(".spll-active-list .spll-lora").nth(1).locator("[data-act=inc]").click(); await pg.wait_for_timeout(200)
        print("  + works:", await ev(pg, "c.state.active.map(a => a.strength)"))
        await pg.screenshot(path=OUT+f"131_narrow_{'vue' if VUE else 'classic'}.png", clip={"x":300,"y":50,"width":320,"height":420})
        if not VUE:
            print("  classic tools hidden:", not await pg.locator(".spll-header .spll-gear").is_visible())
            hb = await pg.locator(".spll-hdr-handle").bounding_box()
            await pg.mouse.move(hb["x"] + hb["width"]/2, hb["y"] + hb["height"]/2, steps=3); await pg.wait_for_timeout(400)
            print("  hover ⋮ -> tools:", await pg.locator(".spll-header .spll-gear").is_visible())
            await pg.screenshot(path=OUT+"132_classic_tools.png", clip={"x":300,"y":50,"width":320,"height":200})
        # minimum width
        await pg.evaluate("() => { const n = window._n; n.setSize([100, n.size[1]]); n.setDirtyCanvas(true,true); }"); await pg.wait_for_timeout(500)
        print("3 min clamp ->", await pg.evaluate("() => window._n.size[0]"), "| el:", await pg.evaluate("() => window._n.spll.el.offsetWidth"))
        await pg.evaluate("() => { const n = window._n; n.setSize([420, n.size[1]]); n.setDirtyCanvas(true,true); }"); await pg.wait_for_timeout(600)
        # collapse GROUPS
        h0 = await pg.evaluate("() => window._n.size[1]")
        await pg.click(".spll-tree-title .spll-title-text"); await pg.wait_for_timeout(500)
        h1 = await pg.evaluate("() => window._n.size[1]")
        print("4 collapsed:", await ev(pg, "c.state.settings.groupsCollapsed"), "| tree hidden:", not await pg.locator(".spll-tree").is_visible(), "| height", h0, "->", h1)
        await pg.screenshot(path=OUT+f"133_collapsed_{'vue' if VUE else 'classic'}.png", clip={"x":300,"y":50,"width":440,"height":360})
        await pg.click(".spll-tree-title .spll-title-text"); await pg.wait_for_timeout(500)
        print("  expanded: height back", await pg.evaluate("() => window._n.size[1]"), "| tree visible:", await pg.locator(".spll-tree").is_visible())
        # result click while collapsed opens GROUPS
        await pg.click(".spll-tree-title .spll-title-text"); await pg.wait_for_timeout(400)
        await pg.click("input.spll-search >> nth=0"); await pg.keyboard.type("oil"); await pg.wait_for_timeout(400)
        await pg.locator(".spll-dropdown:not(.spll-gdrop) .spll-result-lora .spll-result-name").first.click(); await pg.wait_for_timeout(500)
        print("  result click opens GROUPS:", not await ev(pg, "c.state.settings.groupsCollapsed"), "| tree visible:", await pg.locator(".spll-tree").is_visible())
        if not VUE:
            await pg.evaluate("async () => { await window.comfyAPI.app.app.extensionManager.setting.set('Comfy.VueNodes.Enabled', true); }")
        print("ERRORS", errs(logs)[:6])
        await b.close()
asyncio.run(main())
