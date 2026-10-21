from pathlib import Path
from shutil import which
from playwright.sync_api import sync_playwright

ROOT=Path(__file__).resolve().parent.parent

def boot(page, seeded=False):
    page.set_content((ROOT/'index.html').read_text())
    page.evaluate("""() => {
      const storage=new Map();
      Object.defineProperty(window,'localStorage',{configurable:true,value:{
        getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,String(v)),removeItem:k=>storage.delete(k)
      }});
      window.confirm=()=>true;
      window.__wire=[];
      window.__listener=null;
      window.__listeners=0;
      window.webxdc={
        sendUpdateInterval:0,sendUpdateMaxSize:1800,
        setUpdateListener(fn,serial){ window.__listeners++;window.__listener=fn;return Promise.resolve(); },
        sendUpdate(message){ window.__wire.push(JSON.parse(JSON.stringify(message))); }
      };
    }""")
    page.add_style_tag(content=(ROOT/'styles.css').read_text())
    page.add_script_tag(content=(ROOT/'sync-core.js').read_text())
    if seeded:
        page.evaluate("""() => {
          const data={schema:1,pages:[{id:'p1',title:'転送テスト',icon:'◈',deleted:false,blocks:[]}],tasks:[]};
          const engine=VctrSync.Engine.fromState(data);
          for(let i=0;i<25;i++)engine.change(JSON.stringify(['B','p1','block_'+i,'text']),('差分通信🐈'+i).repeat(50));
          localStorage.setItem('vctrmemo-v2',JSON.stringify({sync:engine.export()}));
        }""")
    page.add_script_tag(content=(ROOT/'transfer.js').read_text())
    page.add_script_tag(content=(ROOT/'app.js').read_text())
    page.locator('#sync-state').wait_for()
    assert page.evaluate("window.__listeners")==1

with sync_playwright() as playwright:
    browser=playwright.chromium.launch(executable_path=which('chromium'),headless=True,args=['--no-sandbox'])
    try:
        ctx=browser.new_context(viewport={'width':1250,'height':850})
        sender=ctx.new_page()
        receiver=ctx.new_page()
        boot(sender,True)
        boot(receiver,False)
        assert '個人用・共有オフ' in sender.locator('#sync-state').inner_text()
        assert sender.locator('#share-optin').is_disabled()
        assert sender.locator('#sync-now').is_visible() is False
        # WebXDC update replays are quarantined: no chat data enters solo mode.
        before=receiver.evaluate("localStorage.getItem('vctrmemo-v2')")
        wire=sender.evaluate("""() => {
          const data=JSON.parse(localStorage.getItem('vctrmemo-v2'));
          return VctrTransfer.trackedBatches(data.sync.ops,1800,'test_transfer','senderA');
        }""")
        assert len(wire)>5
        for i in reversed(range(len(wire))):
            receiver.evaluate("""args=>window.__listener({
              payload:args[0].payload,serial:args[1],max_serial:args[1]+100
            })""",[wire[i],100+i*17])
        assert receiver.evaluate("localStorage.getItem('vctrmemo-v2')")==before
        assert receiver.evaluate("window.__wire.length")==0
        assert sender.evaluate("window.__wire.length")==0
        assert sender.evaluate("window.__listeners")==1
        assert receiver.evaluate("window.__listeners")==1
        print('vctrmemo v0.9 transport remains testable while legacy chat auto-import is disabled PASS')
        ctx.close()
    finally:
        browser.close()
