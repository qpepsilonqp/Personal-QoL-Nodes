import asyncio, sys
from common import *
VUE = sys.argv[1] != "classic" if len(sys.argv) > 1 else True
TAG = 'vue' if VUE else 'classic'
async def ev(pg, js): return await pg.evaluate(f"() => {{ const c = window._n.spll; return {js}; }}")
NAMES = "(id) => c.mixItems(id).map(i => i.path.split('/').pop().replace('.safetensors','') + '@' + i.strength).join(',')"
async def mix(pg, id): return await ev(pg, f"({NAMES})('{id}')")
async def loose(pg): return await ev(pg, "c.state.active.map(a => a.mix ? '['+a.mix+']' : a.path.split('/').pop().replace('.safetensors','') + '@' + a.strength).join(', ')")
async def drag(pg, src, dst, dy=0.5, shot=None):
    a = await src.locator(".spll-name, .spll-mix-name").first.bounding_box(); b = await dst.bounding_box()
    await pg.mouse.move(a["x"] + 10, a["y"] + a["height"]/2); await pg.mouse.down(); await pg.wait_for_timeout(600)
    await pg.mouse.move(b["x"] + 40, b["y"] + b["height"]*dy, steps=10); await pg.wait_for_timeout(250)
    if shot: await pg.screenshot(path=OUT+shot, clip={"x":300,"y":50,"width":440,"height":520})
    await pg.mouse.up(); await pg.wait_for_timeout(500)
async def main():
    logs=[]
    async with async_playwright() as p:
        b, pg = await open_page(p, logs)
        if not VUE:
            await pg.evaluate("async () => { await window.comfyAPI.app.app.extensionManager.setting.set('Comfy.VueNodes.Enabled', false); }")
            await pg.reload(); await pg.wait_for_function("window.comfyAPI && window.comfyAPI.app && window.comfyAPI.app.app.graph", timeout=60000); await pg.wait_for_timeout(2500); await pg.keyboard.press("Escape")
        await pg.evaluate(SETUP); await pg.wait_for_timeout(1500)
        await choose_root(pg); await pg.wait_for_timeout(1500)
        await pg.evaluate("""() => { const c = window._n.spll; window._n.setSize([440, 760]);
          const ks = [...c.files.keys()].filter(k => k.includes('characters/')).sort(); window._k = ks;  // detail_v2, hero_a, villain_b
          const con = [...c.files.keys()].filter(k => k.includes('concepts/')).sort(); window._c = con;
          c.commit(s => { for (const g of s.groups) g.collapsed = !['characters'].includes(g.name);
            s.mixes.push({ id: 'mA', name: 'Alpha', items: [{ path: con[0], strength: 0.5 }, { path: con[1], strength: 0.6 }], added: 1 });
            s.mixes.push({ id: 'mB', name: 'Beta', items: [{ path: con[2], strength: 0.4 }], added: 2 });
            s.active.push({ path: ks[1], strength: 0.8 }, { mix: 'mA', on: true, since: 1 }, { mix: 'mB', on: false, since: 0 }); });
          c.setStrength(ks[2], 0.7); }"""); await pg.wait_for_timeout(500)
        A = lambda: pg.locator(".spll-mix-box[data-mixid='mA']")
        B = lambda: pg.locator(".spll-mix-box[data-mixid='mB']")
        print("0", await loose(pg), "| A:", await mix(pg, "mA"), "| B:", await mix(pg, "mB"))
        # a. from GROUPS into Alpha, before its first LoRA
        await drag(pg, pg.locator(".spll-tree .spll-lora[data-path$='villain_b.safetensors']"), A().locator(".spll-lora").first, 0.25, f"180_drop_marker_{TAG}.png")
        print("a groups -> A:", await mix(pg, "mA"), "| saved:", await ev(pg, "!c.mixDirty('mA')"))
        # b. from ENABLED into Beta: moves
        await drag(pg, pg.locator(".spll-active-list > .spll-lora[data-path$='hero_a.safetensors']"), B().locator(".spll-lora").first, 0.75)
        print("b ENABLED -> B:", await mix(pg, "mB"), "| ENABLED:", await loose(pg), "| hero group strength:", await ev(pg, "c.strengthOf(window._k[1])"))
        # c. already in: note, nothing changes
        await drag(pg, pg.locator(".spll-tree .spll-lora[data-path$='villain_b.safetensors']"), A().locator(".spll-lora").last, 0.5)
        print("c again -> A:", await mix(pg, "mA"), "| toast:", await pg.locator("text=Already in this mix").count())
        # d. reorder inside Alpha: first to the end
        await drag(pg, A().locator(".spll-lora").first, A().locator(".spll-lora").last, 0.8)
        print("d reorder A:", await mix(pg, "mA"), "| saved straight away:", await ev(pg, "!c.mixDirty('mA') && c.mixById('mA').items[2].path.endsWith('villain_b.safetensors')"))
        # e. from Alpha into Beta: copies
        await drag(pg, A().locator(".spll-lora").first, B().locator(".spll-mix-head"), 0.7)
        print("e A -> B copy:", await mix(pg, "mB"), "| A kept:", await mix(pg, "mA"))
        # f. out of Alpha into ENABLED (Alpha is on): on by itself, Alpha's copy greyed
        bb = await B().bounding_box()
        a = await A().locator(".spll-lora").nth(1).locator(".spll-name").bounding_box()
        await pg.mouse.move(a["x"]+10, a["y"]+a["height"]/2); await pg.mouse.down(); await pg.wait_for_timeout(600)
        await pg.mouse.move(bb["x"]+60, bb["y"]+2, steps=10); await pg.wait_for_timeout(250)
        await pg.screenshot(path=OUT+f"182_out_marker_{TAG}.png", clip={"x":300,"y":50,"width":440,"height":520})
        await pg.mouse.up(); await pg.wait_for_timeout(500)
        print("f out of A -> ENABLED:", await loose(pg), "| A:", await mix(pg, "mA"), "| greyed in A:", await ev(pg, "[...c.el.querySelectorAll('.spll-mix-box[data-mixid=mA] .spll-lora.is-other')].map(r => r.dataset.path.split('/').pop())"))
        print("  loads:", await ev(pg, "c.promptValue().loras.map(l => l.path.split('/').pop() + '@' + l.strength).join(', ')"))
        # g. switching on by itself while a mix loads it: allowed
        p0 = await ev(pg, "c.mixItems('mA').find(i => !c.isActive(i.path)).path")
        await ev(pg, f"(c.setActive('{p0}', true), 1)"); await pg.wait_for_timeout(300)
        print("g switched on by itself:", await ev(pg, f"c.isActive('{p0}')"), "| greyed now:", await pg.locator(".spll-mix-box[data-mixid='mA'] .spll-lora.is-other").count())
        await ev(pg, f"(c.setActive('{p0}', false), 1)"); await pg.wait_for_timeout(300)
        print("  off again -> greyed:", await pg.locator(".spll-mix-box[data-mixid='mA'] .spll-lora.is-other").count())
        await pg.screenshot(path=OUT+f"181_after_{TAG}.png", clip={"x":300,"y":50,"width":440,"height":520})
        if not VUE:
            await pg.evaluate("async () => { await window.comfyAPI.app.app.extensionManager.setting.set('Comfy.VueNodes.Enabled', true); }")
        print("ERRORS", errs(logs)[:6])
        await b.close()
asyncio.run(main())
