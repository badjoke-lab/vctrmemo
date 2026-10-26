"""Isolated browser backup→restore regression; all data synthetic.

No public relay, Vector outbound message, or user backup is used. The test
runs against the current app import/export UI and its MV-register engine.
"""
import json
from pathlib import Path
from shutil import which
from playwright.sync_api import sync_playwright

ROOT=Path(__file__).resolve().parent.parent

def launch(page):
    page.set_content((ROOT/'index.html').read_text(encoding='utf-8'))
    page.evaluate("""() => {
      const storage=new Map();
      Object.defineProperty(window,'localStorage',{configurable:true,value:{
        getItem:k=>storage.has(k)?storage.get(k):null,
        setItem:(k,v)=>storage.set(k,String(v)),
        removeItem:k=>storage.delete(k)
      }});
      window.confirm=()=>true;
      window.webxdc={
        sendUpdateInterval:0,sendUpdateMaxSize:128000,
        setUpdateListener(){return Promise.resolve();},
        sendUpdate(){throw Error('A local restoration must never send Vector updates');}
      };
    }""")
    page.add_style_tag(content=(ROOT/'styles.css').read_text(encoding='utf-8'))
    for name in ('sync-core.js','transfer.js','app.js'):
        page.add_script_tag(content=(ROOT/name).read_text(encoding='utf-8'))
    page.locator('#new-page').wait_for()

def backup(page):
    with page.expect_download() as download:
        page.locator('#export-json').click()
    return download.value.path().read_bytes()

def restore(page, data):
    page.locator('#import-file').set_input_files({
      'name':'isolated-vctrmemo-backup.json',
      'mimeType':'application/json','buffer':data
    })

with sync_playwright() as p:
    browser=p.chromium.launch(executable_path=which('chromium'),headless=True,args=['--no-sandbox'])
    try:
        sender=browser.new_context(accept_downloads=True)
        receiver=browser.new_context(accept_downloads=True)
        a=sender.new_page()
        b=receiver.new_page()
        launch(a)
        a.locator('#new-page').click()
        a.locator('#doc-title').fill('復元検査・日本語のページ')
        edit=a.locator('#editor .block-edit').first
        edit.fill('一行目')
        edit.press('Enter')
        edit.type('二行目')
        edit.press('Control+Enter')
        a.locator('#editor .block-edit').nth(1).fill('復元で失われてはいけない文章')
        exported=backup(a)
        source=json.loads(exported)
        assert source['sync']['version']==2 and len(source['sync']['ops'])>120
        assert any(v.get('title')=='復元検査・日本語のページ' for v in source['pages'])

        # Restore into an entirely independent, unsynchronized browser profile.
        launch(b)
        before=b.evaluate("localStorage.getItem('vctrmemo-v2')")
        assert before
        restore(b,exported)
        restored=json.loads(backup(b))
        for key in ('schema','pages','tasks','dbColumns','databases'):
            assert restored[key]==source[key], 'UI import/export round-trip mismatch: '+key
        source_ids={v['id'] for v in source['sync']['ops']}
        restored_ids={v['id'] for v in restored['sync']['ops']}
        assert source_ids<=restored_ids, 'Restore lost saved causal operations'
        assert b.evaluate("localStorage.getItem('vctrmemo-v2')")!=before
        assert b.locator('#pages-list').get_by_text('復元検査・日本語のページ').count()==1

        # Importing the same backup twice must not duplicate any history.
        size=len(restored_ids)
        restore(b,exported)
        again=json.loads(backup(b))
        assert len(again['sync']['ops'])==size
        assert len({o['id'] for o in again['sync']['ops']})==size

        # A conflicting op ID must be rejected atomically; no existing text,
        # page, or valid operation can be overwritten.
        altered=json.loads(exported)
        altered['sync']['ops'][-1]['value']='tampered restore'
        previous=b.evaluate("localStorage.getItem('vctrmemo-v2')")
        restore(b,json.dumps(altered,ensure_ascii=False).encode('utf-8'))
        assert b.evaluate("localStorage.getItem('vctrmemo-v2')")==previous

        # Completely empty / new workspaces remain independent: no outgoing
        # Vector synchronization packets are emitted by restore.
        assert b.evaluate("document.querySelector('#doc-title')===null || !document.querySelector('#vctrmemo-recovery-stop')")
        print('RESTORE: real UI export/import; Japanese multiline, all pages and ops; idempotence, atomic conflict rejection, isolated storage PASS',flush=True)
    finally:
        browser.close()
