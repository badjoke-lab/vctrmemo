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
        assert 'Vector' in sender.locator('#sync-state').inner_text()
        def send_all():
            sender.evaluate("window.__wire=[]")
            sender.locator('#sync-now').click()
            sender.wait_for_function("document.querySelector('#sync-now').disabled===false", timeout=20000)
            return sender.evaluate("window.__wire")
        wire=send_all()
        assert len(wire)>5
        assert all(x['payload']['kind']=='vctrmemo-ops-v2' for x in wire)
        assert all('transfer' in x['payload'] for x in wire)
        # Do not infer gaps from WebXDC serials: the protocol permits gaps.
        deliver=lambda msg,serial: receiver.evaluate("""args => window.__listener({
            payload:args[0].payload,serial:args[1],max_serial:args[1]+100
        })""",[msg,serial])
        missed=3
        for i in reversed(range(len(wire))):
            if i!=missed: deliver(wire[i],100+i*9)
        deliver(wire[0],100)
        assert '未受信 1分割' in receiver.locator('#sync-state').inner_text()
        # A complete whole-history resend with another transferId recovers gaps.
        retry=send_all()
        assert retry[0]['payload']['transfer']['id']!=wire[0]['payload']['transfer']['id']
        for i in reversed(range(len(retry))):deliver(retry[i],3000+i*13)
        assert '分割受信完了' in receiver.locator('#sync-state').inner_text()
        assert receiver.evaluate("""() => {
          const data=JSON.parse(localStorage.getItem('vctrmemo-v2'));
          const engine=new VctrSync.Engine(data.sync.ops,data.sync.actor,data.sync.counter);
          return engine.missingPredecessors().length===0 && 
            engine.project().pages.find(p=>p.id==='p1').blocks.length===25;
        }""")
        assert receiver.evaluate("window.__listeners")==1
        assert sender.evaluate("window.__listeners")==1
        print('vctrmemo v0.9 WebXDC mock: multi-client, serial gaps, missing chunk, duplicate, full resend, local persistence PASS')
        ctx.close()
    finally:
        browser.close()
