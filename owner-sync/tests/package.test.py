from pathlib import Path
from zipfile import ZipFile
root=Path(__file__).resolve().parents[2]
site=root/'dist/site'
normal=(site/'index.html').read_text()
linked=(site/'synced/index.html').read_text()
scoped=(site/'synced/app.js').read_text()
bootstrap=(site/'synced/link-bootstrap.mjs').read_text()
assert 'owner-sync.js' not in normal
assert '<script type="module" src="link-bootstrap.mjs"></script>' in linked
assert '<script src="../sync-core.js" defer></script>' in linked
assert 'window.__vctrmemo_owner_storage_key' in scoped
assert "const STORAGE_KEY = 'vctrmemo-v2'" not in scoped
assert "sessionStorage.getItem(VIEW_KEY)" in scoped
assert "sessionStorage.setItem(VIEW_KEY,next)" in scoped
assert '#k=' in bootstrap and 'crypto.subtle.digest' in bootstrap
bundle=site/'owner-sync.js'
assert bundle.is_file() and bundle.stat().st_size>10000
with ZipFile(root/'dist/vctrmemo.xdc') as z:
    assert 'owner-sync.js' not in z.namelist()
    assert 'synced/index.html' not in z.namelist()
    assert 'owner-sync' not in z.read('index.html').decode()
    assert "const STORAGE_KEY = 'vctrmemo-v2'" in z.read('app.js').decode()
    assert 'src="webxdc.js"' in z.read('index.html').decode()
print('browser-only private-link sync: isolated local records, original main preview and Vector XDC unchanged PASS')
