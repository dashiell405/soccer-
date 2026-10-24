"""Build the Home Screen icons from assets/cover.png.

A square center crop would cut the STADIUM SOCCER title in half, so each
icon is a square of the blurred stadium with the logo plate and the
center of the pitch (ball included) scaled to fit. On the maskable
icons that artwork sits inside the central 80% safe zone.

Run from anywhere:  python3 multiplayer/tools/make_icons.py
"""
import os
from PIL import Image, ImageFilter, ImageEnhance, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
COVER = os.path.join(ROOT, "assets", "cover.png")
OUT = os.path.join(HERE, "..", "public", "icons")
S = 1024


def fit_width(im, width):
    w, h = im.size
    height = max(1, int(round(h * (width / float(w)))))
    return im.resize((width, height), Image.LANCZOS)


def square_background(src):
    """Extend the green pitch into a square, then blur the stadium behind it.

    The title is drawn again as sharp artwork, so the background is only
    the pitch band. A blurred copy of the whole banner would ghost a
    second STADIUM SOCCER behind the real one.
    """
    w, h = src.size
    band = src.crop((0, int(h * 0.40), w, int(h * 0.80)))
    bw, bh = band.size
    scale = S / float(bh)
    resized = band.resize((max(S, int(bw * scale)), S), Image.LANCZOS)
    left = max(0, (resized.width - S) // 2)
    bg = resized.crop((left, 0, left + S, S))
    bg = bg.filter(ImageFilter.GaussianBlur(16))
    bg = ImageEnhance.Color(bg).enhance(1.2)
    bg = ImageEnhance.Brightness(bg).enhance(0.86)
    wash = Image.new("RGB", (S, S), (16, 96, 32))
    return Image.blend(bg, wash, 0.18)


def compose(src, content_frac):
    """content_frac is the width of the logo plate as a fraction of the square."""
    canvas = square_background(src).convert("RGBA")
    w, h = src.size
    # Logo plate (title + tagline) and the center circle with the ball.
    # Fractions are measured on the original 1672x941 banner.
    logo = src.crop((
        int(w * 0.055), int(h * 0.090),
        int(w * 0.945), int(h * 0.415),
    ))
    pitch = src.crop((
        int(w * 0.300), int(h * 0.430),
        int(w * 0.700), int(h * 0.760),
    ))
    box = int(S * content_frac)
    logo_im = fit_width(logo, box).convert("RGBA")
    pitch_im = fit_width(pitch, int(box * 0.92)).convert("RGBA")
    gap = int(S * 0.02)
    stack_h = logo_im.height + gap + pitch_im.height
    safe = int(S * 0.10)
    top = (S - stack_h) // 2
    if content_frac <= 0.80:
        top = max(safe, min(top, S - safe - stack_h))
    lx = (S - logo_im.width) // 2
    px = (S - pitch_im.width) // 2

    shadow = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    draw = ImageDraw.Draw(shadow)
    pad = int(S * 0.012)
    draw.rounded_rectangle(
        [lx - pad, top - pad, lx + logo_im.width + pad, top + logo_im.height + pad],
        radius=int(S * 0.03),
        fill=(0, 0, 0, 120),
    )
    draw.rounded_rectangle(
        [px - pad, top + logo_im.height + gap - pad // 2,
         px + pitch_im.width + pad, top + stack_h + pad],
        radius=int(S * 0.04),
        fill=(0, 0, 0, 90),
    )
    shadow = shadow.filter(ImageFilter.GaussianBlur(S * 0.012))
    canvas = Image.alpha_composite(canvas, shadow)
    canvas.paste(logo_im, (lx, top), logo_im)
    canvas.paste(pitch_im, (px, top + logo_im.height + gap), pitch_im)
    return canvas.convert("RGB")


def main():
    if not os.path.isfile(COVER):
        raise SystemExit("missing " + COVER + " — add the cover picture first")
    src = Image.open(COVER).convert("RGB")
    os.makedirs(OUT, exist_ok=True)
    normal = compose(src, 0.86)
    # Maskable icons are cropped to a circle or squircle. Keep the title
    # and the ball inside the central 80% (a 10% margin on every side).
    maskable = compose(src, 0.76)
    files = [
        (180, "apple-touch-icon.png", normal),
        (192, "icon-192.png", normal),
        (512, "icon-512.png", normal),
        (192, "maskable-192.png", maskable),
        (512, "maskable-512.png", maskable),
        (32, "favicon-32.png", normal),
    ]
    for size, name, image in files:
        image.resize((size, size), Image.LANCZOS).save(
            os.path.join(OUT, name), format="PNG", optimize=True
        )
    print("icons written to", os.path.abspath(OUT))


if __name__ == "__main__":
    main()
