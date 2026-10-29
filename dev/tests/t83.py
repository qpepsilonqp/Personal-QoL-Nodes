import asyncio, sys
from common import *
VUE = sys.argv[1] != "classic" if len(sys.argv) > 1 else True
TAG = 'vue' if VUE else 'classic'
async def ev(pg, js): return await pg.evaluate(f"() => {{ const c = window._n.spll; return {js}; }}")
def grp(n): return f".spll-tree .spll-group:has(.spll-gname:text-is('{n}'))"
LOAD = "c.promptValue().loras.map(l => l.path.split('/').pop().replace('.safetensors','') + '@' + l.strength).join(', ')"
async def prompt_answer(pg, text):
    dlg = pg.locator("[role=dialog]:not(.spll-modal)").last
    await dlg.wait_for(timeout=5000)
    inp = dlg.locator("input").first
    await inp.fill(text); await inp.press("Enter"); await pg.wait_for_timeout(500)
async def menu_click(pg, label):
    await pg.locator(f'.spll-pmenu-item:has(.spll-pmenu-label:text-is("{label}"))').last.click(); await pg.wait_for_timeout(300)
async def menu_hover(pg, label):
    await pg.locator(f".spll-pmenu-item:has(.spll-pmenu-label:text-is('{label}'))").last.hover(); await pg.wait_for_timeout(400)
async def main():
    logs=[]
    async with async_playwright() as p:
        b, pg = await open_page(p, logs)
        if not VUE:
            await pg.evaluate("async () => { await window.comfyAPI.app.app.extensionManager.setting.set('Comfy.VueNodes.Enabled', false); }")
            await pg.reload(); await pg.wait_for_function("window.comfyAPI && window.comfyAPI.app && window.comfyAPI.app.app.graph", timeout=60000); await pg.wait_for_timeout(2500); await pg.keyboard.press("Escape")
        await pg.evaluate(SETUP); await pg.wait_for_timeout(1500)
        await choose_root(pg); await pg.wait_for_timeout(1500)
        await pg.evaluate("() => { const c = window._n.spll; c.commit(s => { for (const g of s.groups) g.collapsed = !['characters'].includes(g.name); }); const ks = [...c.files.keys()].filter(k => k.includes('characters/')).sort(); window._k = ks; c.setActive(ks[1], true); c.setStrength(ks[1], 0.8); c.setActive(ks[2], true); }"); await pg.wait_for_timeout(300)
        print("0 loads:", await ev(pg, LOAD))
        # 1. right-click a LoRA in ENABLED -> Add to mix -> New mix…
        await pg.locator(".spll-active-list .spll-lora >> nth=0").click(button="right"); await pg.wait_for_timeout(300)
        await menu_hover(pg, "Add to mix"); await menu_click(pg, "New mix…")
        await prompt_answer(pg, "Heroes")
        print("1 mixes:", await ev(pg, "JSON.stringify(c.state.mixes.map(m => [m.name, m.items.map(i => i.strength)]))"),
              "| box at bottom:", await ev(pg, "c.state.active.map(a => a.mix ? 'MIX' : 'L').join(',')"),
              "| switch red:", await pg.locator(".spll-mix-head .spll-switch.is-red").count(), "| state:", await pg.locator(".spll-mix-state").inner_text())
        # 2. tree right-click -> Add to mix ▸ -> Heroes (in-node menu)
        await pg.locator(".spll-tree .spll-lora >> nth=2").click(button="right"); await pg.wait_for_timeout(300)
        await pg.locator(".spll-menu-item:text-is('Add to mix ▸')").click(); await pg.wait_for_timeout(300)
        print("2 in-node list:", await pg.locator(".spll-overlay .spll-menu-item").all_inner_texts())
        await pg.locator(".spll-menu-item:text-is('Heroes')").click(); await pg.wait_for_timeout(300)
        print("  mix items:", await ev(pg, "c.state.mixes[0].items.length"), "| loads still:", await ev(pg, LOAD))
        # ticked in the menu now
        await pg.locator(".spll-tree .spll-lora >> nth=2").click(button="right"); await pg.wait_for_timeout(300)
        await pg.locator(".spll-menu-item:text-is('Add to mix ▸')").click(); await pg.wait_for_timeout(300)
        print("  ticked:", await pg.locator(".spll-overlay .spll-menu-item").all_inner_texts()); await ev(pg, "c.closeOverlay()"); await pg.wait_for_timeout(200)
        await pg.screenshot(path=OUT+f"140_mix_off_{TAG}.png", clip={"x":300,"y":50,"width":460,"height":360})
        # 3. switch the mix on: clash warning
        await pg.click(".spll-mix-head .spll-switch")
        txt, _ = await confirm(pg, accept=False, shot=f"141_clash_{TAG}.png")
        print("3 warning:", txt.replace("\n", " | ")[:200])
        print("  No -> mix on?", await ev(pg, "c.state.active.find(a => a.mix).on"), "| loads:", await ev(pg, LOAD))
        await pg.click(".spll-mix-head .spll-switch"); await confirm(pg, accept=True)
        print("  Yes -> loads:", await ev(pg, LOAD), "| loose left:", await ev(pg, "c.state.active.filter(a => a.path).length"), "| title:", await pg.locator(".spll-active .spll-section-title span >> nth=0").inner_text())
        # 4. edit in the box: unsaved
        await pg.locator(".spll-mix-box .spll-lora >> nth=0").locator("[data-act=inc]").click(); await pg.wait_for_timeout(200)
        print("4 after +:", await pg.locator(".spll-mix-state").inner_text(), "| loads:", await ev(pg, LOAD), "| saved:", await ev(pg, "c.state.mixes[0].items[0].strength"))
        await pg.locator(".spll-mix-box .spll-lora >> nth=1").locator(".spll-switch").click(); await pg.wait_for_timeout(200)
        print("  item off -> loads:", await ev(pg, LOAD))
        # unsaved kept across mix off/on and a workflow reload
        await pg.click(".spll-mix-head .spll-switch"); await pg.wait_for_timeout(200)
        print("  mix off -> loads:", await ev(pg, LOAD) or "(nothing)", "| still in ENABLED:", await pg.locator(".spll-mix-box.is-off").count(), "| unsaved:", await pg.locator(".spll-mix-state").inner_text())
        await pg.click(".spll-mix-head .spll-switch"); await pg.wait_for_timeout(300)
        await pg.evaluate("() => { const app = window.comfyAPI.app.app; const g = app.graph.serialize(); app.loadGraphData(g); }"); await pg.wait_for_timeout(2500)
        await pg.evaluate("() => { window._n = window.comfyAPI.app.app.graph._nodes.find(n => n.type === 'SuperPowerLoraLoader'); }")
        print("  reloaded -> unsaved:", await pg.locator(".spll-mix-state").inner_text(), "| loads:", await ev(pg, LOAD))
        await pg.locator(".spll-mix-box").click(button="right", position={"x": 60, "y": 10}); await pg.wait_for_timeout(300)
        print("  box menu:", await pg.locator(".spll-pmenu .spll-pmenu-label").all_inner_texts())
        await menu_click(pg, "Revert")
        print("  Revert -> ", await pg.locator(".spll-mix-state").inner_text(), "| loads:", await ev(pg, LOAD))
        await pg.locator(".spll-mix-box .spll-lora >> nth=0").locator("[data-act=dec]").click(); await pg.wait_for_timeout(200)
        await pg.click(".spll-mix-save"); await pg.wait_for_timeout(200)
        print("  Save -> ", await pg.locator(".spll-mix-state").inner_text(), "| saved:", await ev(pg, "c.state.mixes[0].items[0].strength"))
        # 5. a second mix sharing a LoRA: no warning, its copy greyed
        await ev(pg, "(c.commit(s => { s.mixes.push({ id: 'm9', name: 'Villains', items: [{ path: window._k[2], strength: 0.3 }, { path: window._k[0], strength: 0.6 }], added: 1 }); s.active.push({ mix: 'm9', on: false, since: 0 }); }), 1)")
        await pg.locator(".spll-mix-box >> nth=1").locator(".spll-mix-head .spll-switch").click(); await pg.wait_for_timeout(500)
        print("5 dialogs:", await pg.locator("[role=dialog]:not(.spll-modal)").count(), "| loads:", await ev(pg, LOAD), "| greyed:", await pg.locator(".spll-lora.is-other").count())
        await pg.screenshot(path=OUT+f"142_two_mixes_{TAG}.png", clip={"x":300,"y":50,"width":460,"height":420})
        await pg.locator(".spll-mix-box >> nth=1").locator(".spll-lora.is-other").click(button="right"); await pg.wait_for_timeout(300)
        await menu_click(pg, "Use this mix's copy")
        print("  swapped -> loads:", await ev(pg, LOAD), "| greyed now in box:", await ev(pg, "[...c.el.querySelectorAll('.spll-lora.is-other')].map(r => r.dataset.mix)"))
        await pg.locator(".spll-mix-box >> nth=1").locator(".spll-mix-head .spll-switch").click(); await pg.wait_for_timeout(300)
        print("  Villains off -> loads:", await ev(pg, LOAD), "| greyed:", await pg.locator(".spll-lora.is-other").count())
        # 6. Mixes ▸
        await pg.locator(".spll-active .spll-section-title").click(button="right", position={"x": 20, "y": 8}); await pg.wait_for_timeout(300)
        await menu_hover(pg, "Mixes")
        print("6 mixes rows:", await pg.locator(".spll-pmenu-mix .spll-result-name").all_inner_texts(), "| green:", await pg.locator(".spll-pmenu-mix.is-on").count())
        await pg.screenshot(path=OUT+f"143_mixes_menu_{TAG}.png")
        await pg.locator(".spll-pmenu-mix:has-text('Villains')").click(); await pg.wait_for_timeout(300)
        print("  click -> removed:", await ev(pg, "!c.mixEntry('m9')"), "| green:", await pg.locator(".spll-pmenu-mix.is-on").count())
        await pg.locator(".spll-pmenu-mix:has-text('Villains')").click(); await pg.wait_for_timeout(400)
        print("  click again -> in, on:", await ev(pg, "c.mixEntry('m9')?.on"), "| at bottom:", await ev(pg, "c.state.active.at(-1).mix"), "| loads:", await ev(pg, LOAD))
        await pg.locator(".spll-pmenu-mix:has-text('Heroes') .spll-mix-apply").click(); await pg.wait_for_timeout(400)
        print("  apply Heroes as regular -> Heroes on:", await ev(pg, "c.mixEntry(c.state.mixes[0].id).on"), "| loose:", await ev(pg, "c.state.active.filter(a => a.path).map(a => a.strength)"), "| loads:", await ev(pg, LOAD))
        await pg.keyboard.press("Escape")
        # 7. drag the Villains box to the top
        hb = await pg.locator(".spll-mix-box >> nth=1").locator(".spll-mix-name").bounding_box()
        tb = await pg.locator(".spll-active-list > [data-akey] >> nth=0").bounding_box()
        await pg.mouse.move(hb["x"] + 20, hb["y"] + 8); await pg.mouse.down(); await pg.wait_for_timeout(700)
        await pg.mouse.move(tb["x"] + 60, tb["y"] + 3, steps=8); await pg.wait_for_timeout(300); await pg.mouse.up(); await pg.wait_for_timeout(500)
        print("7 order after drag:", await ev(pg, "c.state.active.map(a => a.mix || a.path.split('/').pop()).join(', ')"))
        # 8. remove from ENABLED via the name row, delete
        await pg.locator(".spll-mix-head:has-text('Heroes')").click(button="right"); await pg.wait_for_timeout(300)
        await menu_click(pg, "Remove from ENABLED")
        print("8 Heroes out of ENABLED:", await ev(pg, "!c.mixEntry(c.state.mixes[0].id)"), "| still a mix:", await ev(pg, "c.state.mixes.length"))
        # 9. narrow
        await pg.evaluate("() => { const n = window._n; n.setSize([250, n.size[1]]); n.setDirtyCanvas(true,true); }"); await pg.wait_for_timeout(700)
        await pg.screenshot(path=OUT+f"144_mix_narrow_{TAG}.png", clip={"x":300,"y":50,"width":320,"height":380})
        print("9 narrow mix rows compact:", await pg.locator(".spll-mix-box .spll-num-compact").all_inner_texts())
        if not VUE:
            await pg.evaluate("async () => { await window.comfyAPI.app.app.extensionManager.setting.set('Comfy.VueNodes.Enabled', true); }")
        print("ERRORS", errs(logs)[:6])
        await b.close()
asyncio.run(main())
