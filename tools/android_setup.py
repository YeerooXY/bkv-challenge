"""Customize the generated Capacitor android/ project: camera permission, version, launcher icons.

Usage: python tools/android_setup.py VERSION_CODE VERSION_NAME   (run after `npx cap add android`)
"""
import re
import sys
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).parents[1]
ANDROID = ROOT / "android"
RES = ANDROID / "app" / "src" / "main" / "res"
BG = "#0f766e"


def patch_manifest():
    p = ANDROID / "app" / "src" / "main" / "AndroidManifest.xml"
    s = p.read_text(encoding="utf-8")
    extra = (
        '    <uses-permission android:name="android.permission.CAMERA" />\n'
        '    <uses-feature android:name="android.hardware.camera" android:required="false" />\n'
    )
    if "android.permission.CAMERA" not in s:
        s = s.replace("</manifest>", extra + "</manifest>")
    p.write_text(s, encoding="utf-8")


def patch_version(code, name):
    p = ANDROID / "app" / "build.gradle"
    s = p.read_text(encoding="utf-8")
    s = re.sub(r"versionCode\s+\d+", f"versionCode {code}", s)
    s = re.sub(r'versionName\s+"[^"]*"', f'versionName "{name}"', s)
    p.write_text(s, encoding="utf-8")


def icons():
    src = Image.open(ROOT / "icons" / "icon-512.png").convert("RGBA")
    legacy = {"mdpi": 48, "hdpi": 72, "xhdpi": 96, "xxhdpi": 144, "xxxhdpi": 192}
    for d, px in legacy.items():
        out = RES / f"mipmap-{d}"
        for n in ("ic_launcher.png", "ic_launcher_round.png"):
            src.resize((px, px), Image.LANCZOS).save(out / n)
        # Adaptive foreground: 108dp canvas, artwork kept inside the central safe zone.
        canvas = px * 108 // 48
        fg = Image.new("RGBA", (canvas, canvas), (0, 0, 0, 0))
        art = src.resize((canvas * 62 // 100, canvas * 62 // 100), Image.LANCZOS)
        fg.paste(art, ((canvas - art.width) // 2, (canvas - art.height) // 2), art)
        fg.save(out / "ic_launcher_foreground.png")
    for f in RES.glob("values*/ic_launcher_background.xml"):
        f.write_text(f'<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">{BG}</color>\n</resources>\n', encoding="utf-8")


patch_manifest()
patch_version(sys.argv[1], sys.argv[2])
icons()
print("android project customized")
