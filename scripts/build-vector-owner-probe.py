#!/usr/bin/env python3
"""Build an isolated, synthetic-only Vector realtime diagnostic XDC.

The normal vctrmemo release and local data are not modified.
"""
from pathlib import Path
from zipfile import ZipFile, ZipInfo, ZIP_DEFLATED
import re

ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'dist'/'probes'
FILES=['index.html','styles.css','sync-core.js','transfer.js','app.js','manifest.toml',
       'vector-live/probe-core.mjs','vector-live/probe-ui.mjs']
XDC=OUT/'vctrmemo-owner-realtime-test.xdc'

def build():
    OUT.mkdir(parents=True,exist_ok=True)
    with ZipFile(XDC,'w',compression=ZIP_DEFLATED,compresslevel=9) as z:
        for file in FILES:
            data=(ROOT/file).read_bytes()
            if file=='index.html':
                text=data.decode('utf-8')
                assert 'src="webxdc.js"' in text
                text=text.replace('</body>','  <script type="module" src="vector-live/probe-ui.mjs"></script>\n</body>',1)
                data=text.encode('utf-8')
            if file=='manifest.toml':
                text=data.decode('utf-8')
                text,count=re.subn(r'^name\s*=\s*"vctrmemo"\s*$', 'name = "vctrmemo Owner Realtime Test"',text,count=1,flags=re.M)
                assert count==1
                data=text.encode('utf-8')
            info=ZipInfo(file,date_time=(2020,1,1,0,0,0))
            info.compress_type=ZIP_DEFLATED
            info.external_attr=0o644<<16
            z.writestr(info,data)
    with ZipFile(XDC) as z:
        assert not z.testzip()
        assert set(z.namelist())==set(FILES)
        assert b'joinRealtimeChannel' in z.read('vector-live/probe-core.mjs')
        assert b'vector-live/probe-ui.mjs' in z.read('index.html')
        assert b'owner-sync' not in z.read('index.html')
    print(f'isolated Vector owner realtime probe built: {XDC.stat().st_size} bytes')
if __name__=='__main__':
    build()
