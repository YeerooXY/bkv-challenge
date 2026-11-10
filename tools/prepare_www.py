"""Copy the web app into www/ for the Android wrapper. Skips the service worker (not needed in the app)."""
import json
import os
import shutil
from pathlib import Path

ROOT = Path(__file__).parents[1]
WWW = ROOT / "www"
if WWW.exists():
    shutil.rmtree(WWW)
WWW.mkdir()
for name in ("index.html", "manifest.webmanifest"):
    shutil.copy(ROOT / name, WWW / name)
for folder in ("css", "js", "data", "icons"):
    shutil.copytree(ROOT / folder, WWW / folder, ignore=shutil.ignore_patterns("models.json"))
(WWW / "version.json").write_text(json.dumps({"build": int(os.environ.get("GITHUB_RUN_NUMBER", "0"))}), encoding="utf-8")
print("www ready:", sum(1 for _ in WWW.rglob("*") if _.is_file()), "files")
