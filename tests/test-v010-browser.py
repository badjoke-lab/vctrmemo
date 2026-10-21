from pathlib import Path
from shutil import which
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parent.parent

def boot(page):
    page.set_content((ROOT/'index.html').read_text())
    page.evaluate("""() => {
      const store=new Map();
      Object.defineProperty(window,'localStorage',{configurable:true,value:{
        getItem:k=>store.get(k)||null,
        setItem:(k,v)=>store.set(k,String(v)),
        removeItem:k=>store.delete(k)
      }});
      window.__wire=[];
      window.__listener=null;
      window.__listenerCount=0;
      window.webxdc={
        sendUpdateInterval:0,sendUpdateMaxSize:128000,
        setUpdateListener(fn){window.__listener=fn;window.__listenerCount++;return Promise.resolve();},
        sendUpdate(m){window.__wire.push(JSON.parse(JSON.stringify(m)));}
      };
      window.confirm=()=>true;
    }""")
    page.add_style_tag(content=(ROOT/'styles.css').read_text())
    for filename in ('sync-core.js','transfer.js','app.js'):
        page.add_script_tag(content=(ROOT/filename).read_text())
    page.locator('#probe-send').wait_for()
    assert page.evaluate("window.__listenerCount")==1

with sync_playwright() as p:
    browser=p.chromium.launch(executable_path=which('chromium'),headless=True,args=['--no-sandbox'])
    try:
        c1=browser.new_context(viewport={'width':1280,'height':920})
        c2=browser.new_context(viewport={'width':1280,'height':920})
        a=c1.new_page();b=c2.new_page()
        boot(a);boot(b)
        a.locator('#probe-send').click()
        request=a.evaluate("window.__wire[0]")
        assert request['payload']['kind']=='vctrmemo-probe-v1'
        assert request['payload']['action']=='request'
        assert 'テスト送信済み' in a.locator('#probe-status').inner_text()
        # Own echo must not declare success.
        a.evaluate("item=>window.__listener({payload:item.payload})",request)
        assert '受信確認:' not in a.locator('#probe-status').inner_text()
        # The other instance sees a manual reply button.
        b.evaluate("item=>window.__listener({payload:item.payload})",request)
        assert '受信しました' in b.locator('#probe-status').inner_text()
        assert b.locator('#probe-reply').is_visible()
        b.locator('#probe-reply').click()
        ack=b.evaluate("window.__wire[0]")
        assert ack['payload']['action']=='ack'
        assert not b.locator('#probe-reply').is_visible()
        b.evaluate("item=>window.__listener({payload:item.payload})",ack)
        a.evaluate("item=>window.__listener({payload:item.payload})",ack)
        assert '別のアプリ実行環境から受信確認: 1件' in a.locator('#probe-status').inner_text()
        a.evaluate("item=>window.__listener({payload:item.payload})",ack)
        assert '1件' in a.locator('#probe-status').inner_text()
        assert a.evaluate("window.__listenerCount")==1
        assert b.evaluate("window.__listenerCount")==1
        print('vctrmemo v0.10 browser: two-client request/reply, no false self-ACK, manual receipt PASS')
        c1.close();c2.close()
    finally:
        browser.close()
