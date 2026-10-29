import asyncio, sys
from common import *
VUE = sys.argv[1] != "classic" if len(sys.argv) > 1 else True
TAG = 'vue' if VUE else 'classic'
async def ev(pg, js): return await pg.evaluate(f"() => {{ const c = window._n.spll; return {js}; }}")
async def menu_labels(pg): return await pg.locator(".spll-pmenu .spll-pmenu-label").all_inner_texts()
async def main():
    logs=[]
    async with async_playwright() as p:
        b, pg = await open_page(p, logs)
        await pg.context.grant_permissions(["clipboard-read", "clipboard-write"], origin="http://127.0.0.1:8188")
        if not VUE:
            await pg.evaluate("async () => { await window.comfyAPI.app.app.extensionManager.setting.set('Comfy.VueNodes.Enabled', false); }")
            await pg.reload(); await pg.wait_for_function("window.comfyAPI && window.comfyAPI.app && window.comfyAPI.app.app.graph", timeout=60000); await pg.wait_for_timeout(2500); await pg.keyboard.press("Escape")
        await pg.evaluate(SETUP); await pg.wait_for_timeout(1500)
        await choose_root(pg); await pg.wait_for_timeout(1500)
        await pg.evaluate("""() => { const c = window._n.spll; window._n.setSize([440, 760]);
          const ks = [...c.files.keys()].filter(k => k.includes('characters/')).sort(); window._k = ks;
          const con = [...c.files.keys()].filter(k => k.includes('concepts/')).sort(); window._c = con;
          c.session.set(ks[0], { trig: ['onlyword'], ids: {} }); c.session.set(ks[1], { trig: ['alpha', 'beta'], ids: {} });
          c.commit(s => { for (const g of s.groups) g.collapsed = !['characters'].includes(g.name);
            s.mixes.push({ id: 'mA', name: 'Alpha', items: [{ path: con[0], strength: 0.5 }, { path: con[1], strength: -0.6 }], added: 1, color: null, collapsed: false });
            s.active.push({ path: ks[2], strength: 0.8 }, { mix: 'mA', on: true, since: 1 }); }); }"""); await pg.wait_for_timeout(500)
        tr = lambda i: pg.locator(f".spll-tree .spll-lora[data-path='{'b1:characters/' + ['detail_v2','hero_a','villain_b'][i] + '.safetensors'}'] .spll-trig")
        # 1. T
        await tr(0).click(); await pg.wait_for_timeout(500)
        clip = await pg.evaluate("() => navigator.clipboard.readText()")
        print("1 one word: clipboard:", clip, "| box open:", await ev(pg, "c.overlay?.kind || null"), "| toast:", await pg.locator("text=Copied trigger words").count())
        await tr(1).click(); await pg.wait_for_timeout(300)
        print("  two words -> box:", await ev(pg, "c.overlay?.kind || null")); await ev(pg, "(c.closeOverlay(), 1)")
        await tr(0).click(button="right"); await pg.wait_for_timeout(300)
        print("  right-click one word -> box:", await ev(pg, "c.overlay?.kind || null")); await ev(pg, "(c.closeOverlay(), 1)")
        # 2. Move to…
        await pg.locator(".spll-active-list > .spll-lora").first.click(button="right"); await pg.wait_for_timeout(300)
        print("2 ENABLED menu has Move to:", "Move to…" in await menu_labels(pg)); await pg.keyboard.press("Escape"); await pg.wait_for_timeout(200)
        await pg.locator(".spll-tree .spll-lora").first.click(button="right"); await pg.wait_for_timeout(300)
        print("  GROUPS menu has Move to:", await pg.locator(".spll-overlay .spll-menu-item:text-is('Move to…')").count() == 1); await ev(pg, "(c.closeOverlay(), 1)")
        # 3. mix head
        head = pg.locator(".spll-mix-head")
        print("3 head order:", await ev(pg, "[...c.el.querySelector('.spll-mix-head').children].slice(0,3).map(e => e.dataset.act || e.className.split(' ')[0])"), "| name:", await head.locator(".spll-mix-name").inner_text())
        await head.locator(".spll-mix-name").click(); await pg.wait_for_timeout(300)
        print("  click name -> folded:", await ev(pg, "c.mixById('mA').collapsed"), "| item rows:", await pg.locator(".spll-mix-box .spll-lora").count(), "| count:", await head.locator(".spll-count").inner_text())
        await head.locator(".spll-caret").click(); await pg.wait_for_timeout(300)
        print("  caret -> open:", not await ev(pg, "c.mixById('mA').collapsed"), "| item rows:", await pg.locator(".spll-mix-box .spll-lora").count())
        # 4. colour from the name row
        await head.click(button="right", position={"x": 120, "y": 10}); await pg.wait_for_timeout(300)
        await pg.locator(".spll-pmenu-item:has(.spll-pmenu-label:text-is('Colour…'))").click(); await pg.wait_for_timeout(300)
        await pg.locator(".spll-overlay .spll-swatch-btn").nth(2).click(); await pg.wait_for_timeout(300)
        print("4 colour:", await ev(pg, "c.mixById('mA').color"), "| box var:", await ev(pg, "c.el.querySelector('.spll-mix-box').style.getPropertyValue('--spll-mix')"))
        await pg.screenshot(path=OUT+f"190_mix_colour_{TAG}.png", clip={"x":300,"y":50,"width":460,"height":330})
        # 5. Mixes ▸ hover a mix
        await pg.locator(".spll-active .spll-section-title").click(button="right", position={"x": 20, "y": 8}); await pg.wait_for_timeout(300)
        await pg.locator(".spll-pmenu-item:has(.spll-pmenu-label:text-is('Mixes'))").hover(); await pg.wait_for_timeout(400)
        await pg.locator(".spll-pmenu-mix").first.hover(); await pg.wait_for_timeout(500)
        rows = pg.locator(".spll-pmenu.is-mix .spll-pmenu-mixitem")
        print("5 submenu:", await pg.locator(".spll-pmenu.is-mix .spll-pop-title").inner_text(), "| rows:", await rows.count(), "| strengths:", await pg.locator(".spll-pmenu.is-mix .spll-mix-str").all_inner_texts(), "| green:", await pg.locator(".spll-pmenu.is-mix .spll-pmenu-mixitem.is-on").count())
        await pg.screenshot(path=OUT+f"191_mix_submenu_{TAG}.png")
        await rows.nth(1).locator(".spll-result-name").click(); await pg.wait_for_timeout(300)
        print("  click item -> off in mix:", await ev(pg, "!!c.mixItems('mA')[1].off"), "| unsaved:", await ev(pg, "c.mixDirty('mA')"), "| green:", await pg.locator(".spll-pmenu.is-mix .spll-pmenu-mixitem.is-on").count())
        await pg.locator(".spll-pmenu.is-mix .spll-mix-default").click(); await pg.wait_for_timeout(300)
        print("  default colour ->", await ev(pg, "c.mixById('mA').color"))
        await rows.nth(0).locator(".spll-mix-x").click(); await pg.wait_for_timeout(300)
        print("  × -> items:", await ev(pg, "c.mixItems('mA').length"), "| saved items:", await ev(pg, "c.mixById('mA').items.length"), "| submenu rows:", await rows.count())
        await pg.keyboard.press("Escape"); await pg.wait_for_timeout(200)
        # 6. Quick Menu
        btn = pg.locator(".spll-fav-menu-btn")
        print("6 button:", await btn.inner_text())
        await btn.hover(); await pg.wait_for_timeout(900)
        print("  tooltip:", await pg.locator(".spll-tip").last.inner_text() if await pg.locator(".spll-tip").count() else None)
        await pg.mouse.move(1180, 520); await pg.evaluate("() => { const n = window._n; n.setSize([240, n.size[1]]); n.setDirtyCanvas(true,true); }"); await pg.wait_for_timeout(700)
        print("  narrow: icon:", await ev(pg, "!!c.el.querySelector('.spll-section-title.is-narrow .spll-fmb-icon svg')"))
        await btn.hover(); await pg.wait_for_timeout(900)
        print("  narrow tooltip:", await pg.locator(".spll-tip").last.inner_text() if await pg.locator(".spll-tip").count() else None)
        await pg.screenshot(path=OUT+f"192_quick_narrow_{TAG}.png", clip={"x":300,"y":50,"width":300,"height":260})
        await pg.mouse.move(1180, 520); await pg.evaluate("() => { const n = window._n; n.setSize([440, n.size[1]]); n.setDirtyCanvas(true,true); }"); await pg.wait_for_timeout(500)
        # 7. rows control
        await ev(pg, "(c.commit(s => { s.favourites = window._k.slice(0, 3); for (const k of s.favourites) s.favTier[k] = s.tiers[0].id; }), 1)")
        await pg.locator(".spll-active .spll-section-title").click(button="right", position={"x": 20, "y": 8}); await pg.wait_for_timeout(300)
        await pg.locator(".spll-pmenu-item:has(.spll-pmenu-label:text-is('Favourites'))").hover(); await pg.wait_for_timeout(400)
        print("7 3 favourites -> rows control:", await pg.locator(".spll-pmenu .spll-pmenu-rows").count())
        await pg.keyboard.press("Escape")
        await ev(pg, "(c.commit(s => { s.favourites = [...c.files.keys()].slice(0, 6); for (const k of s.favourites) s.favTier[k] = s.tiers[0].id; }), 1)")
        await pg.locator(".spll-active .spll-section-title").click(button="right", position={"x": 20, "y": 8}); await pg.wait_for_timeout(300)
        await pg.locator(".spll-pmenu-item:has(.spll-pmenu-label:text-is('Favourites'))").hover(); await pg.wait_for_timeout(400)
        print("  6 favourites -> rows control:", await pg.locator(".spll-pmenu .spll-pmenu-rows").count()); await pg.keyboard.press("Escape")
        # 8. plain list
        before = await ev(pg, "JSON.stringify(c.state.groups.map(g => g.collapsed))")
        await pg.click(".spll-title-tool[data-act=flat-toggle]"); await pg.wait_for_timeout(400)
        n = await ev(pg, "c.flatPaths().length")
        print("8 title:", await pg.locator(".spll-tree-title .spll-title-text").inner_text(), "| group bars:", await pg.locator(".spll-tree .spll-group").count(), "| tools:", await ev(pg, "[...c.treeTitleEl.querySelectorAll('.spll-title-tool')].map(b => b.dataset.act)"))
        print("  first rows:", await ev(pg, "[...c.treeEl.querySelectorAll('.spll-lora .spll-name')].slice(0,3).map(e => e.firstChild.textContent)"))
        await pg.click(".spll-title-tool[data-act=groups-sort]"); await pg.wait_for_timeout(300)
        await pg.locator(".spll-sort-opt:has-text('Z to A')").click(); await pg.wait_for_timeout(300)
        print("  Z to A first rows:", await ev(pg, "[...c.treeEl.querySelectorAll('.spll-lora .spll-name')].slice(0,3).map(e => e.firstChild.textContent)"), "| groups sort untouched:", await ev(pg, "JSON.stringify(c.state.sorts)"))
        await pg.screenshot(path=OUT+f"193_flat_{TAG}.png", clip={"x":300,"y":50,"width":460,"height":700})
        await pg.click("input.spll-search >> nth=0"); await pg.keyboard.type("pack_119"); await pg.wait_for_timeout(400)
        await pg.locator(".spll-dropdown:not(.spll-gdrop) .spll-result-lora .spll-result-name").first.click(); await pg.wait_for_timeout(600)
        print("  search jump in plain list: visible:", await ev(pg, "(() => { const r = c.treeEl.querySelector('.spll-lora[data-path$=\\'pack_119.safetensors\\']'); if (!r) return false; const a = r.getBoundingClientRect(), t = c.treeEl.getBoundingClientRect(); return a.top >= t.top && a.bottom <= t.bottom; })()"), "| still plain:", await ev(pg, "c.isFlat()"))
        await pg.mouse.move(1180, 520); await pg.wait_for_timeout(500)
        await pg.click(".spll-title-tool[data-act=flat-toggle]"); await pg.wait_for_timeout(400)
        print("  back to groups: same open/closed:", before == await ev(pg, "JSON.stringify(c.state.groups.map(g => g.collapsed))"), "| title:", await pg.locator(".spll-tree-title .spll-title-text").inner_text())
        if not VUE:
            await pg.evaluate("async () => { await window.comfyAPI.app.app.extensionManager.setting.set('Comfy.VueNodes.Enabled', true); }")
        print("ERRORS", errs(logs)[:6])
        await b.close()
asyncio.run(main())
