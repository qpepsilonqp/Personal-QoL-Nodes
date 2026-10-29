import asyncio
from common import *
async def ev(pg, js): return await pg.evaluate(f"() => {{ const c = window._n.spll; return {js}; }}")
def row(n): return f".spll-tree .spll-lora:has(.spll-name:text-is('{n}'))"
async def prompt_answer(pg, text):
    dlg = pg.locator("[role=dialog]:not(.spll-modal):not(.spll-choice)").last
    await dlg.wait_for(timeout=5000)
    inp = dlg.locator("input").first
    await inp.fill(text); await inp.press("Enter"); await pg.wait_for_timeout(400)
async def main():
    logs=[]
    async with async_playwright() as p:
        b, pg = await open_page(p, logs)
        await pg.evaluate(SETUP); await pg.wait_for_timeout(1500)
        await choose_root(pg); await pg.wait_for_timeout(1500)
        await pg.evaluate("() => { const c = window._n.spll; c.commit(s => { for (const g of s.groups) g.collapsed = !['styles','anime','painterly','characters'].includes(g.name); }); }"); await pg.wait_for_timeout(300)
        # 1. Search Folders
        await pg.hover(".spll-fs-btn"); await pg.wait_for_timeout(700)
        print("1 tooltip:", await pg.locator(".spll-tip").inner_text(), "| slid out on hover:", await ev(pg, "c.footerOpen"), "| icon is folder:", await pg.locator(".spll-fs-btn svg path").first.get_attribute("d"))
        await pg.mouse.move(1180, 520, steps=4); await pg.wait_for_timeout(800)
        print("  slid back:", not await ev(pg, "c.footerOpen"))
        # 2. star click
        await pg.click(row("anime_soft") + " .spll-star"); await pg.wait_for_timeout(300)
        sb = await pg.locator(row("anime_soft") + " .spll-star").bounding_box(); mb = await pg.locator(".spll-pmenu").bounding_box()
        print("  menu next to star:", abs(mb["y"] - (sb["y"] + sb["height"])) < 12, mb["x"] < sb["x"] < mb["x"] + mb["width"] + 40)
        print("2 star menu open:", await pg.locator(".spll-pmenu").count(), "| items:", [x.replace("\n"," ") for x in await pg.locator(".spll-pmenu .spll-pmenu-item").all_inner_texts()])
        print("  fav tier:", await ev(pg, "c.tierOf('b1:styles/anime/anime_soft.safetensors')?.name"), "| star colour:", await pg.locator(row("anime_soft") + " .spll-star").evaluate("e => getComputedStyle(e).color"))
        await pg.screenshot(path=OUT+"100_star_menu.png")
        await pg.click(".spll-pmenu .spll-pmenu-item:has-text('Silver')"); await pg.wait_for_timeout(300)
        print("  -> Silver:", await ev(pg, "c.tierOf('b1:styles/anime/anime_soft.safetensors')?.name"), "| menu closed:", await pg.locator(".spll-pmenu").count() == 0, "| star colour:", await pg.locator(row("anime_soft") + " .spll-star").evaluate("e => getComputedStyle(e).color"))
        # 3. more favourites, then the ENABLED menu in tier mode
        for n in ["anime_bold", "oil_v2", "hero_a"]:
            await pg.click(row(n) + " .spll-star"); await pg.wait_for_timeout(200); await pg.keyboard.press("Escape"); await pg.wait_for_timeout(150)
        print("3 favourites:", await ev(pg, "c.state.favourites.map(k => k.split('/').pop() + ':' + c.tierOf(k).name)"))
        await pg.click(".spll-active-list", button="right"); await pg.wait_for_timeout(200)
        await pg.hover(".spll-pmenu-item:has-text('Favourites')"); await pg.wait_for_timeout(400)
        print("  tier rows:", [x.replace("\n"," ") for x in await pg.locator(".spll-pmenu.is-tiers .spll-pmenu-item").all_inner_texts()])
        await pg.hover(".spll-tier-row[data-tier=t1]"); await pg.wait_for_timeout(400)
        print("  Gold panel:", await pg.locator(".spll-pmenu.is-favs .spll-result-name").all_inner_texts())
        await pg.screenshot(path=OUT+"101_tiers.png")
        # 4. new collection from a favourite (right-click in the panel)
        await pg.click(".spll-pmenu.is-favs .spll-pmenu-lora:has(.spll-result-name:text-is('anime_bold'))", button="right"); await pg.wait_for_timeout(250)
        print("4 lora ctx:", [x.replace("\n"," ") for x in await pg.locator(".spll-pmenu").last.locator(".spll-pmenu-item").all_inner_texts()])
        await pg.locator(".spll-pmenu").last.locator(".spll-pmenu-item:has-text('New collection with this LoRA')").click()
        await prompt_answer(pg, "Anime stuff")
        print("  collections:", await ev(pg, "c.state.collections.map(x => x.name + '@' + x.tier)"), "| anime_bold in:", await ev(pg, "c.collById(c.state.favColl['b1:styles/anime/anime_bold.safetensors'])?.name"))
        # 5. drag oil_v2 into the collection
        await pg.click(".spll-active-list", button="right"); await pg.hover(".spll-pmenu-item:has-text('Favourites')"); await pg.wait_for_timeout(400)
        await pg.hover(".spll-tier-row[data-tier=t1]"); await pg.wait_for_timeout(400)
        g = await pg.locator(".spll-pmenu.is-favs .spll-pmenu-lora:has(.spll-result-name:text-is('oil_v2')) .spll-grip").bounding_box()
        t = await pg.locator(".spll-pmenu.is-favs .spll-coll-row").first.bounding_box()
        await pg.mouse.move(g["x"]+4, g["y"]+6); await pg.mouse.down(); await pg.mouse.move(t["x"]+60, t["y"]+t["height"]/2, steps=8); await pg.wait_for_timeout(200); await pg.mouse.up(); await pg.wait_for_timeout(400)
        print("5 oil_v2 in:", await ev(pg, "c.collById(c.state.favColl['b1:styles/painterly/oil_v2.safetensors'])?.name"))
        await pg.hover(".spll-pmenu.is-favs .spll-coll-row"); await pg.wait_for_timeout(400)
        print("  collection panel:", await pg.locator(".spll-pmenu.is-favs").last.locator(".spll-result-name").all_inner_texts())
        await pg.screenshot(path=OUT+"102_collection.png")
        # 6. delete collection -> move up
        await pg.locator(".spll-pmenu.is-favs .spll-coll-row").first.click(button="right"); await pg.wait_for_timeout(250)
        await pg.locator(".spll-pmenu").last.locator(".spll-pmenu-item:has-text('Delete collection')").click(); await pg.wait_for_timeout(300)
        print("6 choice:", (await pg.locator(".spll-choice").inner_text()).replace("\n"," | "))
        await pg.screenshot(path=OUT+"103_choice.png")
        await pg.click(".spll-choice button:has-text('Move them up')"); await pg.wait_for_timeout(300)
        print("  collections now:", await ev(pg, "c.state.collections.length"), "| favColl:", await ev(pg, "Object.keys(c.state.favColl).length"))
        # 7. settings: add a tier, remove Silver (holds anime_soft) -> move to Gold
        await pg.click(".spll-strip .spll-gear"); await pg.click(".spll-tab:text-is('Favourites')"); await pg.wait_for_timeout(200)
        await pg.screenshot(path=OUT+"104_fav_settings.png", clip={"x":300,"y":60,"width":440,"height":620})
        await pg.click(".spll-tiering .spll-step[title='One more tier']"); await pg.wait_for_timeout(200)
        print("7 tiers:", await ev(pg, "c.state.tiers.map(t => t.name)"))
        await pg.click(".spll-tier-item[data-id=t2] .spll-tier-del"); await pg.wait_for_timeout(300)
        print("  remove Silver asks:", (await pg.locator(".spll-choice").inner_text()).replace("\n"," | "))
        await pg.click(".spll-choice button:text-is('Move')"); await pg.wait_for_timeout(300)
        print("  tiers:", await ev(pg, "c.state.tiers.map(t => t.name)"), "| anime_soft:", await ev(pg, "c.tierOf('b1:styles/anime/anime_soft.safetensors')?.name"))
        # rename a tier
        inp = pg.locator(".spll-tier-item[data-id=t1] .spll-tier-input"); await inp.fill("Best"); await inp.press("Enter"); await pg.wait_for_timeout(200)
        print("  renamed:", await ev(pg, "c.state.tiers[0].name"))
        # remove the empty 4th tier -> quick mode
        await pg.click(".spll-tiering .spll-step[title='One fewer tier']"); await pg.wait_for_timeout(300)
        print("  tiers:", await ev(pg, "c.state.tiers.map(t => t.name)"), "| tier mode:", await ev(pg, "c.tierMode()"))
        await pg.click(".spll-settings [data-act=close]"); await pg.wait_for_timeout(200)
        await pg.click(".spll-active-list", button="right"); await pg.hover(".spll-pmenu-item:has-text('Favourites')"); await pg.wait_for_timeout(400)
        print("8 quick mode panel:", await pg.locator(".spll-pmenu.is-favs .spll-result-name").all_inner_texts(), "| tiering row:", await pg.locator(".spll-pmenu.is-favs .spll-tiering-row").count())
        await pg.keyboard.press("Escape")
        # 9. toggle off: empty star click shows no menu
        await ev(pg, "c.commit(s => { s.settings.favMenuOnClick = false; })")
        await pg.click(row("watercolor") + " .spll-star"); await pg.wait_for_timeout(300)
        print("9 no menu on click:", await pg.locator(".spll-pmenu").count() == 0, "| added:", await ev(pg, "c.isFav('b1:styles/painterly/watercolor.safetensors')"))
        await pg.click(row("watercolor") + " .spll-star", button="right"); await pg.wait_for_timeout(300)
        print("  right-click opens:", await pg.locator(".spll-pmenu").count())
        await pg.mouse.move(1200, 900, steps=5); await pg.wait_for_timeout(700)
        print("  auto-closed after moving away:", await pg.locator(".spll-pmenu").count() == 0)
        # 10. mode switch without reload
        await pg.evaluate("async () => { await window.comfyAPI.app.app.extensionManager.setting.set('Comfy.VueNodes.Enabled', false); }"); await pg.wait_for_timeout(2500)
        print("10 classic after switch: vue", await ev(pg, "c.vue"), "| header tools visible:", await pg.locator(".spll-hdr-tools").first.is_visible(), "| strip visible:", await pg.locator(".spll-strip").first.is_visible())
        await pg.evaluate("async () => { await window.comfyAPI.app.app.extensionManager.setting.set('Comfy.VueNodes.Enabled', true); }"); await pg.wait_for_timeout(2500)
        print("  back to Nodes 2.0: vue", await ev(pg, "c.vue"), "| header tools visible:", await pg.locator(".spll-hdr-tools").first.is_visible(), "| strip visible:", await pg.locator(".spll-strip").first.is_visible())
        print("ERRORS", errs(logs)[:6])
        await b.close()
asyncio.run(main())
