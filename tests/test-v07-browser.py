from pathlib import Path
from shutil import which
import json
from playwright.sync_api import sync_playwright

ROOT=Path(__file__).parent.parent

def boot(page,saved=None):
    page.set_content((ROOT/'index.html').read_text())
    page.evaluate("""saved=>{
      const m=new Map(saved?[['vctrmemo-v2',saved]]:[]);
      Object.defineProperty(window,'localStorage',{configurable:true,value:{
        getItem:k=>m.get(k)||null,setItem:(k,v)=>m.set(k,String(v)),removeItem:k=>m.delete(k)
      }});
      window.confirm=()=>true;
    }""",saved)
    page.add_style_tag(content=(ROOT/'styles.css').read_text())
    for script in ('sync-core.js','transfer.js','app.js'):
        page.add_script_tag(content=(ROOT/script).read_text())
    page.locator('.metric-strip').wait_for(timeout=10000)

with sync_playwright() as p:
    browser=p.chromium.launch(executable_path=which('chromium'),headless=True,args=['--no-sandbox'])
    try:
        ctx=browser.new_context(viewport={'width':1300,'height':950})
        page=ctx.new_page()
        boot(page)
        page.once('dialog',lambda dialog: dialog.accept('取引先'))
        page.locator('#pages-list .sidebar-section-label button').click()
        page.get_by_role('button',name='＋ 新しいタスク').click()
        page.locator('.task-table tbody input[aria-label="タスク名"]').fill('Alpha')
        page.locator('#pages-list .page-link').filter(has_text='データベース').click()
        answers=iter(['関連先','relation','2'])
        page.on('dialog',lambda dialog: dialog.accept(next(answers)) if dialog.type=='prompt' else dialog.accept())
        page.get_by_role('button',name='＋ 列を追加').click()
        rel=page.locator('.task-table tbody tr').first.locator('select.relation-select')
        rel.select_option(label='Alpha')
        assert rel.input_value()!=''
        page.locator('#pages-list .tree-item').first.click()
        page.get_by_role('button',name='＋ ブロックを追加').click()
        page.get_by_role('button',name='データベースを埋め込む').click()
        block=page.locator('.database-block-row')
        block.locator('.database-embed-controls select[aria-label="埋め込みデータベース"]').select_option(label='取引先')
        block.locator('select[aria-label="埋め込み表示形式"]').select_option('board')
        block.locator('select[aria-label="埋め込み表示件数"]').select_option('5')
        assert block.locator('.board-card').count()==1
        snapshot=page.evaluate("localStorage.getItem('vctrmemo-v2')")
        ops=json.loads(snapshot)['sync']['ops']
        assert any('viewMode' in op['key'] and op['value']=='board' for op in ops)
        assert any('targetDbId' in op['key'] for op in ops)
        other=ctx.new_page()
        boot(other,snapshot)
        other.locator('#pages-list .tree-item').first.click()
        b=other.locator('.database-block-row')
        assert b.locator('select[aria-label="埋め込み表示形式"]').input_value()=='board'
        assert b.locator('select[aria-label="埋め込み表示件数"]').input_value()=='5'
        assert b.locator('.board-card').count()==1
        other.locator('#pages-list .page-link').filter(has_text='データベース').click()
        assert other.locator('.relation-select').first.input_value()!=''
        # Malformed import must not alter the current sync history.
        before=other.evaluate("localStorage.getItem('vctrmemo-v2')")
        corrupt={'schema':1,'pages':[],'tasks':[],
          'sync':{'version':2,'ops':[{'id':'invalid!!','key':'[]','pred':[],'value':'oops'}]}}
        other.locator('#import-file').set_input_files({
            'name':'invalid-backup.json',
            'mimeType':'application/json',
            'buffer':json.dumps(corrupt).encode()
        })
        other.wait_for_timeout(150)
        assert other.evaluate("localStorage.getItem('vctrmemo-v2')")==before
        print('vctrmemo v0.7 browser: cross-db relation, inline display settings, restore, malformed-import rejection PASS')
        ctx.close()
    finally:
        browser.close()
