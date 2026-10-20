from pathlib import Path
from shutil import which
from playwright.sync_api import sync_playwright

ROOT=Path(__file__).parent.parent

def boot(page, snapshot=None):
    page.set_content((ROOT/'index.html').read_text())
    page.evaluate("""saved => {
      const store=new Map(saved?[['vctrmemo-v2',saved]]:[]);
      Object.defineProperty(window,'localStorage',{configurable:true,value:{
        getItem:key=>store.get(key)||null,
        setItem:(key,value)=>store.set(key,String(value)),
        removeItem:key=>store.delete(key)
      }});
      window.confirm=()=>true;
    }""",snapshot)
    page.add_style_tag(content=(ROOT/'styles.css').read_text())
    for script in ('sync-core.js','transfer.js','app.js'):
        page.add_script_tag(content=(ROOT/script).read_text())
    page.locator('.metric-strip').wait_for(timeout=10000)

with sync_playwright() as p:
    browser=p.chromium.launch(executable_path=which('chromium'),headless=True,args=['--no-sandbox'])
    try:
        context=browser.new_context(viewport={'width':1350,'height':960})
        page=context.new_page()
        boot(page)
        # Legacy tasks remain assigned to the original database.
        page.locator('#pages-list .page-link').filter(has_text='データベース').click()
        assert page.locator('.task-table tbody tr').count()==4
        # Create a separate database with its own rows and columns.
        page.once('dialog',lambda dialog: dialog.accept('研究DB'))
        page.locator('#pages-list .sidebar-section-label button').click()
        assert page.locator('.hero-title').inner_text()=='研究DB'
        assert page.locator('.task-table tbody tr').count()==0
        page.get_by_role('button',name='＋ 新しいタスク').click()
        assert page.locator('.task-table tbody tr').count()==1
        page.locator('.task-table tbody tr input[aria-label="タスク名"]').fill('調査専用レコード')
        page.locator('#pages-list .page-link').filter(has_text='データベース').click()
        assert page.locator('.task-table tbody tr').count()==4
        assert '調査専用レコード' not in page.locator('.task-table').inner_text()
        # Embed the same new database in an existing page, not a copy.
        page.locator('#pages-list .tree-item').first.click()
        page.get_by_role('button',name='＋ ブロックを追加').click()
        page.get_by_role('button',name='データベースを埋め込む').click()
        selector=page.locator('.database-embed-controls select[aria-label="埋め込みデータベース"]')
        selector.select_option(label='研究DB')
        assert page.locator('.embedded-database .task-table tbody tr').count()==1
        page.locator('.embedded-database .add-row button').click()
        assert page.locator('.embedded-database .task-table tbody tr').count()==2
        page.locator('.embedded-database .task-table tbody tr').last.locator('input[aria-label="タスク名"]').fill('埋め込み経由')
        page.locator('.embedded-database-header button').click()
        assert page.locator('.hero-title').inner_text()=='研究DB'
        assert page.locator('.task-table tbody tr').count()==2
        assert '埋め込み経由' in page.locator('.task-table tbody tr').last.locator('input[aria-label="タスク名"]').input_value()
        stored=page.evaluate("localStorage.getItem('vctrmemo-v2')")
        ops=page.evaluate("JSON.parse(localStorage.getItem('vctrmemo-v2')).sync.ops")
        assert any('"D"' in op['key'] for op in ops)
        assert any('dbId' in op['key'] for op in ops)
        assert any(op['value']=='database' for op in ops if op['key'].endswith('type"]'))
        # Reload and verify the page embed and distinct database content survive.
        restored=context.new_page()
        boot(restored,stored)
        restored.locator('#pages-list .tree-item').first.click()
        assert restored.locator('.database-embed-controls select').input_value()!=''
        assert restored.locator('.embedded-database .task-table tbody tr').count()==2
        restored.locator('#pages-list .page-link').filter(has_text='データベース').click()
        assert restored.locator('.task-table tbody tr').count()==4
        print('vctrmemo v0.6 browser: independent databases, inline editing, shared records, persistence PASS')
        context.close()
    finally:
        browser.close()
