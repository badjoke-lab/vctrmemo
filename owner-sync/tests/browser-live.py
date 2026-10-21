# Two actual Chromium browser contexts, one app origin and real public Nostr relays.
# The workspace keys are random; only synthetic test text is written.
from pathlib import Path
from playwright.sync_api import sync_playwright
import re
ROOT=Path(__file__).resolve().parents[2]
BASE='http://127.0.0.1:18767/'
def context(browser,actor):
    ctx=browser.new_context(viewport={'width':1200,'height':900})
    ctx.add_init_script(f"""() => {{
      if(!localStorage.getItem('vctrmemo-v2'))
        localStorage.setItem('vctrmemo-v2',JSON.stringify({{sync:{{version:2,actor:'{actor}',counter:0,ops:[]}}}}));
    }}""")
    return ctx
with sync_playwright() as p:
    browser=p.chromium.launch(headless=True,args=['--no-sandbox'])
    try:
        first_ctx=context(browser,'owner_A')
        second_ctx=context(browser,'owner_B')
        a=first_ctx.new_page()
        b=second_ctx.new_page()
        for page in (a,b):
            page.on('dialog',lambda dialog:dialog.accept())
            page.goto(BASE,wait_until='domcontentloaded',timeout=30000)
            page.locator('#owner-sync-panel').wait_for(timeout=30000)
            page.locator('#owner-sync-panel summary').click()
        a.locator('#owner-new-key').click()
        secret=a.locator('#owner-sync-secret').input_value()
        assert re.fullmatch(r'[a-f0-9]{64}',secret)
        a.locator('#owner-connect').click()
        a.wait_for_function("""() => document.querySelector('#owner-sync-state').textContent.includes('同期接続済み')""",timeout=20000)
        b.locator('#owner-sync-secret').fill(secret)
        b.locator('#owner-connect').click()
        b.wait_for_function("""() => document.querySelector('#owner-sync-state').textContent.includes('同期接続済み')""",timeout=20000)
        # Both connections are independent localStorage / browsing contexts.
        a.locator('#new-page').click()
        a.locator('#doc-title').fill('A端末から作った試験ページ')
        a.locator('#doc-title').blur()
        b.wait_for_function("""() => document.querySelector('#pages-list').textContent.includes('A端末から作った試験ページ')""",timeout=90000)
        b.locator('#pages-list').get_by_text('A端末から作った試験ページ').click()
        b.locator('#doc-title').fill('B端末で更新した試験ページ')
        b.locator('#doc-title').blur()
        a.wait_for_function("""() => document.querySelector('#pages-list').textContent.includes('B端末で更新した試験ページ')""",timeout=90000)
        assert 'B端末で更新した試験ページ' in a.locator('#pages-list').inner_text()
        print('owner sync LIVE BROWSER: two independent Chromium contexts, signed E2EE relay, A→B and B→A page changes PASS')
        a.close();b.close();first_ctx.close();second_ctx.close()
    finally:
        browser.close()
