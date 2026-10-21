from pathlib import Path
from shutil import which
from playwright.sync_api import sync_playwright

ROOT=Path(__file__).parent.parent
with sync_playwright() as p:
    browser=p.chromium.launch(executable_path=which('chromium'),headless=True,args=['--no-sandbox'])
    try:
        ctx=browser.new_context(viewport={'width':1250,'height':900})
        page=ctx.new_page()
        page.set_content((ROOT/'index.html').read_text())
        page.evaluate("""() => {
          const store=new Map();
          Object.defineProperty(window,'localStorage',{configurable:true,value:{
            getItem:k=>store.get(k)||null,
            setItem:(k,v)=>store.set(k,String(v)),removeItem:k=>store.delete(k)
          }});
          window.confirm=()=>true;
          window.webxdc={
            sendUpdateInterval:0,sendUpdateMaxSize:128000,
            setUpdateListener(fn){window.__listener=fn;return Promise.resolve();},
            sendUpdate(message){window.__sent=message;}
          };
        }""")
        page.add_style_tag(content=(ROOT/'styles.css').read_text())
        for name in ('sync-core.js','transfer.js','app.js'):
            page.add_script_tag(content=(ROOT/name).read_text())
        page.locator('.metric-strip').wait_for()
        assert page.locator('#share-optin').is_checked() is False
        assert page.locator('#sync-now').is_visible() is False
        assert '個人用・共有オフ' in page.locator('#sync-state').inner_text()
        before=page.evaluate("localStorage.getItem('vctrmemo-v2')")
        # A remote chat update cannot silently enter the personal workspace.
        page.evaluate("""() => {
          const remote={
            schema:1,
            pages:[{id:'remote_1',title:'他の参加者のページ',icon:'◈',deleted:false,blocks:[]}],
            tasks:[]
          };
          const e=VctrSync.Engine.fromState(remote);
          window.__listener({payload:{kind:'vctrmemo-ops-v2',ops:e.export().ops}});
        }""")
        assert page.evaluate("localStorage.getItem('vctrmemo-v2')")==before
        assert page.locator('#pages-list .tree-item').filter(has_text='他の参加者のページ').count()==0
        # Opt-in is required to ingest the buffered chat history.
        page.locator('#share-optin').check()
        assert page.locator('#sync-now').is_visible()
        page.wait_for_function("""() => document.querySelector('#pages-list').textContent.includes('他の参加者のページ')""")
        after=page.evaluate("localStorage.getItem('vctrmemo-v2')")
        assert after != before
        # Turning it off stops incoming data from modifying local documents again.
        page.locator('#share-optin').uncheck()
        assert page.locator('#sync-now').is_visible() is False
        snapshot=page.evaluate("localStorage.getItem('vctrmemo-v2')")
        page.evaluate("""() => {
          const e=VctrSync.Engine.fromState({
            schema:1,pages:[{id:'remote_2',title:'オフの間の受信',icon:'◈',deleted:false,blocks:[]}],tasks:[]
          });
          window.__listener({payload:{kind:'vctrmemo-ops-v2',ops:e.export().ops}});
        }""")
        assert page.evaluate("localStorage.getItem('vctrmemo-v2')")==snapshot
        assert page.locator('#pages-list .tree-item').filter(has_text='オフの間の受信').count()==0
        print('vctrmemo v0.11: solo-first, inbound updates quarantined, explicit opt-in, opt-out preserved local data PASS')
        ctx.close()
    finally:
        browser.close()
