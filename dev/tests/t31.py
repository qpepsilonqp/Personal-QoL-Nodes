import asyncio, json
from common import *
S = "() => window._n.spll.state"
SOFT = "b1:styles/anime/anime_soft.safetensors"; BOLD = "b1:styles/anime/anime_bold.safetensors"
def row(p, where="tree"): return f".spll-lora[data-where={where}][data-path='{p}']"
async def main():
    logs=[]
    async with async_playwright() as p:
        b = await p.chromium.launch()
        ctx = await b.new_context(viewport={"width":1500,"height":1100}, permissions=["clipboard-read","clipboard-write"])
        pg = await ctx.new_page()
        pg.on("console", lambda m: logs.append(f"{m.type}: {m.text}")); pg.on("pageerror", lambda e: logs.append(f"PAGEERROR: {e}"))
        await pg.goto("http://127.0.0.1:8188/"); await pg.wait_for_function("window.comfyAPI && window.comfyAPI.app && window.comfyAPI.app.app.graph", timeout=60000)
        await pg.wait_for_timeout(2500); await pg.keyboard.press("Escape")
        await pg.evaluate(SETUP); await pg.wait_for_timeout(1500)
        await choose_root(pg)
        # 1 search toggle keeps dropdown open
        await pg.fill(".spll-search", "anime"); await pg.wait_for_timeout(300)
        await pg.click(f".spll-dropdown .spll-result-lora[data-path='{SOFT}'] .spll-switch")
        await pg.wait_for_timeout(300)
        st = await pg.evaluate(S)
        print("1 toggled from search:", [a["path"] for a in st["active"]], "| dropdown open:", await pg.locator(".spll-dropdown:not(.spll-gdrop)").is_visible())
        await pg.click(".spll-search-clear"); await pg.wait_for_timeout(200)
        # 2 single click on active name jumps; dblclick doesn't edit
        await pg.click(row(SOFT,"active")+" .spll-name"); await pg.wait_for_timeout(500)
        print("2 jumped (row in tree visible + flashing):", await pg.locator(row(SOFT)+".is-flash").count() == 1)
        await pg.dblclick(row(SOFT)+" .spll-name"); await pg.wait_for_timeout(300)
        print("3 dblclick no editor:", await pg.locator(".spll-name-edit").count() == 0)
        # 4 star
        await pg.click(row(BOLD)+" .spll-star"); await pg.wait_for_timeout(150); await pg.keyboard.press("Escape"); await pg.wait_for_timeout(200)
        print("4 favourites:", (await pg.evaluate(S))["favourites"], "| star:", await pg.locator(row(BOLD)+" .spll-star").inner_text())
        # 5 switch off -> history
        await pg.click(row(SOFT,"active")+" .spll-switch"); await pg.wait_for_timeout(200)
        print("5 history:", (await pg.evaluate(S))["history"])
        # 6 right-click active empty area -> menu
        ab = await pg.locator(".spll-active-list").bounding_box()
        await pg.mouse.click(ab["x"]+ab["width"]/2, ab["y"]+ab["height"]/2, button="right"); await pg.wait_for_timeout(300)
        print("6 menu items:", await pg.locator(".spll-pmenu-item").all_inner_texts())
        await pg.hover(".spll-pmenu-item:has-text('Favourites')"); await pg.wait_for_timeout(400)
        print("  fav submenu:", [t.replace("\n"," ") for t in await pg.locator(".spll-pmenu-sub .spll-pmenu-lora").all_inner_texts()])
        await pg.screenshot(path=OUT+"41_favmenu.png")
        # phase 14: the Rows control only shows once a list has 5 or more rows
        print("  rows control with", await pg.locator(".spll-pmenu-sub .spll-pmenu-lora").count(), "favourites:", await pg.locator(".spll-pmenu-sub [data-sact=rows-inc]").count())
        await pg.click(f".spll-pmenu-sub .spll-pmenu-lora[data-path='{BOLD}'] .spll-result-name"); await pg.wait_for_timeout(200)
        print("  toggled from favourites:", [a["path"] for a in (await pg.evaluate(S))["active"]])
        # move diagonally to History (grace period) and open it
        await pg.hover(".spll-pmenu-item:has-text('History')"); await pg.wait_for_timeout(450)
        print("  history submenu:", [t.replace("\n"," ") for t in await pg.locator(".spll-pmenu-sub .spll-pmenu-lora").all_inner_texts()])
        await pg.click(f".spll-pmenu-sub .spll-pmenu-lora[data-path='{SOFT}']", button="right"); await pg.wait_for_timeout(200); await pg.locator(".spll-pmenu").last.locator(".spll-pmenu-item:has-text('Show in groups')").click(); await pg.wait_for_timeout(400)
        print("  menu closed after jump:", await pg.locator(".spll-pmenu").count() == 0)
        # 7 right-click on an active row
        await pg.click(row(BOLD,"active")+" .spll-name", button="right"); await pg.wait_for_timeout(300)
        print("7 row menu:", await pg.locator(".spll-pmenu > .spll-pmenu-item").all_inner_texts())
        await pg.keyboard.press("Escape"); await pg.wait_for_timeout(200)
        print("  esc closed:", await pg.locator(".spll-pmenu").count() == 0, "| node alive:", await pg.evaluate("() => !!window.comfyAPI.app.app.graph.getNodeById(window._n.id)"))
        # 8 history off / clear
        await pg.click(".spll-gear >> visible=true"); await pg.wait_for_timeout(300)
        await pg.screenshot(path=OUT+"42_settings.png")
        await pg.click(".spll-tab:text-is('Lists')"); await pg.click("[data-act=clear-history]"); await pg.wait_for_timeout(200)
        await pg.click("[data-act=set-history-off]"); await pg.wait_for_timeout(200)
        await pg.click(".spll-sheet [data-act=close]"); await pg.wait_for_timeout(200)
        await pg.click(row(BOLD,"active")+" .spll-switch"); await pg.wait_for_timeout(200)
        st = await pg.evaluate(S)
        print("8 history after clear+off+switch-off:", st["history"], "len setting", st["settings"]["historyLength"])
        # undo restores the star removal? test undo of favourite
        await pg.click(row(BOLD)+" .spll-star"); await pg.wait_for_timeout(150); await pg.keyboard.press("Escape"); await pg.wait_for_timeout(200)
        await pg.mouse.click(1300, 800); await pg.keyboard.press("Control+z"); await pg.wait_for_timeout(1500)
        st = await pg.evaluate("() => window.comfyAPI.app.app.graph.nodes.find(n=>n.comfyClass==='SuperPowerLoraLoader').spll.state")
        print("9 undo restored favourite:", st["favourites"])
        print("ERRORS", errs(logs)[:6])
        await b.close()
asyncio.run(main())
