#!/usr/bin/env python3
"""The abstraction step: what an image model needs in order to draw an animal the way the
designer does, before the mark is rebuilt from perfect shapes.

The construction method can rebuild a finished mark from circles, ellipses and strokes, but it
cannot decide how to simplify an animal: the designer flattens a back into one line, turns a tail
into one bold shape, separates the legs. That decision is shown to an image model by example:
sheets of his own photo -> mark pairs, plus the new animal cut out on white.

  sheets   reference set (build_reference_set.py) -> dataset/abstraction/sheet_a.png, sheet_b.png
  input    photo + cut-out of a new animal -> square cut-out on white for the model

  python3 abstraction.py sheets --ref ref --a 01_wolf_train 04_cheetah_train 11_elk_train \
      --b 08_rhino_train 12_polar-bear_train 03_hyena_train --out dataset/abstraction
  python3 abstraction.py input --photo bg.png --cutout cutout.png --out work/cutout_sq.jpg

Then: image model (gpt_image_2_6, 1:1) with sheet_a, sheet_b and cutout_sq.jpg as references and
dataset/abstraction/prompt.txt as the prompt, two or three variants, and
  silhouette_logo.py combine --abstract --work work/ --model-output v0.png v1.png
"""
import argparse, os
import numpy as np
from PIL import Image


def square_box(mask, pad):
    ys, xs = np.nonzero(mask); x0, x1, y0, y1 = xs.min(), xs.max(), ys.min(), ys.max()
    side = int(max(x1 - x0, y1 - y0) * (1 + 2 * pad))
    return (x0 + x1) // 2 - side // 2, (y0 + y1) // 2 - side // 2, side


def crop_square(im, box, size):
    x, y, s = box; canvas = Image.new("RGB", (s, s), "white")
    canvas.paste(im, (-x, -y), im if im.mode == "RGBA" else None)
    return canvas.resize((size, size), Image.LANCZOS)


def sheets(a):
    def pair(stem, size=384):
        logo = np.asarray(Image.open(os.path.join(a.ref, stem + ".logo.png")).convert("L")) < 128
        box = square_box(logo, 0.14)
        photo = crop_square(Image.open(os.path.join(a.ref, stem + ".clear.jpg")).convert("RGB"), box, size)
        mark = crop_square(Image.fromarray(np.where(logo, 0, 255).astype(np.uint8)).convert("RGB"), box, size)
        t = Image.new("RGB", (2 * size + 12, size), "white"); t.paste(photo, (0, 0)); t.paste(mark, (size + 12, 0))
        return t
    os.makedirs(a.out, exist_ok=True)
    for name, stems in (("sheet_a", a.a), ("sheet_b", a.b)):
        tiles = [pair(s) for s in stems]; W, H = tiles[0].size
        im = Image.new("RGB", (W, len(tiles) * (H + 12) - 12), "white")
        for i, t in enumerate(tiles):
            im.paste(t, (0, i * (H + 12)))
        im.save(os.path.join(a.out, name + ".png")); print("wrote", os.path.join(a.out, name + ".png"), im.size)


def model_input(a):
    cut = Image.open(a.cutout).convert("RGBA"); alpha = cut.split()[3]
    if a.photo:                                         # the cut-out file only carries the mask: take the colours from the photo
        rgba = Image.open(a.photo).convert("RGBA")
        if rgba.size != cut.size:
            raise SystemExit("--photo and --cutout must be the same frame")
        rgba.putalpha(alpha); cut = rgba
    box = square_box(np.asarray(alpha) > 40, 0.12)
    crop_square(cut, box, 1024).save(a.out, quality=92); print("wrote", a.out)


if __name__ == "__main__":
    ap = argparse.ArgumentParser(); sub = ap.add_subparsers(dest="cmd", required=True)
    s = sub.add_parser("sheets"); s.add_argument("--ref", required=True); s.add_argument("--a", nargs="+", required=True)
    s.add_argument("--b", nargs="+", required=True); s.add_argument("--out", required=True); s.set_defaults(f=sheets)
    i = sub.add_parser("input"); i.add_argument("--cutout", required=True); i.add_argument("--photo"); i.add_argument("--out", required=True)
    i.set_defaults(f=model_input)
    a = ap.parse_args(); a.f(a)
