"""Draws the app icons (soccer ball on a green pitch) with Pillow.
Run:  python3 tools/make_icons.py   (only needed if you want to change them)"""
import math, os
from PIL import Image, ImageDraw, ImageFilter

OUT = os.path.join(os.path.dirname(__file__), "..", "public", "icons")
S = 1024  # draw big, then shrink for smooth edges

def pentagon(cx, cy, r, rot):
    return [(cx + r * math.cos(rot + i * 2 * math.pi / 5), cy + r * math.sin(rot + i * 2 * math.pi / 5)) for i in range(5)]

def draw_icon(ball_scale):
    img = Image.new("RGB", (S, S), "#1e7a35")
    d = ImageDraw.Draw(img)
    # mown stripes
    stripes = 8
    for i in range(stripes):
        if i % 2:
            d.rectangle([i * S / stripes, 0, (i + 1) * S / stripes, S], fill="#238a3d")
    # pitch markings
    lw = int(S * 0.018)
    d.line([(S / 2, 0), (S / 2, S)], fill="#e8f5e9", width=lw)
    cr = S * 0.36 * ball_scale / 0.62 if ball_scale < 0.6 else S * 0.40
    d.ellipse([S / 2 - cr, S / 2 - cr, S / 2 + cr, S / 2 + cr], outline="#e8f5e9", width=lw)
    # ball shadow
    br = S * 0.5 * ball_scale / 2 * 1.0
    br = S * ball_scale / 2
    shadow = Image.new("L", (S, S), 0)
    ImageDraw.Draw(shadow).ellipse([S / 2 - br * 0.95, S / 2 - br * 0.55 + br * 0.9, S / 2 + br * 0.95, S / 2 + br * 0.55 + br * 0.9], fill=110)
    shadow = shadow.filter(ImageFilter.GaussianBlur(S * 0.02))
    img.paste((10, 40, 15), (0, 0), shadow)
    # ball
    ball = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    bd = ImageDraw.Draw(ball)
    cx, cy = S / 2, S / 2 - br * 0.05
    bd.ellipse([cx - br, cy - br, cx + br, cy + br], fill="#ffffff")
    rot = -math.pi / 2
    pr = br * 0.36
    bd.polygon(pentagon(cx, cy, pr, rot), fill="#151515")
    for i in range(5):  # outer patches, partly hidden behind the ball edge
        a = rot + i * 2 * math.pi / 5
        px, py = cx + br * 0.86 * math.cos(a), cy + br * 0.86 * math.sin(a)
        bd.polygon(pentagon(px, py, pr * 0.95, a + math.pi), fill="#151515")
        # seams from centre pentagon corners to outer patches
        vx, vy = cx + pr * math.cos(a), cy + pr * math.sin(a)
        bd.line([(vx, vy), (cx + br * 0.62 * math.cos(a), cy + br * 0.62 * math.sin(a))], fill="#333", width=int(S * 0.008))
    mask = Image.new("L", (S, S), 0)
    ImageDraw.Draw(mask).ellipse([cx - br, cy - br, cx + br, cy + br], fill=255)
    # soft shading (light top-left)
    shade = Image.new("L", (S, S), 0)
    ImageDraw.Draw(shade).ellipse([cx - br * 0.55, cy + br * 0.15, cx + br * 1.25, cy + br * 1.6], fill=70)
    shade = shade.filter(ImageFilter.GaussianBlur(br * 0.25))
    ball_rgb = ball.convert("RGB")
    ball_rgb.paste((40, 60, 80), (0, 0), shade)
    img.paste(ball_rgb, (0, 0), Image.composite(ball.split()[3], Image.new("L", (S, S), 0), mask))
    ImageDraw.Draw(img).ellipse([cx - br, cy - br, cx + br, cy + br], outline="#222", width=int(S * 0.008))
    return img

normal = draw_icon(0.62)     # ball fills most of the icon
maskable = draw_icon(0.46)   # smaller ball: stays inside Android's safe circle
for size, name, src in [(180, "apple-touch-icon.png", normal), (192, "icon-192.png", normal), (512, "icon-512.png", normal),
                        (192, "maskable-192.png", maskable), (512, "maskable-512.png", maskable), (32, "favicon-32.png", normal)]:
    src.resize((size, size), Image.LANCZOS).save(os.path.join(OUT, name), optimize=True)
print("icons written to", os.path.abspath(OUT))
