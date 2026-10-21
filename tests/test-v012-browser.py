from pathlib import Path
from shutil import which
from playwright.sync_api import sync_playwright

ROOT=Path(__file__).parent.parent

def load(page, saved=None):
    page.set_content((ROOT/'index.html').read_text())
    page.evaluate("""saved => {
      const store = new Map(saved?[['vctrmemo-v2',saved]]:[]);
      Object.defineProperty(window,'localStorage',{configurable:true,value:{
        getItem:k=>store.get(k)||null,
        setItem:(k,v)=>store.set(k,String(v)),
        removeItem:k=>store.delete(k)
      }});
      window.confirm=()=>true;
      window.__out=[];
      window.webxdc={
        sendUpdateInterval:0,sendUpdateMaxSize:128000,
        setUpdateListener(fn){window.__listener=fn;return Promise.resolve();},
        sendUpdate(data){window.__out.push(data);}
      };
    }""",saved)
    page.add_style_tag(content=(ROOT/'styles.css').read_text())
    for name in ('sync-core.js','transfer.js','app.js'):
        page.add_script_tag(content=(ROOT/name).read_text())
    page.locator('.metric-strip').wait_for()

with sync_playwright() as p:
    browser=p.chromium.launch(executable_path=which('chromium'),headless=True,args=['--no-sandbox'])
    try:
        ctx=browser.new_context(viewport={'width':1240,'height':900})
        first=ctx.new_page()
        load(first)
        first.locator('#new-page').click()
        first.locator('#doc-title').fill('個人データは送信しない')
        first.locator('#doc-title').blur()
        saved=first.evaluate("localStorage.getItem('vctrmemo-v2')")
        assert saved and '個人データは送信しない' in first.locator('#pages-list').inner_text()
        assert first.evaluate("window.__out.length")==0
        assert first.locator('#share-optin').is_disabled()
        assert first.locator('#sync-now').is_visible() is False
        # Previously published chat history, including valid operation logs, is ignored.
        first.evaluate("""() => {
          const e=VctrSync.Engine.fromState({
            schema:1,
            pages:[{id:'remote_private',title:'他人のノート',deleted:false,icon:'◈',blocks:[]}],
            tasks:[]
          });
          const payload={kind:'vctrmemo-ops-v2',ops:e.export().ops};
          window.__listener({payload});
          window.__listener({payload:{kind:'workspace-snapshot-v1',data:{pages:[]}}});
          const checkbox=document.querySelector('#share-optin');
          checkbox.disabled=false;checkbox.checked=true;
          checkbox.dispatchEvent(new Event('change',{bubbles:true}));
          const share=document.querySelector('#sync-now');
          share.hidden=false;share.disabled=false;share.click();
        }""")
        assert first.evaluate("window.__out.length")==0
        assert first.evaluate("localStorage.getItem('vctrmemo-v2')")==saved
        assert '他人のノート' not in first.locator('#pages-list').inner_text()
        second=ctx.new_page()
        load(second,saved)
        assert '個人データは送信しない' in second.locator('#pages-list').inner_text()
        assert second.evaluate("window.__out.length")==0
        print('vctrmemo v0.12: solo storage intact, hostile legacy chat replay rejected, no unauthorized outbound, reload PASS')
        ctx.close()
    finally:
        browser.close()
