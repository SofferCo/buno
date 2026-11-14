#!/usr/bin/env python3
"""Side by side on reference animals: the designer's construction and mark next to what the
method builds from the same photo.

  python3 -I compare_with_references.py --ref ref --constructions dataset/constructions --params dataset/trained_params.json \
      --stems 29_horse_holdout 28_fox_holdout --out compare.jpg
"""
import argparse, json, os, sys
import numpy as np
from PIL import Image, ImageDraw

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import construct as K, train_on_references as T  # noqa: E402


def draw_guides(im, guides, s=1.0, col=(0, 0, 0), w=3):
    d = ImageDraw.Draw(im)
    for g in guides:
        if g["type"] == "circle":
            d.ellipse([(g["cx"] - g["r"]) * s, (g["cy"] - g["r"]) * s, (g["cx"] + g["r"]) * s, (g["cy"] + g["r"]) * s], outline=col, width=w)
        elif g["type"] == "ellipse":
            q = K.ell_xy((g["cx"], g["cy"], g["rx"], g["ry"], np.radians(g["rot"])), np.linspace(0, 2 * np.pi, 200)) * s
            d.line([tuple(p) for p in q], fill=col, width=w)
        elif g["type"] == "line":
            d.line([g["x1"] * s, g["y1"] * s, g["x2"] * s, g["y2"] * s], fill=col, width=w)
        else:
            d.line([(x * s, y * s) for x, y in g["pts"]], fill=col, width=w)


def main():
    ap = argparse.ArgumentParser(); ap.add_argument("--ref", required=True); ap.add_argument("--constructions", required=True)
    ap.add_argument("--params"); ap.add_argument("--stems", nargs="+", required=True); ap.add_argument("--out", required=True)
    ap.add_argument("--tile", type=int, default=420)
    ap.add_argument("--from-mark", action="store_true", help="feed the designer's own finished mark to the method (tests shape recovery alone)")
    ap.add_argument("--set", default="{}", help="JSON of parameter overrides")
    a = ap.parse_args()
    prm = dict(K.DEFAULTS)
    if a.params:
        prm.update(json.load(open(a.params))["params"])
    prm.update(json.loads(a.set))
    rows = []
    for stem in a.stems:
        c = T.load_clip(a.ref, a.constructions, stem)
        if a.from_mark:
            c["sil"] = c["body"]
        r = T.run_clip(c, prm, keep=True)
        photo = Image.open(os.path.join(a.ref, stem + ".photo.png")).convert("RGB")
        photo = photo.resize((int(photo.width * T.SCALE), int(photo.height * T.SCALE)))
        faded = Image.blend(photo, Image.new("RGB", photo.size, "white"), 0.42)
        ys, xs = np.nonzero(c["body"] | c["sil"]); pad = int(0.12 * c["size"])
        box = (max(0, xs.min() - pad), max(0, ys.min() - pad), min(photo.width, xs.max() + pad), min(photo.height, ys.max() + pad))
        gt = json.load(open(os.path.join(a.constructions, stem + ".json")))["shapes"]
        gts = []
        for s in gt:
            if s["type"] == "other":
                continue
            g = dict(s)
            for k in ("cx", "cy", "r", "rx", "ry", "x1", "y1", "x2", "y2"):
                if k in g:
                    g[k] *= T.SCALE
            gts.append(g)
        A = faded.copy(); draw_guides(A, gts)
        B = faded.copy(); draw_guides(B, r["guides"])
        mk = lambda m: Image.fromarray(np.where(m, 0, 255).astype(np.uint8)).convert("RGB")
        tiles = [A, B, mk(c["body"]), mk(r["built"])]
        out = []
        for t in tiles:
            t = t.crop(box); t.thumbnail((a.tile, a.tile)); cv = Image.new("RGB", (a.tile, a.tile), "white"); cv.paste(t, ((a.tile - t.width) // 2, (a.tile - t.height) // 2)); out.append(cv)
        rows.append(out)
        print(f"{stem}: mark IoU {r['mark']:.2f}, ovals F1 {r['ovals']:.2f}, strokes F1 {r['strokes']:.2f}; designer {len(c['ovals'])} ovals + {len(c['lines'])} strokes, method {r['n_ovals']} + {r['n_lines']}")
    sheet = Image.new("RGB", (a.tile * 4 + 30, a.tile * len(rows) + 10 * len(rows)), "white")
    for i, row in enumerate(rows):
        for j, t in enumerate(row):
            sheet.paste(t, (j * (a.tile + 10), i * (a.tile + 10)))
    sheet.save(a.out, quality=90)


if __name__ == "__main__":
    main()
