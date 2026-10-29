import asyncio, json
from common import *
TREE = "() => { const t=document.querySelector('.spll-tree'); return [t.clientHeight, t.scrollTop] }"
async def main():
    logs=[]
    async with async_playwright() as p:
        b, pg = await open_page(p, logs)
        await pg.evaluate(SETUP); await pg.wait_for_timeout(1500)
        await choose_root(pg)
        print("node size:", await pg.evaluate("() => window._n.size"), "tree [h, scroll]:", await pg.evaluate(TREE), "rows ≈", round((await pg.evaluate(TREE))[0]/26,1))
        await pg.click(".spll-group:has(.spll-gname:text-is('bulk')) .spll-caret"); await pg.wait_for_timeout(300)
        box = pg.locator(".spll-box[data-box] .spll-box-scroll").first
        bb = await box.bounding_box(); print("bulk box height:", bb["height"])
        await pg.mouse.move(bb["x"]+80, bb["y"]+100)
        for _ in range(3): await pg.mouse.wheel(0, 250); await pg.wait_for_timeout(120)
        print("box scrollTop:", await box.evaluate("e => e.scrollTop"), "| outer:", await pg.evaluate(TREE), "| canvas scale", await pg.evaluate("() => window.comfyAPI.app.app.canvas.ds.scale"))
        # nested indentation
        for g in ["styles","anime","painterly","concepts","cyberpunk"]:
            await pg.click(f".spll-group:has(.spll-gname:text-is('{g}')) .spll-caret"); await pg.wait_for_timeout(150)
        await pg.screenshot(path=OUT+"25_boxes.png")
        # search reveal deep inside bulk box
        await pg.fill(".spll-search", "pack_100"); await pg.wait_for_timeout(300)
        await pg.click(".spll-dropdown .spll-result-lora"); await pg.wait_for_timeout(500)
        vis = await pg.evaluate("""() => { const r=document.querySelector(".spll-lora[data-path='b1:bulk/pack_100.safetensors']"); if(!r) return 'not rendered';
            const b=r.getBoundingClientRect(), t=document.querySelector('.spll-tree').getBoundingClientRect(), x=r.closest('.spll-box-scroll').getBoundingClientRect();
            return {inTree: b.top>=t.top && b.bottom<=t.bottom, inBox: b.top>=x.top-1 && b.bottom<=x.bottom+1, flash: r.classList.contains('is-flash')} }""")
        print("reveal pack_100:", vis)
        await pg.screenshot(path=OUT+"26_reveal_box.png")
        # resize node taller -> tree grows
        h0 = (await pg.evaluate(TREE))[0]
        await pg.evaluate("() => { window._n.setSize([window._n.size[0], window._n.size[1]+260]); window._n.setDirtyCanvas(true,true) }"); await pg.wait_for_timeout(600)
        print("tree height after resize:", h0, "->", (await pg.evaluate(TREE))[0])
        # unlimited
        await pg.evaluate("() => window._n.spll.settingsTab = 'display'"); await pg.click(".spll-gear >> visible=true"); await pg.click(".spll-check input"); await pg.click(".spll-sheet [data-act=close]"); await pg.wait_for_timeout(500)
        print("unlimited: bulk box height", (await pg.locator(".spll-box[data-box] .spll-box-scroll").first.bounding_box() or {}).get("height"), "outer scrollHeight", await pg.evaluate("() => document.querySelector('.spll-tree').scrollHeight"))
        await pg.screenshot(path=OUT+"27_unlimited.png")
        print("ERRORS", errs(logs)[:6])
        await b.close()
asyncio.run(main())
