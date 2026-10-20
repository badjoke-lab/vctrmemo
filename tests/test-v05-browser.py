from pathlib import Path
from shutil import which
from playwright.sync_api import sync_playwright

ROOT=Path(__file__).parent.parent
with sync_playwright() as p:
    browser=p.chromium.launch(executable_path=which('chromium'),headless=True,args=['--no-sandbox'])
    try:
        ctx=browser.new_context(viewport={'width':1280,'height':950})
        def open_client(pg, saved=None):
            pg.set_content((ROOT/'index.html').read_text())
            pg.evaluate('''value => {
                const store=new Map(value?[['vctrmemo-v2',value]]:[]);
                Object.defineProperty(window,'localStorage',{configurable:true,value:{
                    getItem:key=>store.get(key)||null,
                    setItem:(key,value)=>store.set(key,String(value)),
                    removeItem:key=>store.delete(key)}});
                window.confirm=()=>true;
            }''',saved)
            pg.add_style_tag(content=(ROOT/'styles.css').read_text())
            for s in ('sync-core.js','transfer.js','app.js'):
                pg.add_script_tag(content=(ROOT/s).read_text())
            pg.locator('.metric-strip').wait_for()
        page=ctx.new_page()
        open_client(page)
        # Create two normal pages; link one to the other.
        page.locator('#new-page').click()
        page.locator('#doc-title').fill('設計ページ')
        first_id=page.locator('#pages-list .active').get_attribute('data-depth')
        page.locator('#new-page').click()
        page.locator('#doc-title').fill('参照ページ')
        page.locator('#pages-list .tree-item').filter(has_text='設計ページ').click()
        page.get_by_role('button',name='＋ ブロックを追加').click()
        page.get_by_role('button',name='ページへのリンク').click()
        link=page.locator('.page-link-block')
        link.locator('select').select_option(label='参照ページ')
        assert '参照ページ' in link.locator('button').inner_text()
        link.locator('button').click()
        assert page.locator('#doc-title').input_value()=='参照ページ'
        assert page.locator('.backlinks').get_by_role('button',name='設計ページ').count()==1
        page.locator('.backlinks').get_by_role('button',name='設計ページ').click()
        # Create a task detail page and edit its rich text body.
        page.locator('.page-link').filter(has_text='データベース').click()
        page.locator('.task-table .record-open').first.click()
        page.locator('#record-title').fill('詳細ページのあるタスク')
        page.get_by_role('button',name='＋ ブロックを追加').click()
        page.get_by_role('button',name='テキスト').click()
        page.locator('.block-edit').fill('タスク固有のメモ本文')
        assert page.locator('#pages-list .tree-item').filter(has_text='詳細ページのあるタスク').count()==0
        page.get_by_role('button',name='← データベースへ戻る').click()
        assert page.locator('.task-table tbody tr').first.locator('input[aria-label="タスク名"]').input_value()=='詳細ページのあるタスク'
        # Change type only if stored values are compatible. A failed edit must be atomic.
        answers=iter(['見積額','text','金額','number','金額チェック','checkbox'])
        page.on('dialog',lambda d:d.accept(next(answers)) if d.type=='prompt' else d.accept())
        page.get_by_role('button',name='＋ 列を追加').click()
        head=page.locator('.task-table th').filter(has_text='見積額')
        assert head.count()==1
        col_id=page.locator('input[data-column-id]').first.get_attribute('data-column-id')
        page.locator('.task-table tbody tr').first.locator(f'input[data-column-id="{col_id}"]').fill('123.5')
        head.locator('.column-settings').click()
        assert page.locator('.task-table th').filter(has_text='金額').count()==1
        assert page.locator(f'input[data-column-id="{col_id}"]').first.get_attribute('type')=='number'
        page.locator('.task-table th').filter(has_text='金額').locator('.column-settings').click()
        assert page.locator('.task-table th').filter(has_text='金額チェック').count()==0
        assert page.locator('.task-table th').filter(has_text='金額').count()==1
        assert page.locator(f'input[data-column-id="{col_id}"]').first.input_value()=='123.5'
        snapshot=page.evaluate("localStorage.getItem('vctrmemo-v2')")
        ops=page.evaluate("JSON.parse(localStorage.getItem('vctrmemo-v2')).sync.ops")
        assert any('targetId' in op['key'] and op['value']!='' for op in ops)
        assert any('taskId' in op['key'] and op['value']=='task-1' for op in ops)
        # Simulate full browser reload with existing local data.
        restored=ctx.new_page();open_client(restored,snapshot)
        restored.locator('.page-link').filter(has_text='データベース').click()
        assert restored.locator('.task-table th').filter(has_text='金額').count()==1
        restored.locator('.task-table .record-open').first.click()
        assert restored.locator('#record-title').input_value()=='詳細ページのあるタスク'
        assert restored.locator('.block-edit').first.inner_text()=='タスク固有のメモ本文'
        restored.locator('#pages-list .tree-item').filter(has_text='設計ページ').click()
        assert '参照ページ' in restored.locator('.page-link-block button').inner_text()
        print('vctrmemo v0.5 browser: link navigation/backlinks, task document, safe rename/type, persistence PASS')
        ctx.close()
    finally:
        browser.close()
