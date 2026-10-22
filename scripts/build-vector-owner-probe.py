#!/usr/bin/env python3
"""Synthetic-only WebXDC owner-device realtime diagnostic: no vctrmemo app files."""
from pathlib import Path
from zipfile import ZipFile, ZipInfo, ZIP_DEFLATED

ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'dist'/'probes'
XDC=OUT/'vctrmemo-owner-realtime-test.xdc'
FILES=('vector-live/probe-core.mjs','vector-live/probe-ui.mjs')
HTML="""<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>vctrmemo · Vector owner realtime diagnostic</title>
<script src="webxdc.js"></script>
</head>
<body style="margin:0;background:#0a1610;color:#e4ece6;font:14px system-ui;padding:20px">
<h1>vctrmemo · 通信診断</h1>
<p>個人メモは使用しません。画面右下の「Vector本人2端末・通信診断」を開いてください。</p>
<script type="module" src="vector-live/probe-ui.mjs"></script>
</body>
</html>
"""
MANIFEST='name = "vctrmemo Owner Realtime Test"\n'
def build():
    OUT.mkdir(parents=True,exist_ok=True)
    data={
        'index.html':HTML.encode('utf-8'),
        'manifest.toml':MANIFEST.encode('utf-8'),
    }
    for file in FILES:
        data[file]=(ROOT/file).read_bytes()
    with ZipFile(XDC,'w',compression=ZIP_DEFLATED,compresslevel=9) as z:
        for name,content in data.items():
            meta=ZipInfo(name,date_time=(2020,1,1,0,0,0))
            meta.compress_type=ZIP_DEFLATED
            meta.external_attr=0o644<<16
            z.writestr(meta,content)
    with ZipFile(XDC) as z:
        assert z.testzip() is None
        assert set(z.namelist())==set(data)
        assert 'vector-live/probe-ui.mjs' in z.read('index.html').decode('utf-8')
        assert b'joinRealtimeChannel' in z.read('vector-live/probe-core.mjs')
        assert b'localStorage' not in z.read('vector-live/probe-core.mjs')
        assert b'localStorage' not in z.read('vector-live/probe-ui.mjs')
        assert 'app.js' not in z.namelist()
        assert 'sync-core.js' not in z.namelist()
        assert 'transfer.js' not in z.namelist()
    print(f'isolated synthetic-only Vector diagnostic XDC built: {XDC.stat().st_size} bytes')
if __name__=='__main__':
    build()
