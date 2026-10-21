from pathlib import Path
from zipfile import ZipFile
root=Path(__file__).resolve().parents[2]
page=(root/'dist/site/index.html').read_text()
assert '<script type="module" src="owner-sync.js"></script>' in page
bundle=root/'dist/site/owner-sync.js'
assert bundle.is_file() and bundle.stat().st_size>10000
with ZipFile(root/'dist/vctrmemo.xdc') as z:
    assert 'owner-sync.js' not in z.namelist()
    assert 'owner-sync' not in z.read('index.html').decode('utf8')
    assert 'src="webxdc.js"' in z.read('index.html').decode('utf8')
print('owner sync packaging: only browser preview opts into network sync; Vector XDC remains isolated PASS')
