from playwright.sync_api import sync_playwright
from pathlib import Path
from shutil import which
ROOT=Path(__file__).parent.parent
with sync_playwright() as p:
    browser=p.chromium.launch(executable_path=which('chromium'),headless=True,args=['--no-sandbox'])
    try:
        ctx=browser.new_context(viewport={'width':1200,'height':950})
        page=ctx.new_page()
        def open_client(pg,snapshot=None):
            pg.set_content((ROOT/'index.html').read_text())
            pg.evaluate('''data => {
                const store = new Map(data?[['vctrmemo-v2',data]]:[]);
                Object.defineProperty(window,'localStorage',{configurable:true,value:{
                    getItem:k=>store.get(k)||null, setItem:(k,v)=>store.set(k,String(v)), removeItem:k=>store.delete(k)
                }});
                window.confirm=()=>true;
            }''',snapshot)
            pg.add_style_tag(content=(ROOT/'styles.css').read_text())
            for script in ['sync-core.js','transfer.js','app.js']:
                pg.add_script_tag(content=(ROOT/script).read_text())
            pg.locator('.metric-strip').wait_for(timeout=10000)
        open_client(page)
        page.wait_for_selector('.metric-strip')
        page.locator('#pages-list .tree-item').first.click()
        page.get_by_role('button',name='＋ 子ページ').click()
        page.locator('#doc-title').fill('機能検証の子ページ')
        page.wait_for_function("document.querySelector('#pages-list').innerText.includes('機能検証の子ページ')")
        child=page.locator('#pages-list .tree-item').filter(has_text='機能検証の子ページ')
        assert child.get_attribute('data-depth')=='1'
        assert page.locator('#parent-select').input_value()=='welcome'
        page.locator('#parent-select').select_option('')
        assert page.locator('#pages-list .tree-item').filter(has_text='機能検証の子ページ').get_attribute('data-depth')=='0'
        # Create columns of different types and edit values.
        page.locator('.page-link').filter(has_text='データベース').click()
        page.on('dialog',lambda d:d.accept('見積額' if '名前' in d.message else 'number'))
        page.get_by_role('button',name='＋ 列を追加').click()
        assert page.locator('th').filter(has_text='見積額').count()==1
        assert page.locator('input[data-column-id]').count()==4
        page.locator('input[data-column-id]').first.fill('150')
        page.locator('input[data-column-id]').first.dispatch_event('change')
        page.locator('#sort-field').select_option(page.locator('#sort-field option').last.get_attribute('value'))
        page.locator('#sort-direction').select_option('desc')
        page.locator('#filter-field').select_option('all')
        page.locator('#filter-query').fill('150')
        page.locator('#filter-query').dispatch_event('change')
        assert page.locator('.task-table tbody tr').count()==1
        assert page.locator('.result-count').inner_text().startswith('1 / 4')
        page.locator('#filter-query').fill('')
        page.locator('#filter-query').dispatch_event('change')
        page.get_by_role('button',name='▥ カンバン').click()
        assert page.locator('.board-card').count()==4
        data=page.evaluate("JSON.parse(localStorage.getItem('vctrmemo-v2'))")
        assert data['sync']['version']==2
        assert any('"C"' in op['key'] for op in data['sync']['ops'])
        assert any('"V"' in op['key'] for op in data['sync']['ops'])
        stored=page.evaluate("localStorage.getItem('vctrmemo-v2')")
        new_page=ctx.new_page()
        open_client(new_page,stored)
        new_page.locator('.page-link').filter(has_text='データベース').click()
        assert new_page.locator('th').filter(has_text='見積額').count()==1
        assert new_page.locator('input[data-column-id]').first.input_value()=='150'
        assert new_page.locator('#pages-list .tree-item').filter(has_text='機能検証の子ページ').count()==1
        print('vctrmemo v0.4 browser: create/move subpage, add numeric column, persist value, filter, sort, board, reload PASS')
        ctx.close()
    finally:
        browser.close()
