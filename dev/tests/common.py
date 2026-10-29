import asyncio
from playwright.async_api import async_playwright
OUT = "/tmp/claude-0/-home-claude/e897f8a8-a348-51cc-97e6-4ddb691667bd/scratchpad/shots/"
SETUP = """() => {
  const app = window.comfyAPI.app.app; const LG = window.LiteGraph || window.comfyAPI.litegraph?.LiteGraph;
  app.graph.clear();
  const fm = LG.createNode('SPLLFakeModel'); fm.pos=[40,200]; app.graph.add(fm);
  const n = LG.createNode('SuperPowerLoraLoader'); n.pos=[320,100]; app.graph.add(n);
  const s = LG.createNode('SPLLSink'); s.pos=[1000,200]; app.graph.add(s);
  fm.connect(0, n, 0); n.connect(0, s, 0);
  window._n = n;
  app.canvas.ds.offset=[0,0]; app.canvas.ds.scale=1; app.canvas.setDirty(true,true);
}"""
async def open_page(p, logs):
    b = await p.chromium.launch()
    pg = await b.new_page(viewport={"width": 1500, "height": 1100})
    pg.on("console", lambda m: logs.append(f"{m.type}: {m.text}"))
    pg.on("pageerror", lambda e: logs.append(f"PAGEERROR: {e}"))
    await pg.goto("http://127.0.0.1:8188/")
    await pg.wait_for_function("window.comfyAPI && window.comfyAPI.app && window.comfyAPI.app.app.graph", timeout=60000)
    await pg.wait_for_timeout(2500)
    await pg.keyboard.press("Escape")
    return b, pg
async def confirm(pg, accept=True, shot=None):
    dlg = pg.locator("[role=dialog]:not(.spll-modal)").last
    await dlg.wait_for(timeout=5000)
    if shot: await pg.screenshot(path=OUT+shot)
    txt = await dlg.inner_text()
    btns = dlg.locator("button")
    labels = [await btns.nth(i).inner_text() for i in range(await btns.count())]
    want = ["Confirm","Yes","OK","Ok"] if accept else ["Cancel","No"]
    for i,l in enumerate(labels):
        if l.strip() in want:
            await btns.nth(i).click(); await pg.wait_for_timeout(400); return txt, labels
    raise Exception(f"no button among {labels}")
def errs(logs):
    return [l for l in logs if ("PAGEERROR" in l or ("error" in l.lower() and "404" not in l and "TUNNEL" not in l))]
OLD = "/root/old_comfy/models/loras"
async def choose_root(pg, base=OLD, rel=""):
    # phase 4 setup: tick the folder, then Add
    await pg.click(f".spll-picker-check[data-sel='folder|{base}|{rel}']")
    await pg.click(".spll-picker [data-act=picker-use]")
    await pg.wait_for_timeout(1400)
