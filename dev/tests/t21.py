import asyncio, json
from common import *
STATE = {"v":1,"base":"/root/old_comfy/models/loras","root":"styles","settings":{"dropdownRows":8,"listHeight":12},
 "groups":[],"knownFolders":[],"placements":{},
 "active":[{"path":"styles/anime/deleted_one.safetensors","strength":1.0}],"strengths":{},
 "ids":{"styles/anime/deleted_one.safetensors":{"h":"ab"*32,"m":404,"v":888}}}
async def main():
    logs=[]
    async with async_playwright() as p:
        b, pg = await open_page(p, logs)
        await pg.evaluate(SETUP); await pg.wait_for_timeout(800)
        wf = await pg.evaluate("() => window.comfyAPI.app.app.graph.serialize()")
        for n in wf["nodes"]:
            if n["type"]=="SuperPowerLoraLoader": n["widgets_values"]=[STATE]; n.pop("widgets_values_named", None)
        await pg.evaluate("(wf) => window.comfyAPI.app.app.loadGraphData(wf)", wf); await pg.wait_for_timeout(2000)
        await pg.evaluate("() => { window._n = window.comfyAPI.app.app.graph.nodes.find(n=>n.comfyClass==='SuperPowerLoraLoader') }")
        st = await pg.evaluate("() => window._n.spll.state")
        print("after load: active", st["active"], "| ids kept:", list(st["ids"].keys()), "| strengths", st["strengths"])
        await pg.click(".spll-group:has(.spll-gname:text-is('anime')) .spll-caret"); await pg.wait_for_timeout(300)
        row = ".spll-lora[data-where=tree][data-path='b1:styles/anime/deleted_one.safetensors']"
        print("T class:", await pg.locator(row+" .spll-trig").get_attribute("class"), "| i lit:", await pg.locator(row+" .spll-info").get_attribute("class"))
        await pg.click(row+" .spll-info"); await pg.wait_for_timeout(1500)
        print("rows:", [r.replace("\n"," ") for r in await pg.locator(".spll-info-table tr").all_inner_texts()])
        await pg.screenshot(path=OUT+"37_missing_panel.png")
        print("ERRORS", errs(logs)[:6])
        await b.close()
asyncio.run(main())
