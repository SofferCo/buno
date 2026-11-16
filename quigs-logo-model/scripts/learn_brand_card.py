#!/usr/bin/env python3
"""Measure the designer's brand cards (the last frame of every reference clip): how large the
wordmark is next to the symbol, how heavy its letters are, and the size and place of the (c) sign.

Everything is expressed in cap heights (the height of the name's first capital letter), so the
card can be rebuilt for any name and any symbol.

  python3 learn_brand_card.py --cards cards/ --out dataset/learned_card.json
  (cards/: one PNG per clip, e.g. ffmpeg -sseof -0.5 -i clip.mp4 -frames:v 1 cards/clip.png)
"""
import argparse, glob, json, os
import numpy as np
from PIL import Image
from scipy import ndimage


def measure(path):
    im = np.asarray(Image.open(path).convert("RGB")).astype(int); H, W = im.shape[:2]
    edge = np.concatenate([im[:12].reshape(-1, 3), im[-12:].reshape(-1, 3)]); bg = np.median(edge, axis=0)
    ink = np.abs(im - bg).max(-1) > 42
    rows = np.nonzero(ink.any(1))[0]
    if len(rows) < 20:
        return None
    cut = np.nonzero(np.diff(rows) > 6)[0]               # blank bands between the symbol and the name
    if not len(cut):
        return None
    y_name = rows[cut[-1] + 1]; mark = ink.copy(); mark[y_name:] = False; name = ink.copy(); name[:y_name] = False
    my, mx = np.nonzero(mark); ny, nx = np.nonzero(name)
    lab, n = ndimage.label(name); objs = ndimage.find_objects(lab); comps = []
    for k, sl in enumerate(objs, 1):
        c = lab[sl] == k
        if c.sum() < 8:
            continue
        comps.append({"k": k, "x0": sl[1].start, "x1": sl[1].stop, "y0": sl[0].start, "y1": sl[0].stop, "area": int(c.sum()),
                      "ring": bool(ndimage.binary_fill_holes(c).sum() > 2.2 * c.sum())})
    if len(comps) < 3:
        return None
    comps.sort(key=lambda c: c["x0"]); first = comps[0]; cap = first["y1"] - first["y0"]
    rings = [c for c in comps if c["ring"] and c["x0"] > first["x1"] and (c["y1"] - c["y0"]) < 0.9 * cap and c["x1"] >= max(o["x1"] for o in comps) - 2]
    if not rings or cap < 14:
        return None
    ring = rings[-1]; letters = [c for c in comps if not (c["x0"] >= ring["x0"] - 1 and c["x1"] <= ring["x1"] + 1)]
    base = int(np.median([c["y1"] for c in letters])); last = max(c["x1"] for c in letters)
    D = ((ring["x1"] - ring["x0"]) + (ring["y1"] - ring["y0"])) / 2
    stem = 2 * ndimage.distance_transform_edt(lab == first["k"]).max()
    ringline = 2 * ndimage.distance_transform_edt(lab == ring["k"]).max()
    lows = [c["y1"] - c["y0"] for c in letters[1:] if abs(c["y1"] - base) <= 2]
    return {"clip": os.path.basename(path)[:-4], "cap_px": int(cap),
            "mark_w": (mx.max() - mx.min()) / W, "mark_h": (my.max() - my.min()) / H, "mark_cx": (mx.max() + mx.min()) / 2 / W,
            "block_cy": (my.min() + base) / 2 / H,                     # the symbol and the name together
            "cap_over_frame_w": cap / W, "cap_over_mark_w": cap / (mx.max() - mx.min()), "cap_over_mark_h": cap / (my.max() - my.min()),
            "gap_over_cap": (first["y0"] - my.max()) / cap,            # symbol's lowest point to the top of the capitals
            "text_w_over_mark_w": (last - first["x0"]) / (mx.max() - mx.min()),
            "text_cx": (last + first["x0"]) / 2 / W,
            "stem_over_cap": stem / cap, "xheight_over_cap": (float(np.median(lows)) / cap) if lows else None,
            "c_diameter_over_cap": D / cap, "c_line_over_cap": ringline / cap,
            "c_gap_over_cap": (ring["x0"] - last) / cap,               # from the last letter to the sign
            "c_top_over_cap": (first["y0"] - ring["y0"]) / cap,        # how far its top stands above the capitals
            "c_centre_over_cap": (base - (ring["y0"] + ring["y1"]) / 2) / cap}   # its centre above the baseline


def main():
    ap = argparse.ArgumentParser(); ap.add_argument("--cards", required=True); ap.add_argument("--out", required=True)
    a = ap.parse_args()
    rows = [r for r in (measure(p) for p in sorted(glob.glob(os.path.join(a.cards, "*.png")))) if r]
    keys = [k for k in rows[0] if k not in ("clip", "cap_px")]; out = {"measured_on": len(rows), "median": {}, "p25": {}, "p75": {}}
    for k in keys:
        v = [r[k] for r in rows if r[k] is not None]
        out["median"][k] = float(np.median(v)); out["p25"][k] = float(np.percentile(v, 25)); out["p75"][k] = float(np.percentile(v, 75))
    out["mark_h_p90"] = float(np.percentile([r["mark_h"] for r in rows], 90))      # how tall a tall symbol gets
    out["per_clip"] = rows
    json.dump(out, open(a.out, "w"), indent=1)
    print(f"measured {len(rows)} cards")
    for k in keys:
        print(f"  {k:22s} {out['median'][k]:.3f}   (quartiles {out['p25'][k]:.3f} - {out['p75'][k]:.3f})")


if __name__ == "__main__":
    main()
