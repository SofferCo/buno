#!/usr/bin/env python3
"""Render the branded card seen at the end of every video: mark + name + (R), on a solid colour.

  python3 make_card.py dataset/logos/32_bear_holdout.png "SadBearClub" --bg "#8c6a3f" --fg "#1b1b1b" -o bear_card.png
  python3 make_card.py dataset/logos/19_eagle_train.png "Avero" --palette 19_eagle_train   # reuse a dataset palette

The mark is recoloured to --fg and centred; the name is set below it in a bold grotesque.
"""
import argparse, glob, json, os
import numpy as np
from PIL import Image, ImageDraw, ImageFont

FONT_CANDIDATES = ["/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
                   "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf",
                   "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
                   "C:/Windows/Fonts/arialbd.ttf"]


def font(size):
    for p in FONT_CANDIDATES + glob.glob("/usr/share/fonts/**/*Bold*.ttf", recursive=True):
        if os.path.exists(p):
            return ImageFont.truetype(p, size)
    return ImageFont.load_default()


def hex_rgb(h):
    h = h.lstrip("#")
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


def render_card(logo_png, name, bg="#ffffff", fg="#000000", out="card.png", size=(1080, 1920), mark_w=0.42):
    W, H = size
    card = Image.new("RGB", size, hex_rgb(bg))
    mask = np.asarray(Image.open(logo_png).convert("L")) < 128
    ys, xs = np.nonzero(mask)
    crop = Image.fromarray((mask[ys.min():ys.max() + 1, xs.min():xs.max() + 1] * 255).astype(np.uint8), "L")
    tw = int(W * mark_w)
    th = int(crop.height * tw / crop.width)
    if th > int(H * 0.3):
        th = int(H * 0.3); tw = int(crop.width * th / crop.height)
    crop = crop.resize((tw, th), Image.LANCZOS)
    ink = Image.new("RGB", (tw, th), hex_rgb(fg))
    gap = int(H * 0.035)
    f = font(int(W * 0.052)); fr = font(int(W * 0.022))
    d = ImageDraw.Draw(card)
    nb = d.textbbox((0, 0), name, font=f)
    nh = nb[3] - nb[1]
    total = th + (gap + nh if name else 0)
    y0 = (H - total) // 2
    card.paste(ink, ((W - tw) // 2, y0), crop)
    if name:
        nw = nb[2] - nb[0]
        x = (W - nw) // 2
        y = y0 + th + gap - nb[1]
        d.text((x, y), name, font=f, fill=hex_rgb(fg))
        d.text((x + nw + int(W * 0.006), y + int(nh * 0.05)), "®", font=fr, fill=hex_rgb(fg))
    card.save(out)
    return out


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("logo_png")
    ap.add_argument("name")
    ap.add_argument("--bg", default="#ffffff")
    ap.add_argument("--fg", default="#000000")
    ap.add_argument("--palette", help="stem from dataset/palette.json to copy colours from")
    ap.add_argument("-o", "--out", default="card.png")
    a = ap.parse_args()
    if a.palette:
        pal = json.load(open(os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "dataset", "palette.json")))[a.palette]
        a.bg, a.fg = pal["background"], pal["logo"]
    print(render_card(a.logo_png, a.name, a.bg, a.fg, a.out))
