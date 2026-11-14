#!/usr/bin/env python3
"""Package a synthetic-only v0.5.1 WebXDC transport test without user data.

The result is a separate .xdc file, never a replacement for vctrmemo.xdc.
"""
from pathlib import Path
from zipfile import ZipFile, ZipInfo, ZIP_DEFLATED

ROOT=Path(__file__).resolve().parents[1]
OUTPUT=ROOT/'dist'/'probes'/'vctrmemo-vector-v051-diagnostic.xdc'
FILES=('vector-live/probe-core.mjs','vector-live/v051-probe-ui.mjs')
HTML="""<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>vctrmemo · Vector v0.5.1 診断</title>
<script src="webxdc.js"></script>
</head>
<body style="margin:0;background:#0a1610;color:#e4ece6">
<script type="module" src="vector-live/v051-probe-ui.mjs"></script>
</body>
</html>
"""
MANIFEST="""name = "vctrmemo Vector v0.5.1 Diagnostic"
id = "vctrmemo-vector-v051-diagnostic"
version = "0.5.1-test.1"
description = "Synthetic-only Vector Mini App same-account device connectivity test"
source_code_url = "https://github.com/badjoke-lab/vctrmemo"
"""

def build():
    OUTPUT.parent.mkdir(parents=True,exist_ok=True)
    data={'index.html':HTML.encode('utf-8'),'manifest.toml':MANIFEST.encode('utf-8')}
    for path in FILES:
        data[path]=(ROOT/path).read_bytes()
    with ZipFile(OUTPUT,'w',compression=ZIP_DEFLATED,compresslevel=9) as archive:
        for path,contents in data.items():
            item=ZipInfo(path,date_time=(2020,1,1,0,0,0))
            item.external_attr=0o644 << 16
            item.compress_type=ZIP_DEFLATED
            archive.writestr(item,contents)
    with ZipFile(OUTPUT) as archive:
        assert archive.testzip() is None
        assert set(archive.namelist())==set(data)
        assert b'joinRealtimeChannel' in archive.read('vector-live/probe-core.mjs')
        assert b'vctrmemo' in archive.read('vector-live/v051-probe-ui.mjs')
        assert b'webxdc.js' in archive.read('index.html')
        assert b'recovery' not in archive.read('index.html')
        assert not any('owner-sync' in x or 'app.js' in x or 'backup' in x for x in archive.namelist())
        for name in FILES:
            assert b'localStorage' not in archive.read(name)
            assert b'indexedDB' not in archive.read(name)
    print('Vector v0.5.1 isolated real-device diagnostic: '+str(OUTPUT))

if __name__=='__main__':
    build()
