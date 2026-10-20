#!/usr/bin/env python3
"""Create a reproducible WebXDC and a browser-only static preview from audited files."""
from pathlib import Path
import re
import sys
from zipfile import ZipFile, ZipInfo, ZIP_DEFLATED

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "dist"
SITE = OUT / "site"
APP_FILES = ("index.html", "styles.css", "sync-core.js", "transfer.js", "app.js", "manifest.toml")
VERSION = "0.4"


def build():
    for filename in APP_FILES:
        if not (ROOT / filename).is_file():
            raise FileNotFoundError(filename)
    manifest = (ROOT / "manifest.toml").read_text(encoding="utf-8")
    if not re.search(r'^name\s*=\s*"vctrmemo"\s*$', manifest, re.MULTILINE):
        raise ValueError("manifest application name must be vctrmemo")
    page = (ROOT / "index.html").read_text(encoding="utf-8")
    if 'src="webxdc.js"' not in page:
        raise ValueError("Vector package must include the WebXDC bridge script")

    SITE.mkdir(parents=True, exist_ok=True)
    xdc_path = OUT / "vctrmemo.xdc"
    # Fixed ZIP times and explicit allowlist to exclude secrets, tests and repository metadata.
    with ZipFile(xdc_path, "w", compression=ZIP_DEFLATED, compresslevel=9) as z:
        for filename in APP_FILES:
            metadata = ZipInfo(filename, date_time=(2020, 1, 1, 0, 0, 0))
            metadata.compress_type = ZIP_DEFLATED
            metadata.external_attr = 0o644 << 16
            z.writestr(metadata, (ROOT / filename).read_bytes(), compress_type=ZIP_DEFLATED, compresslevel=9)
    with ZipFile(xdc_path) as z:
        if z.testzip() is not None or set(z.namelist()) != set(APP_FILES):
            raise ValueError("invalid WebXDC archive")

    # Browser preview: no WebXDC host bridge. It stores user data only in localStorage.
    preview = page.replace('  <script src="webxdc.js"></script>\n', '')
    if 'src="webxdc.js"' in preview:
        raise ValueError("WebXDC host bridge script was not removed")
    preview = preview.replace('</head>', '  <style>#sync-now{display:none!important}</style>\n</head>', 1)
    (SITE / "index.html").write_text(preview, encoding="utf-8")
    for filename in APP_FILES:
        if filename not in ("index.html", "manifest.toml"):
            (SITE / filename).write_bytes((ROOT / filename).read_bytes())
    # A stable name, no source archive or secrets exposed on Pages.
    (SITE / "vctrmemo.xdc").write_bytes(xdc_path.read_bytes())
    (SITE / ".nojekyll").write_text("", encoding="utf-8")
    print(f"built vctrmemo v{VERSION}: {xdc_path.stat().st_size} bytes; preview in {SITE}")


if __name__ == "__main__":
    build()
