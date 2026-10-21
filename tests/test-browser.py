from playwright.sync_api import sync_playwright
from pathlib import Path
from shutil import which
root=Path(__file__).parent.parent
with sync_playwright() as p:
    browser=p.chromium.launch(executable_path=which('chromium'),headless=True,args=['--no-sandbox'])
    try:
        def client():
            ctx=browser.new_context()
            page=ctx.new_page()
            page.set_content((root/'index.html').read_text())
            page.evaluate('''() => {
              const store = new Map();
              Object.defineProperty(window,'localStorage',{configurable:true,value:{
                getItem:k=>store.get(k)||null,
                setItem:(k,v)=>store.set(k,String(v)),
                removeItem:k=>store.delete(k)
              }});
              window.__sent=[]; window.confirm=()=>true;
              window.webxdc={sendUpdateMaxSize:1600,sendUpdateInterval:0,
                setUpdateListener(fn){window.__listener=fn;return Promise.resolve();},
                sendUpdate(update){window.__sent.push(update);}};
            }''')
            page.add_style_tag(content=(root/'styles.css').read_text())
            page.add_script_tag(content=(root/'sync-core.js').read_text())
            page.add_script_tag(content=(root/'transfer.js').read_text())
            page.add_script_tag(content=(root/'app.js').read_text())
            page.locator('.metric-strip').wait_for(timeout=10000)
            return ctx,page
        ac,a=client();bc,b=client()
        assert a.locator('#share-optin').is_disabled()
        assert b.locator('#sync-now').is_visible() is False
        a.locator('#new-page').click()
        a.locator('#doc-title').fill('個人用メモ 🌸')
        a.locator('#doc-title').blur()
        assert '個人用メモ' in a.locator('#pages-list').inner_text()
        assert '個人用メモ' not in b.locator('#pages-list').inner_text()
        assert a.evaluate('window.__sent.length') == 0
        assert b.evaluate('window.__sent.length') == 0
        assert 'ops' in a.evaluate('localStorage.getItem("vctrmemo-v2")')
        print('vctrmemo browser: two independent local workspaces, edits saved without chat transmission PASS')
        ac.close();bc.close()
    finally:
        browser.close()
