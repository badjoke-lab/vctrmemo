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
        a.locator('#share-optin').check()
        b.locator('#share-optin').check()
        a.locator('#new-page').click()
        a.locator('#doc-title').fill('転送統合テスト 🌸')
        a.locator('#sync-now').click()
        a.wait_for_function('window.__sent.length > 1 && !document.querySelector("#sync-now").disabled',timeout=15000)
        updates=a.evaluate('window.__sent')
        assert len(updates)>1
        b.evaluate('''messages=>{
          for (const m of messages.slice().reverse()) window.__listener({payload:m.payload});
          for (const m of messages) window.__listener({payload:m.payload});
        }''',updates)
        b.wait_for_function('document.querySelector("#pages-list").innerText.includes("転送統合テスト")')
        assert not b.locator('#show-conflicts').is_visible()
        assert 'ops' in b.evaluate('localStorage.getItem("vctrmemo-v2")')
        print(f'vctrmemo browser: two clients UI edit, chunk send, reverse+duplicate delivery, local save PASS ({len(updates)} updates)')
        ac.close();bc.close()
    finally:
        browser.close()
