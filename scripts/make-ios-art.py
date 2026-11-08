#!/usr/bin/env python3
"""Build the icon and splash sources for @capacitor/assets.

The app icon comes from icons/icon-512.png.
The launch image comes from assets/cover.png on the same green.
Output is resources/ (not assets/, so the website cover is left alone).

You do not need this to run the app. The pictures are already in the
Xcode project. Run it only if the cover art changes, then:

  python3 scripts/make-ios-art.py
  npx @capacitor/assets generate --ios --assetPath resources
"""
import os
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "resources")
os.makedirs(OUT, exist_ok=True)

icon = Image.open(os.path.join(ROOT, "icons", "icon-512.png")).convert("RGBA")
bg = icon.getpixel((2, 2))
icon.resize((1024, 1024), Image.Resampling.LANCZOS).save(os.path.join(OUT, "icon-only.png"))

cover = Image.open(os.path.join(ROOT, "assets", "cover.png")).convert("RGBA")
side = 2732
splash = Image.new("RGBA", (side, side), bg)
target_w = int(side * 0.88)
scale = target_w / cover.width
target_h = max(1, int(cover.height * scale))
fitted = cover.resize((target_w, target_h), Image.Resampling.LANCZOS)
splash.paste(fitted, ((side - target_w) // 2, (side - target_h) // 2), fitted)
splash.convert("RGB").save(os.path.join(OUT, "splash.png"), optimize=True)
print("wrote resources/icon-only.png and resources/splash.png", bg)
