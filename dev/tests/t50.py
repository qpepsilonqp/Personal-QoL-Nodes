import asyncio, json
from common import *
C = "window._n.spll"
async def ev(pg, js): return await pg.evaluate(f"() => {{ const c = {C}; return {js}; }}")
async def away(pg, wait=600):
    await pg.mouse.move(1100, 700, steps=4); await pg.wait_for_timeout(wait)
async def main():
    logs=[]
    async with async_playwright() as p:
        b, pg = await open_page(p, logs)
        await pg.evaluate(SETUP); await pg.wait_for_timeout(1500)
        await choose_root(pg); await pg.wait_for_timeout(1500)
        await pg.evaluate("() => { const n = window._n; n.setSize([n.size[0], n.size[1]]); }")
        # 1. strip
        info = await pg.evaluate("""() => { const c = window._n.spll; const s = c.footerEl.getBoundingClientRect(); const host = c.badgeStrip(); const hr = host?.getBoundingClientRect(); const badge = host && [...host.children][0].getBoundingClientRect();
          return { floating: c.stripFloating, strip: [s.left|0, s.top|0, s.right|0, s.bottom|0], host: hr && [hr.left|0, hr.top|0, hr.right|0, hr.bottom|0], badgeRight: badge && badge.right|0,
                   order: [...c.footerEl.querySelectorAll('button[data-act]')].filter(b=>b.offsetWidth).map(b=>b.dataset.act), wrapW: c.fsWrap.offsetWidth }; }""")
        print("1 strip:", info)
        await pg.screenshot(path=OUT+"80_strip.png", clip={"x":300,"y":60,"width":440,"height":620})
        # 2. Search Files slides out, results above, slides back on leave
        await pg.click(".spll-fs-btn"); await pg.wait_for_timeout(450)
        w = await pg.evaluate("() => { const c = window._n.spll; const r = c.fsWrap.getBoundingClientRect(); return [r.left|0, r.width|0]; }")
        print("2 slid out (left, width):", w, "| focused:", await ev(pg, "document.activeElement === c.fsInput"))
        await pg.keyboard.type("anime"); await pg.wait_for_timeout(1200)
        rr = await pg.evaluate("() => { const e = document.querySelector('.spll-fs-results'); const i = window._n.spll.fsInput.getBoundingClientRect(); return e && [e.getBoundingClientRect().bottom|0, i.top|0]; }")
        print("  results bottom vs input top:", rr, "| first row starts with:", (await pg.locator(".spll-fs-results .spll-fs-row").first.inner_text()).split("\n")[0])
        await pg.screenshot(path=OUT+"81_fs_open.png")
        await away(pg, 800)
        print("  after leaving: open", await ev(pg, "c.footerOpen"), "| width", await ev(pg, "c.fsWrap.offsetWidth"), "| results", await pg.locator(".spll-fs-results").count(), "| term kept:", await ev(pg, "c.fsInput.value"))
        await pg.click(".spll-fs-btn"); await pg.wait_for_timeout(450)
        print("  reopened selection:", await ev(pg, "[c.fsInput.selectionStart, c.fsInput.selectionEnd, c.fsInput.value.length]"), "| results:", await pg.locator(".spll-fs-results").count())
        await away(pg, 800)
        # 3. main search: type, leave, hover reopen
        await pg.click("input.spll-search >> nth=0"); await pg.keyboard.type("anime"); await pg.wait_for_timeout(300)
        print("3 typed: open", await ev(pg, "c.mainOpen"))
        await away(pg, 600)
        print("  left: open", await ev(pg, "c.mainOpen"))
        await pg.hover("input.spll-search >> nth=0"); await pg.wait_for_timeout(80)
        o1 = await ev(pg, "c.mainOpen"); await pg.wait_for_timeout(200)
        print("  hover after 80ms:", o1, "| after 280ms:", await ev(pg, "c.mainOpen"))
        # click a result: stays open, row held
        res = pg.locator(".spll-dropdown .spll-result-lora:has(.spll-result-name:text-is('anime_soft'))").first
        sw_first = await res.evaluate("e => e.firstElementChild.classList.contains('spll-switch')")
        await res.locator(".spll-result-name").click(); await pg.wait_for_timeout(400)
        print("  clicked result: open", await ev(pg, "c.mainOpen"), "| switch first:", sw_first, "| held rows:", await pg.locator(".spll-tree .is-hold").count(), "| hold var:", await pg.evaluate("() => document.querySelector('.spll-tree .is-hold')?.style.getPropertyValue('--spll-hold')"))
        await pg.screenshot(path=OUT+"82_hold.png")
        # hover another result: peek
        await pg.hover(".spll-dropdown .spll-result-lora:has(.spll-result-name:text-is('anime_bold')) .spll-result-name"); await pg.wait_for_timeout(200)
        print("  peek on hover:", await pg.locator(".is-peek").count(), [await e.get_attribute("data-path") for e in await pg.locator(".is-peek").all()])
        await away(pg, 600)
        print("  after leaving: open", await ev(pg, "c.mainOpen"), "| unhold:", await pg.locator(".spll-tree .is-unhold").count(), "| peek:", await pg.locator(".is-peek").count())
        await pg.wait_for_timeout(3700)
        print("  after 3.7s:", await pg.locator(".spll-tree .is-unhold, .spll-tree .is-hold").count())
        # 4. select on click / caret at end
        await pg.evaluate("""() => { const c = window._n.spll; const i = c.searchInput; window._log = [];
          for (const t of ['mousedown','focus','blur','select','mouseup','click']) i.addEventListener(t, (e) => window._log.push(t + ':' + i.selectionStart + '-' + i.selectionEnd + (t==='mousedown' ? ' dp=' + e.defaultPrevented : '')), true);
          document.addEventListener('selectionchange', () => { if (document.activeElement === i) window._log.push('selchange:' + i.selectionStart + '-' + i.selectionEnd); }); }""")
        await pg.mouse.click(1100, 700); await pg.wait_for_timeout(100)
        box = await pg.locator("input.spll-search >> nth=0").bounding_box()
        await pg.mouse.click(box["x"]+15, box["y"]+box["height"]/2); await pg.wait_for_timeout(100)
        print("4 click on text:", await ev(pg, "[c.searchInput.selectionStart, c.searchInput.selectionEnd]"))
        await pg.mouse.click(1180, 520); await pg.wait_for_timeout(100)
        X, Y = box["x"]+box["width"]-60, box["y"]+box["height"]/2
        await pg.mouse.move(X, Y)
        print("  under pointer:", await pg.evaluate(f"() => {{ const e = document.elementFromPoint({X},{Y}); return e.tagName + '.' + e.className + ' | parent ' + e.parentElement?.className; }}"))
        await pg.mouse.down(); 
        print("  after down under pointer:", await pg.evaluate(f"() => {{ const e = document.elementFromPoint({X},{Y}); return e.tagName + '.' + e.className; }}"))
        await pg.mouse.up(); await pg.wait_for_timeout(100)
        print("  log:", await pg.evaluate("() => window._log.splice(0)"), "| active:", await pg.evaluate("() => document.activeElement?.className"))
        print("  click right of text:", await ev(pg, "[c.searchInput.selectionStart, c.searchInput.selectionEnd]"))
        await pg.mouse.click(box["x"]+22, box["y"]+box["height"]/2); await pg.wait_for_timeout(100)
        print("  log:", await pg.evaluate("() => window._log.splice(0)"))
        print("  second click inside:", await ev(pg, "[c.searchInput.selectionStart, c.searchInput.selectionEnd]"))
        await pg.keyboard.press("Escape"); await pg.wait_for_timeout(100)
        print("  escape: open", await ev(pg, "c.mainOpen"), "term", await ev(pg, "c.mainQuery"))
        await away(pg, 400)
        # 5. group search: opens above its bar
        await pg.evaluate("() => { const c = window._n.spll; c.treeEl.scrollTop = 0; c.renderTreeWindow(); }")
        gs = pg.locator(".spll-group:has(.spll-gname:text-is('styles')) .spll-gsearch")
        await pg.hover(".spll-group:has(.spll-gname:text-is('styles')) .spll-gsearch-icon"); await pg.wait_for_timeout(300)
        await gs.click(); await pg.keyboard.type("soft"); await pg.wait_for_timeout(300)
        g = await pg.evaluate("() => { const c = window._n.spll; const d = c.gDropEl.getBoundingClientRect(); const bar = document.querySelector(\".spll-group[data-gid='\" + c.gOpen + \"']\").getBoundingClientRect(); return { open: c.gOpen, up: c.gDropEl.classList.contains('is-up'), dropBottom: d.bottom|0, barTop: bar.top|0, rows: c.gDropEl.querySelectorAll('.spll-result-lora').length }; }")
        print("5 group search:", g, "| × shown:", await pg.locator(".spll-group:has(.spll-gname:text-is('styles')) .spll-gsearch-clear").count())
        await pg.screenshot(path=OUT+"83_group_search.png")
        await pg.locator(".spll-gdrop .spll-result-name").first.click(); await pg.wait_for_timeout(400)
        print("  clicked: still open", await ev(pg, "c.gOpen"), "| held:", await pg.locator(".spll-tree .is-hold").count())
        await away(pg, 600)
        print("  left: open", await ev(pg, "c.gOpen"), "| term kept", await ev(pg, "[...c.groupQueries.values()]"))
        await pg.hover(".spll-group:has(.spll-gname:text-is('styles')) .spll-gsearch-icon"); await pg.wait_for_timeout(300)
        await pg.click(".spll-group:has(.spll-gname:text-is('styles')) .spll-gsearch-clear"); await pg.wait_for_timeout(200)
        print("  × cleared:", await ev(pg, "[...c.groupQueries.values()]"))
        # 6. ENABLED scroll keeps its place
        await pg.evaluate("() => { const c = window._n.spll; [...c.files.keys()].slice(0, 14).forEach(k => c.setActive(k, true)); }"); await pg.wait_for_timeout(300)
        await pg.evaluate("() => { const l = document.querySelector('.spll-active-list'); l.scrollTop = l.scrollHeight; }"); await pg.wait_for_timeout(150)
        before = await pg.evaluate("() => document.querySelector('.spll-active-list').scrollTop")
        last = pg.locator(".spll-active-list .spll-lora").last
        await last.locator("[data-act=inc]").click() if await last.locator("[data-act=inc]").count() else await last.locator(".spll-step").last.click()
        await pg.wait_for_timeout(300)
        print("6 ENABLED scroll before/after +:", before, await pg.evaluate("() => document.querySelector('.spll-active-list').scrollTop"))
        print("ERRORS", errs(logs)[:6])
        await b.close()
asyncio.run(main())
