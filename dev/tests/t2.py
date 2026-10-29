import asyncio, json
from common import *
async def main():
    logs=[]
    async with async_playwright() as p:
        b, pg = await open_page(p, logs)
        await pg.evaluate(SETUP)
        await pg.wait_for_timeout(1500)
        await choose_root(pg)
        await pg.wait_for_timeout(1500)
        await pg.screenshot(path=OUT+"02_main.png")
        # expand styles group and anime
        await pg.click(".spll-group:has(.spll-gname:text-is('styles')) .spll-caret")
        await pg.wait_for_timeout(300)
        await pg.click(".spll-group:has(.spll-gname:text-is('anime')) .spll-caret")
        await pg.wait_for_timeout(300)
        # toggle anime_soft on, bump strength twice
        row = ".spll-lora[data-where=tree][data-path='b1:styles/anime/anime_soft.safetensors']"
        await pg.click(row+" .spll-switch")
        await pg.click(row+" [data-act=inc]"); await pg.click(row+" [data-act=inc]")
        # toggle detail_v2 (root) — in Unsorted
        await pg.click(".spll-group:has(.spll-gname:text-is('Unsorted')) .spll-caret")
        r2 = ".spll-lora[data-where=tree][data-path='b1:detail_v2.safetensors']"
        await pg.click(r2+" .spll-switch")
        # type a strength
        await pg.click(r2+" .spll-num"); await pg.keyboard.type("-0.4"); await pg.keyboard.press("Enter")
        await pg.wait_for_timeout(400)
        await pg.screenshot(path=OUT+"03_active.png")
        st = await pg.evaluate("() => window._n.spll.state")
        print("ACTIVE", st["active"])
        # Delete key inside search must not delete the node
        await pg.click(".spll-search"); await pg.keyboard.type("anime")
        await pg.keyboard.press("Backspace"); await pg.keyboard.press("Delete")
        await pg.keyboard.press("Control+a")
        await pg.keyboard.type("paint")
        await pg.wait_for_timeout(400)
        await pg.screenshot(path=OUT+"04_search.png")
        alive = await pg.evaluate("() => !!window.comfyAPI.app.app.graph.getNodeById(window._n.id)")
        print("NODE ALIVE after Delete/Backspace/Ctrl+A in search:", alive)
        # click group result -> reveal
        await pg.click(".spll-dropdown .spll-result-group")
        await pg.wait_for_timeout(500)
        await pg.screenshot(path=OUT+"05_reveal.png")
        # group search inside bulk
        await pg.click(".spll-search-clear")
        await pg.hover(".spll-group:has(.spll-gname:text-is('bulk')) .spll-gsearch-icon"); await pg.wait_for_timeout(300)
        await pg.fill(".spll-group:has(.spll-gname:text-is('bulk')) .spll-gsearch", "01")
        await pg.wait_for_timeout(400)
        await pg.screenshot(path=OUT+"06_gsearch.png")
        # run the prompt
        open("/tmp/spll_calls.jsonl","w").close()
        await pg.evaluate("() => window.comfyAPI.app.app.queuePrompt(0)")
        await pg.wait_for_timeout(4000)
        print("CALLS", open("/tmp/spll_calls.jsonl").read())
        print("ERRORS", errs(logs)[:10])
        await b.close()
asyncio.run(main())
