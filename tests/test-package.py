from pathlib import Path
from zipfile import ZipFile

root = Path(__file__).resolve().parent.parent
out = root / 'dist'
with ZipFile(out / 'vctrmemo.xdc') as z:
    assert z.testzip() is None
    assert 'manifest.toml' in z.namelist()
    assert 'index.html' in z.namelist()
    assert 'src="webxdc.js"' in z.read('index.html').decode()
    assert 'name = "vctrmemo"' in z.read('manifest.toml').decode()
    assert not any(k.startswith(('.git', 'tests/', 'scripts/')) for k in z.namelist())
preview = (out / 'site/index.html').read_text()
assert 'src="webxdc.js"' not in preview
assert 'vctrmemo' in preview
assert (out / 'site/vctrmemo.xdc').read_bytes() == (out / 'vctrmemo.xdc').read_bytes()
assert not (out / 'site/README.md').exists()
print('vctrmemo packaging and preview verification PASS')
