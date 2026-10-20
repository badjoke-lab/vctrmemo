from pathlib import Path
from shutil import which
from playwright.sync_api import sync_playwright

ROOT=Path(__file__).resolve().parent.parent

def boot(page, snapshot=None):
    page.set_content((ROOT/'index.html').read_text())
    page.evaluate("""saved=>{
      const m=new Map(saved?[['vctrmemo-v2',saved]]:[]);
      Object.defineProperty(window,'localStorage',{configurable:true,value:{
        getItem:k=>m.get(k)||null,setItem:(k,v)=>m.set(k,String(v)),removeItem:k=>m.delete(k)
      }});
      window.confirm=()=>true;
    }""",snapshot)
    page.add_style_tag(content=(ROOT/'styles.css').read_text())
    for filename in ('sync-core.js','transfer.js','app.js'):
        page.add_script_tag(content=(ROOT/filename).read_text())
    page.locator('.metric-strip').wait_for(timeout=10000)

with sync_playwright() as pw:
    browser=pw.chromium.launch(executable_path=which('chromium'),headless=True,args=['--no-sandbox'])
    try:
        context=browser.new_context(viewport={'width':1350,'height':1000})
        page=context.new_page()
        boot(page)
        replies=[]
        def dialog_response(dialog):
            if dialog.type=='prompt':
                assert replies, 'Unexpected prompt: '+dialog.message
                dialog.accept(replies.pop(0))
            else:
                dialog.accept()
        page.on('dialog',dialog_response)
        replies.append('取引先')
        page.locator('#pages-list .sidebar-section-label button').click()
        page.get_by_role('button',name='＋ 新しいタスク').click()
        page.locator('.task-table tbody tr').first.locator('input[aria-label="タスク名"]').fill('Alpha')
        # Source table has four pre-existing task records.
        page.locator('#pages-list .page-link').filter(has_text='データベース').click()
        replies.extend(['金額','number'])
        page.get_by_role('button',name='＋ 列を追加').click()
        numbers=page.locator('.task-table tbody input[aria-label="金額"]')
        numbers.nth(0).fill('12')
        numbers.nth(0).dispatch_event('change')
        numbers.nth(1).fill('20')
        numbers.nth(1).dispatch_event('change')
        replies.extend(['取引先へのリンク','relation','2'])
        page.get_by_role('button',name='＋ 列を追加').click()
        rels=page.locator('.task-table tbody select.relation-select')
        assert rels.count()==4
        rels.nth(0).select_option(label='Alpha')
        rels.nth(1).select_option(label='Alpha')
        page.locator('#pages-list .page-link').filter(has_text='取引先').click()
        links=page.locator('.task-table tbody .derived-link')
        assert links.count()==2
        replies.extend(['件数','rollup','1','count'])
        page.get_by_role('button',name='＋ 列を追加').click()
        replies.extend(['金額合計','rollup','1','sum','1'])
        page.get_by_role('button',name='＋ 列を追加').click()
        row=page.locator('.task-table tbody tr').first
        derived=row.locator('.derived-cell')
        assert derived.nth(1).inner_text()=='2'
        assert derived.nth(2).inner_text()=='32'
        links.first.click()
        assert page.locator('#record-title').count()==1
        assert page.locator('.record-fields').count()==1
        page.locator('#pages-list .page-link').filter(has_text='取引先').click()
        page.get_by_role('button',name='アーカイブ').click()
        assert page.locator('.archived-db-entry').count()==1
        assert page.locator('#pages-list .page-link').filter(has_text='取引先').count()==0
        page.locator('.archived-db-entry button').click()
        page.locator('#pages-list .page-link').filter(has_text='取引先').click()
        assert page.locator('.task-table tbody tr').count()==1
        assert page.locator('.task-table tbody .derived-cell').nth(2).inner_text()=='32'
        saved=page.evaluate("localStorage.getItem('vctrmemo-v2')")
        restored=context.new_page()
        boot(restored,saved)
        restored.locator('#pages-list .page-link').filter(has_text='取引先').click()
        assert restored.locator('.derived-link').count()==2
        assert restored.locator('.task-table tbody .derived-cell').nth(1).inner_text()=='2'
        assert restored.locator('.task-table tbody .derived-cell').nth(2).inner_text()=='32'
        print('vctrmemo v0.8 browser: create relation with reverse links, count/sum, archive/restore, reload PASS')
        context.close()
    finally:
        browser.close()

