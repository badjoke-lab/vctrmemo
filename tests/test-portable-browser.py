"""Real browser encrypted-file recovery while ALL external Nostr traffic is disabled.

Two independent Chromium profiles, no shared browser storage, no live relay.
Uses the real /synced/ bootstrap and bundled owner-sync UI (not mocked).
Only synthetic notes are used. No user data is loaded or sent to GitHub.
"""
import json
import threading
from pathlib import Path
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from functools import partial
from shutil import which
from playwright.sync_api import sync_playwright

SITE=Path(__file__).resolve().parent.parent/'dist'/'site'
assert (SITE/'owner-sync.js').exists(), 'bundle owner sync before portable recovery test'

class Quiet(SimpleHTTPRequestHandler):
    def log_message(self,*args): pass

server=ThreadingHTTPServer(('127.0.0.1',0),partial(Quiet,directory=str(SITE)))
thread=threading.Thread(target=server.serve_forever,daemon=True)
thread.start()
BASE=f'http://127.0.0.1:{server.server_port}/synced/'
SECRET='57'*32
URL=BASE+'#k='+SECRET

def enter(page, private_url=URL):
    page.on('pageerror',lambda e:print('OFFLINE JS ERROR:',str(e)[:300],flush=True))
    page.on('console',lambda m:print('OFFLINE JS CONSOLE:',m.text[:300],flush=True) if m.type=='error' else None)
    print('OFFLINE ENTER: navigate',flush=True)
    page.goto(private_url,wait_until='domcontentloaded',timeout=15000)
    print('OFFLINE ENTER: page loaded',flush=True)
    page.wait_for_timeout(1000)
    print('OFFLINE BOOT:',page.evaluate("""() => ({
      secure:isSecureContext,
      storageReady:!!window.__vctrmemo_owner_storage_key,
      storageData:!!localStorage.getItem(window.__vctrmemo_owner_storage_key||'_missing'),
      bootstrap:document.querySelector('#owner-link-bootstrap')?.textContent?.slice(0,180),
      panel:!!document.querySelector('#owner-save-file')
    })"""),flush=True)
    page.locator('#owner-save-file').wait_for(timeout=4000)
    print('OFFLINE ENTER: sync controls loaded',flush=True)
    # The point of this test is recovery WITHOUT any relay. Never gate file
    # recovery on the network reporting a successful connection.
    page.wait_for_function("""() => {
      const key=window.__vctrmemo_owner_storage_key;
      return key&&localStorage.getItem(key)!=null;
    }""",timeout=20000)
    page.wait_for_timeout(250)
    print('OFFLINE ENTER: pausing relay',flush=True)
    page.locator('#owner-disconnect').click(timeout=6000)
    print('OFFLINE ENTER: paused',flush=True)
    assert page.locator('#owner-disconnect').inner_text()=='同期を再開', 'relay should be paused'
    return page.evaluate("window.__vctrmemo_owner_storage_key")

def upload(page, raw):
    page.locator('#owner-backup-file').set_input_files({
        'name':'isolated.vctrmemo',
        'mimeType':'application/json','buffer':raw
    })

with sync_playwright() as p:
    browser=p.chromium.launch(headless=True,executable_path=which('chromium'),args=['--no-sandbox'])
    try:
        contexts=[browser.new_context(accept_downloads=True) for _ in range(3)]
        for context in contexts:
            context.add_init_script('window.confirm=()=>true')
            # Offline recovery MUST NOT depend on open network connections.
            # Replace WebSocket before scripts run. RouteWebSocket.close() from
            # a synchronous Playwright callback can deadlock the test driver.
            # This fails connection immediately, with ZERO external traffic.
            context.add_init_script("""(() => {
              class OfflineWebSocket {
                static OPEN=1;
                constructor(url){this.url=url;this.readyState=3;}
                addEventListener(name,callback){
                  if(name==='error')queueMicrotask(()=>callback(new Event('error')));
                }
                send(){throw Error('Offline test forbids WebSocket network');}
                close(){this.readyState=3;}
              }
              window.WebSocket=OfflineWebSocket;
            })()""")
        a,b,c=[context.new_page() for context in contexts]
        print('OFFLINE TEST: create source browser',flush=True)
        storage_a=enter(a)
        print('OFFLINE TEST: source ready',flush=True)
        a.locator('#new-page').click()
        a.locator('#doc-title').fill('オフラインから復元するページ')
        edit=a.locator('#editor .block-edit').first
        edit.fill('Macで編集した一行目')
        edit.press('Enter')
        edit.type('二行目にも大事な情報')
        edit.press('Control+Enter')
        a.locator('#editor .block-edit').nth(1).fill('編集履歴を復元したい')
        assert '二行目' in a.locator('#editor .block-edit').first.inner_text()
        source=a.evaluate("""() => {
          const s=JSON.parse(localStorage.getItem(window.__vctrmemo_owner_storage_key)).sync;
          return {actor:s.actor,ids:s.ops.map(op=>op.id),doc:new VctrSync.Engine(s.ops,s.actor,s.counter).project()}
        }""")
        print('OFFLINE TEST: begin encrypted download',flush=True)
        with a.expect_download(timeout=12000) as download:
            a.locator('#owner-save-file').click()
        encrypted=download.value.path().read_bytes()
        print('OFFLINE TEST: downloaded file, bytes=',len(encrypted),flush=True)
        assert download.value.suggested_filename.endswith('.vctrmemo')
        assert 'オフラインから復元するページ'.encode('utf-8') not in encrypted
        assert b'Mac' not in encrypted
        assert SECRET.encode() not in encrypted
        assert json.loads(encrypted)['operations']==len(source['ids'])
        print('PORTABLE BACKUP: encrypted local download without relay PASS',flush=True)

        print('OFFLINE TEST: create isolated receiver',flush=True)
        storage_b=enter(b)
        assert storage_a==storage_b
        assert b.locator('#pages-list').get_by_text('オフラインから復元するページ').count()==0
        upload(b,encrypted)
        b.wait_for_function("""() => document.querySelector('#owner-sync-state').textContent.includes('バックアップから復元しました')""",timeout=20000)
        restored=b.evaluate("""() => {
          const s=JSON.parse(localStorage.getItem(window.__vctrmemo_owner_storage_key)).sync;
          return {actor:s.actor,ids:s.ops.map(op=>op.id),doc:new VctrSync.Engine(s.ops,s.actor,s.counter).project(),
            missing:new VctrSync.Engine(s.ops,s.actor,s.counter).missingPredecessors()}
        }""")
        assert restored['actor']!=source['actor'],'new device must keep its own actor identity'
        assert set(source['ids'])<=set(restored['ids'])
        assert restored['missing']==[]
        assert restored['doc']==source['doc'], 'entire page/task/block structure must round-trip offline'
        assert b.locator('#pages-list').get_by_text('オフラインから復元するページ').count()==1
        before=b.evaluate("localStorage.getItem(window.__vctrmemo_owner_storage_key)")
        upload(b,encrypted)
        b.wait_for_function("""() => document.querySelector('#owner-sync-state').textContent.includes('既に保存されています')""",timeout=20000)
        assert b.evaluate("localStorage.getItem(window.__vctrmemo_owner_storage_key)")==before
        print('PORTABLE RESTORE: isolated browser keeps actor; full history, multiline text, idempotence PASS',flush=True)

        # Even a file from a different valid URL must NOT enter this workspace.
        print('OFFLINE TEST: wrong-key browser',flush=True)
        enter(c,BASE+'#k='+'9c'*32)
        before_wrong=c.evaluate("localStorage.getItem(window.__vctrmemo_owner_storage_key)")
        upload(c,encrypted)
        c.wait_for_function("""() => document.querySelector('#owner-sync-state').textContent.includes('復元に失敗')""",timeout=20000)
        assert c.evaluate("localStorage.getItem(window.__vctrmemo_owner_storage_key)")==before_wrong
        altered=json.loads(encrypted)
        ct=altered['ciphertext']
        altered['ciphertext']=ct[:40]+('A' if ct[40]!='A' else 'B')+ct[41:]
        upload(b,json.dumps(altered).encode())
        b.wait_for_function("""() => document.querySelector('#owner-sync-state').textContent.includes('復元に失敗')""",timeout=20000)
        assert b.evaluate("localStorage.getItem(window.__vctrmemo_owner_storage_key)")==before
        print('PORTABLE SAFETY: wrong URL secret and tampered file leave existing notes intact PASS',flush=True)
    finally:
        browser.close()
        server.shutdown()
        server.server_close()
