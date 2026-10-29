import asyncio, sys
from common import *
VUE = sys.argv[1] != "classic" if len(sys.argv) > 1 else True
TAG = 'vue' if VUE else 'classic'
async def ev(pg, js): return await pg.evaluate(f"() => {{ const c = window._n.spll; return {js}; }}")
async def center(pg, loc):
    b = await loc.bounding_box(); return b["x"] + b["width"]/2, b["y"] + b["height"]/2
async def main():
    logs=[]
    async with async_playwright() as p:
        b, pg = await open_page(p, logs)
        if not VUE:
            await pg.evaluate("async () => { await window.comfyAPI.app.app.extensionManager.setting.set('Comfy.VueNodes.Enabled', false); }")
            await pg.reload(); await pg.wait_for_function("window.comfyAPI && window.comfyAPI.app && window.comfyAPI.app.app.graph", timeout=60000); await pg.wait_for_timeout(2500); await pg.keyboard.press("Escape")
        await pg.evaluate(SETUP); await pg.wait_for_timeout(1500)
        await choose_root(pg); await pg.wait_for_timeout(1500)
        await pg.evaluate("() => { const c = window._n.spll; c.commit(s => { for (const g of s.groups) g.collapsed = !['characters'].includes(g.name); }); const ks = [...c.files.keys()].filter(k => k.includes('characters/')).sort(); window._k = ks; c.setActive(ks[1], true); c.setStrength(ks[1], 0.8); }"); await pg.wait_for_timeout(300)
        await pg.evaluate("() => { const n = window._n; n.setSize([100, 700]); n.setDirtyCanvas(true,true); }"); await pg.wait_for_timeout(700)
        print("1 min width:", await pg.evaluate("() => window._n.size[0]"), "| narrow:", await ev(pg, "c.el.classList.contains('is-narrow')"))
        tl = await ev(pg, "(() => { const t = c.activeEl.querySelector('.spll-section-title span'); return [t.offsetHeight, t.innerText]; })()")
        print("  ENABLED title height/text:", tl)
        # row tools push the strength
        row = pg.locator(".spll-active-list .spll-lora").first
        s0 = (await row.locator(".spll-num-compact").bounding_box())["x"]
        hx, hy = await center(pg, row.locator(".spll-rt-handle"))
        await pg.mouse.move(hx, hy, steps=3); await pg.wait_for_timeout(450)
        s1 = (await row.locator(".spll-num-compact").bounding_box())["x"]
        print("2 tools out:", await ev(pg, "c.el.querySelector('.spll-active-list .spll-rt-tools').getBoundingClientRect().width > 20"), "| strength moved left by", round(s0 - s1))
        cx, cy = await center(pg, row.locator(".spll-num-compact"))
        await pg.mouse.move(cx, cy, steps=6); await pg.wait_for_timeout(450)
        print("  moved onto strength: tools still out:", await ev(pg, "!!c.el.querySelector('.spll-active-list .spll-rz.is-tools')"), "| full control:", await row.locator(".spll-num").is_visible())
        await row.locator("[data-act=inc]").click(); await pg.wait_for_timeout(300)
        print("  + clicked ->", await ev(pg, "c.state.active[0].strength"), "| tools still out after redraw:", await ev(pg, "!!c.el.querySelector('.spll-active-list .spll-rz.is-tools')"))
        await pg.mouse.move(1180, 520, steps=5); await pg.wait_for_timeout(500)
        print("  left: tools out:", await ev(pg, "!!c.el.querySelector('.spll-active-list .spll-rz.is-tools')"), "| i visible:", await ev(pg, "c.el.querySelector('.spll-active-list .spll-rt-tools').getBoundingClientRect().width > 20"))
        # strength alone
        await pg.mouse.move(cx + 40, cy, steps=2); await pg.wait_for_timeout(50)
        cx2, cy2 = await center(pg, row.locator(".spll-num-compact"))
        await pg.mouse.move(cx2, cy2, steps=4); await pg.wait_for_timeout(450)
        print("  strength alone opens:", await row.locator(".spll-num").is_visible(), "| tools:", await ev(pg, "c.el.querySelector('.spll-active-list .spll-rt-tools').getBoundingClientRect().width > 20"))
        await pg.mouse.move(1180, 520, steps=4); await pg.wait_for_timeout(400)
        await pg.screenshot(path=OUT+f"170_narrow_{TAG}.png", clip={"x":300,"y":50,"width":300,"height":700})
        if VUE:
            vis = lambda: ev(pg, "c.el.querySelector('.spll-strip-pack').getBoundingClientRect().width > 20")
            print("3 strip: Search Folders visible:", await pg.locator(".spll-strip .spll-fs-btn").is_visible(), "| tools folded:", not await vis())
            info = await ev(pg, "(() => { const s = c.footerEl.getBoundingClientRect(); const host = c.badgeStrip(); const bd = [...host.children][0].getBoundingClientRect(); return [s.left|0, bd.right|0]; })()")
            print("  strip left vs badge right:", info)
            hx, hy = await center(pg, pg.locator(".spll-strip-handle"))
            await pg.mouse.move(hx, hy, steps=3); await pg.wait_for_timeout(450)
            print("  hover ⋮ -> gear:", await vis())
            await pg.screenshot(path=OUT+f"171_strip_open.png", clip={"x":300,"y":600,"width":300,"height":140})
            await pg.locator(".spll-strip .spll-icon[data-act=new-group]").click(); await pg.wait_for_timeout(300)
            await pg.keyboard.press("Escape"); await ev(pg, "c.closeOverlay && c.closeOverlay()")
            await pg.mouse.move(1180, 520, steps=5); await pg.wait_for_timeout(600)
            print("  clicked +, moved away -> folded:", not await vis())
        else:
            vis = lambda: ev(pg, "c.el.querySelector('.spll-hdr-pack').getBoundingClientRect().width > 20")
            w0 = await ev(pg, "c.headerEl.querySelector('.spll-search-wrap').offsetWidth")
            hx, hy = await center(pg, pg.locator(".spll-hdr-handle"))
            await pg.mouse.move(hx, hy, steps=3); await pg.wait_for_timeout(450)
            w1 = await ev(pg, "c.headerEl.querySelector('.spll-search-wrap').offsetWidth")
            print("3 classic: hover -> gear:", await vis(), "| search width", w0, "->", w1)
            await pg.screenshot(path=OUT+f"171_classic_open.png", clip={"x":300,"y":50,"width":300,"height":120})
            await pg.locator(".spll-header .spll-gear").click(); await pg.wait_for_timeout(300)
            await pg.mouse.move(1180, 520, steps=5); await pg.wait_for_timeout(600)
            print("  clicked ⚙, moved away -> folded:", not await vis(), "| search width:", await ev(pg, "c.headerEl.querySelector('.spll-search-wrap').offsetWidth"))
            await ev(pg, "c.closeOverlay()")
        # settings
        await ev(pg, "(c.overlay = { kind: 'settings' }, c.render(), 1)"); await pg.wait_for_timeout(300)
        tabs = await ev(pg, "[...c.el.querySelectorAll('.spll-tab')].map(t => { const r = t.getBoundingClientRect(); const p = t.parentElement.getBoundingClientRect(); return r.right <= p.right + 1; })")
        print("4 tabs all visible:", all(tabs), "| rows:", await ev(pg, "new Set([...c.el.querySelectorAll('.spll-tab')].map(t => t.offsetTop)).size"))
        bad = []
        for i in range(await pg.locator(".spll-tab").count()):
            await pg.locator(".spll-tab").nth(i).click(); await pg.wait_for_timeout(250)
            bad += await pg.evaluate("""() => [...document.querySelectorAll('.spll-sheet button')].filter(b => b.offsetWidth && (b.scrollHeight > b.clientHeight + 1 || b.scrollWidth > b.clientWidth + 1)).map(b => b.innerText)""")
            if i == 4: await pg.screenshot(path=OUT+f"172_settings_info_{TAG}.png", clip={"x":300,"y":50,"width":300,"height":400})
        print("  overflowing buttons:", bad)
        await ev(pg, "c.closeOverlay()")
        if not VUE:
            await pg.evaluate("async () => { await window.comfyAPI.app.app.extensionManager.setting.set('Comfy.VueNodes.Enabled', true); }")
        print("ERRORS", errs(logs)[:6])
        await b.close()
asyncio.run(main())
