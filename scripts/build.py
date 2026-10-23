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
VERSION = "0.12"


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

    # Opt-in, private-link browser-only workspace. Never reads legacy local notes.
    linked_dir = SITE / "synced"
    linked_dir.mkdir(parents=True, exist_ok=True)
    linked = preview.replace('href="styles.css"', 'href="../styles.css"')
    linked = linked.replace('src="sync-core.js"', 'src="../sync-core.js"')
    linked = linked.replace('src="transfer.js"', 'src="../transfer.js"')
    if 'src="app.js" defer' not in linked:
        raise ValueError("Cannot locate the app bootstrap script")
    linked = linked.replace('  <script src="app.js" defer></script>', '')
    linked = linked.replace('</body>', '  <script type="module" src="link-bootstrap.mjs"></script>\n</body>', 1)
    (linked_dir / "index.html").write_text(linked, encoding="utf-8")
    source = (ROOT / "app.js").read_text(encoding="utf-8")
    old_key = "const STORAGE_KEY = 'vctrmemo-v2';"
    if source.count(old_key) != 1:
        raise ValueError("Cannot patch per-workspace browser storage")
    # Only the browser build is rewritten. Main app and WebXDC remain unchanged.
    source = source.replace(old_key, "const STORAGE_KEY = window.__vctrmemo_owner_storage_key; if(!STORAGE_KEY)throw Error('Workspace scope missing');")
    # Browser-only view preservation. sessionStorage is per-tab and keeps private
    # page navigation across reloads without copying it to another device.
    view_init = "let view = 'home';"
    view_save = "function setView(next){ view=next; pickerFor=null;render();closeSidebar(); }"
    if source.count(view_init) != 1 or source.count(view_save) != 1:
        raise ValueError("Cannot patch last-opened page persistence")
    source = source.replace(view_init, """let view = 'home';
  const VIEW_KEY = 'vctrmemo-last-view:' + STORAGE_KEY;
  try {
    const savedView = sessionStorage.getItem(VIEW_KEY);
    if (typeof savedView === 'string' && savedView.length > 0 && savedView.length < 160) view = savedView;
  } catch (err) { console.warn('Cannot restore last page', err); }""")
    source = source.replace(view_save, """function setView(next){
    view=next;
    try { sessionStorage.setItem(VIEW_KEY,next); } catch (err) { console.warn('Cannot store last page', err); }
    pickerFor=null;render();closeSidebar();
  }""")
    (linked_dir / "app.js").write_text(source, encoding="utf-8")
    (linked_dir / "link-bootstrap.mjs").write_bytes((ROOT / "owner-sync/link-bootstrap.mjs").read_bytes())
    for filename in APP_FILES:
        if filename not in ("index.html", "manifest.toml"):
            (SITE / filename).write_bytes((ROOT / filename).read_bytes())
    # A stable name, no source archive or secrets exposed on Pages.
    (SITE / "vctrmemo.xdc").write_bytes(xdc_path.read_bytes())
    (SITE / ".nojekyll").write_text("", encoding="utf-8")
    print(f"built vctrmemo v{VERSION}: {xdc_path.stat().st_size} bytes; preview in {SITE}")


if __name__ == "__main__":
    build()
