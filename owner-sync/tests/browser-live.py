# Browser-only one-private-link E2EE owner sync using public Nostr relays.
# Two Chromium contexts have independent storage, but the same #k= private URL.
from playwright.sync_api import sync_playwright
import re
BASE='http://127.0.0.1:18767/synced/'
with sync_playwright() as p:
    browser=p.chromium.launch(headless=True,args=['--no-sandbox'])
    try:
        ca=browser.new_context(viewport={'width':1200,'height':900})
        cb=browser.new_context(viewport={'width':1200,'height':900})
        a=ca.new_page()
        b=cb.new_page()
        a.goto(BASE,wait_until='domcontentloaded',timeout=30000)
        a.locator('#owner-sync-panel').wait_for(timeout=30000)
        private_url=a.url
        assert re.search(r'/synced/#k=[0-9a-f]{64}$',private_url),private_url
        a.wait_for_function("""() => document.querySelector('#owner-sync-state').textContent.includes('接続しました')""",timeout=20000)
        b.goto(private_url,wait_until='domcontentloaded',timeout=30000)
        b.locator('#owner-sync-panel').wait_for(timeout=30000)
        b.wait_for_function("""() => document.querySelector('#owner-sync-state').textContent.includes('接続しました')""",timeout=20000)
        assert a.url==b.url
        # Existing local-only workspace is not shared or overwritten.
        for page in (a,b):
            assert page.evaluate("localStorage.getItem('vctrmemo-v2')") is None
            assert page.evaluate("window.__vctrmemo_owner_storage_key.startsWith('vctrmemo-synced-v1-')")
            assert page.evaluate("localStorage.getItem(window.__vctrmemo_owner_storage_key)") is not None
        a.locator('#new-page').click()
        a.locator('#doc-title').fill('リンクで同期したページ')
        a.locator('#doc-title').blur()
        for label,page in [('A',a),('B',b)]:
            page.on('pageerror',lambda e,n=label:print('JS ERROR',n,str(e),flush=True))
            page.on('console',lambda m,n=label:print('CONSOLE',n,m.text[:260],flush=True) if m.type=='error' else None)
        a.wait_for_timeout(14000)
        for label,page in [('A',a),('B',b)]:
            info=page.evaluate("""() => ({
              status:document.querySelector('#owner-sync-state')?.textContent,
              titles:document.querySelector('#pages-list')?.textContent?.slice(0,240),
              key:window.__vctrmemo_owner_storage_key,
              ops:JSON.parse(localStorage.getItem(window.__vctrmemo_owner_storage_key)||'{}').sync?.ops?.length,
              sent:localStorage.getItem('vctrmemo-owner-published-'+(window.__vctrmemo_owner_storage_key||'').slice(-20))
            })""")
            print('E2E STATE',label,info,flush=True)
        b.wait_for_function("""() => document.querySelector('#pages-list').textContent.includes('リンクで同期したページ')""",timeout=25000)
        b.locator('#pages-list').get_by_text('リンクで同期したページ').click()
        b.locator('#doc-title').fill('BからAへの更新')
        b.locator('#doc-title').blur()
        a.wait_for_function("""() => document.querySelector('#pages-list').textContent.includes('BからAへの更新')""",timeout=90000)
        assert a.locator('#doc-title').input_value() == 'BからAへの更新', 'remote reload must preserve the current page'

        # Regression: keep the rich text editor focused during several delayed edits.
        first=a.locator('#editor .block-edit').first
        first.fill('さらに入力')
        assert a.evaluate('document.activeElement.isContentEditable'), 'editor must remain focused'
        b.wait_for_function("""() => document.querySelector('#editor .block-edit')?.textContent.includes('さらに入力')""",timeout=50000)
        a.wait_for_timeout(2200)
        first.press('Enter')
        second=a.locator('#editor .block-edit').nth(1)
        second.fill('入力をさらに行った')
        assert a.evaluate('document.activeElement.isContentEditable'), 'new line still focused'
        b.wait_for_function("""() => [...document.querySelectorAll('#editor .block-edit')].some(e=>e.textContent.includes('入力をさらに行った'))""",timeout=50000)
        a.wait_for_timeout(2200)
        second.press('Enter')
        third=a.locator('#editor .block-edit').nth(2)
        third.fill('同期できるか')
        assert a.evaluate('document.activeElement.isContentEditable'), 'third line still focused'
        b.wait_for_function("""() => [...document.querySelectorAll('#editor .block-edit')].some(e=>e.textContent.includes('同期できるか'))""",timeout=50000)
        assert a.locator('#doc-title').input_value() == 'BからAへの更新'
        assert b.locator('#doc-title').input_value() == 'BからAへの更新'
        print('FOCUSED EDITOR: three text blocks sent without leaving contenteditable PASS',flush=True)

        # Pause is explicit; pressing the same button again resumes without reload.
        b.locator('#owner-disconnect').click()
        assert b.locator('#owner-disconnect').inner_text() == '同期を再開'
        a.locator('#doc-title').fill('オフライン後の追いつき')
        a.locator('#doc-title').blur()
        assert 'オフライン後の追いつき' not in b.locator('#pages-list').inner_text()
        b.locator('#owner-disconnect').click()
        b.wait_for_function("""() => document.querySelector('#doc-title')?.value === 'オフライン後の追いつき'""",timeout=90000)
        assert b.locator('#owner-disconnect').inner_text() == '同期を停止'
        # Manual reload should keep the same opened document on both browsers.
        b.reload(wait_until='domcontentloaded')
        b.locator('#owner-sync-panel').wait_for(timeout=30000)
        assert b.locator('#doc-title').input_value() == 'オフライン後の追いつき'
        a.reload(wait_until='domcontentloaded')
        a.locator('#owner-sync-panel').wait_for(timeout=30000)
        assert a.locator('#doc-title').input_value() == 'オフライン後の追いつき'
        assert b.locator('#editor .block-edit').nth(2).inner_text() == '同期できるか'
        assert a.url==b.url,'private-link fragment remains stable across reload'
        print('browser owner LIVE RELAY: A→B and B→A, delayed text edits without blur, pause/resume, catchup, and page restoration PASS',flush=True)
        a.close();b.close();ca.close();cb.close()
    finally:
        browser.close()
