#!/usr/bin/env python3
"""Measure the finished marks, not only how they are built.

For every reference clip, with the designer's construction and the finished mark in the same frame:

  regions     the construction shapes cut the plane into regions; which of them are kept (filled)
              and which are thrown away. Checks that the mark really is a union of whole regions.
  cuts        the negative space: white shapes carved inside the animal (eye, gaps between legs,
              markings). How many, how much area, how wide, enclosed or open to the outside.
  vs animal   what the designer adds to and removes from the real silhouette.
  parts       how many separate pieces the mark has.
  card        the final brand card: size and position of the mark, size and gap of the name.

Writes dataset/learned_results.json and dataset/results/<stem>.json (per clip, incl. every cut).

  python3 -I learn_final_results.py --ref ref --constructions dataset/constructions --pairs dataset/pairs --out dataset
"""
import argparse, glob, json, os, sys
import numpy as np
from PIL import Image
from scipy import ndimage

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import construct as K  # noqa: E402


def mask_of(path):
    return np.asarray(Image.open(path).convert("L")) < 128


def envelope(logo, size):
    return K.envelope(logo, size)


def cut_list(logo, size):
    env, cuts, _ = K.cut_list(logo, size)
    return env, [{k: v for k, v in c.items() if k != "label"} for c in cuts]


def region_check(logo, shapes, size):
    """Rasterise the designer's shapes, label the regions between them, see how each is filled."""
    guides = []
    for s in shapes:
        if s["type"] == "line":
            guides.append(s)
        elif s["type"] == "circle":
            guides.append(s)
        elif s["type"] == "ellipse":
            guides.append(s)
    walls = K.raster_guides(guides, logo.shape, width=3)
    env = ndimage.binary_dilation(envelope(logo, size), iterations=4)
    lab, n = ndimage.label(~walls)
    if not n:
        return None
    idx = np.arange(1, n + 1)
    area = np.asarray(ndimage.sum(np.ones(lab.shape), lab, idx)); ink = np.asarray(ndimage.sum(logo, lab, idx))
    inenv = np.asarray(ndimage.sum(env, lab, idx))
    sel = (area >= 25) & (inenv / np.maximum(area, 1) > 0.5)        # regions that belong to the figure
    if not sel.any():
        return None
    share = ink[sel] / area[sel]; a = area[sel]
    decided = (share >= 0.85) | (share <= 0.15)
    return {"regions": int(sel.sum()), "kept": int((share >= 0.85).sum()), "thrown": int((share <= 0.15).sum()),
            "decided_area_share": float(a[decided].sum() / a.sum()), "kept_area_share": float(a[share >= 0.85].sum() / a.sum())}


def card_layout(final_jpg):
    im = np.asarray(Image.open(final_jpg).convert("RGB")).astype(np.int32); H, W, _ = im.shape
    border = np.concatenate([im[:6].reshape(-1, 3), im[-6:].reshape(-1, 3), im[:, :6].reshape(-1, 3), im[:, -6:].reshape(-1, 3)])
    bg = np.median(border, axis=0); ink = np.abs(im - bg).sum(-1) > 70
    rows = np.nonzero(ink.any(1))[0]
    if len(rows) < 10:
        return None
    gaps = np.nonzero(np.diff(rows) > 0.012 * H)[0]
    if not len(gaps):
        return None
    k = gaps[-1]; logo_rows = rows[:k + 1]; text_rows = rows[k + 1:]
    lx = np.nonzero(ink[logo_rows.min():logo_rows.max() + 1].any(0))[0]; tx = np.nonzero(ink[text_rows.min():text_rows.max() + 1].any(0))[0]
    lw, lh = lx.max() - lx.min() + 1, logo_rows.max() - logo_rows.min() + 1
    th, tw = text_rows.max() - text_rows.min() + 1, tx.max() - tx.min() + 1
    if th > 0.08 * H or th < 0.006 * H:
        return None
    lum = lambda c: 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]
    fg = np.median(im[ink], axis=0)
    return {"mark_w": lw / W, "mark_h": lh / H, "mark_cy": (logo_rows.min() + logo_rows.max()) / 2 / H,
            "mark_cx": (lx.min() + lx.max()) / 2 / W, "name_h": th / W, "name_w": tw / W, "name_w_over_mark_w": tw / lw,
            "gap": (text_rows.min() - logo_rows.max()) / W, "name_cx": (tx.min() + tx.max()) / 2 / W,
            "mark_lighter_than_card": bool(lum(fg) > lum(bg))}


def main():
    ap = argparse.ArgumentParser(); ap.add_argument("--ref", required=True); ap.add_argument("--constructions", required=True)
    ap.add_argument("--pairs", required=True); ap.add_argument("--out", required=True)
    a = ap.parse_args()
    os.makedirs(os.path.join(a.out, "results"), exist_ok=True); rows = []; all_cuts = []; cards = []
    for f in sorted(glob.glob(os.path.join(a.constructions, "*.json"))):
        stem = os.path.basename(f)[:-5]
        logo = mask_of(os.path.join(a.ref, stem + ".logo.png")); sil = mask_of(os.path.join(a.ref, stem + ".sil.png"))
        shapes = json.load(open(f))["shapes"]
        ys, xs = np.nonzero(logo); size = max(np.ptp(xs), np.ptp(ys)) + 1
        env, cuts = cut_list(logo, size); reg = region_check(logo, shapes, size)
        lab, n = ndimage.label(logo); parts = int((np.asarray(ndimage.sum(logo, lab, range(1, n + 1))) >= 0.003 * logo.sum()).sum())
        good_sil = (sil & env).sum() / max(1, (sil | env).sum()) >= 0.6
        card = card_layout(os.path.join(a.pairs, stem + ".final.jpg")) if os.path.exists(os.path.join(a.pairs, stem + ".final.jpg")) else None
        row = {"stem": stem, "size": int(size), "cuts": len(cuts), "cut_area_share": float(sum(c["area_share"] for c in cuts)),
               "parts": parts, "regions": reg,
               "added_to_animal": float((env & ~sil).sum() / env.sum()) if good_sil else None,
               "removed_from_animal": float((sil & ~env).sum() / sil.sum()) if good_sil else None,
               "cut_list": cuts, "card": card}
        json.dump(row, open(os.path.join(a.out, "results", stem + ".json"), "w"), indent=1)
        rows.append(row); all_cuts += cuts
        if card:
            cards.append(card)
        r = reg or {}
        print(f"{stem:26s} regions {r.get('regions', 0):3d} kept {r.get('kept', 0):3d} thrown {r.get('thrown', 0):3d} "
              f"(whole-region decisions cover {r.get('decided_area_share', 0):.0%}) | cuts {len(cuts):2d} = {row['cut_area_share']:.1%} of the figure | parts {parts}")
    med = lambda xs: float(np.median(xs)) if len(xs) else None
    q = lambda xs, p: float(np.percentile(xs, p)) if len(xs) else None
    regs = [r["regions"] for r in rows if r["regions"]]
    band = [c for c in all_cuts if c["elongation"] >= 2.5]; spot = [c for c in all_cuts if c["elongation"] < 2.5]
    out = {
        "clips": len(rows),
        "regions": {"per_clip_median": med([r["regions"] for r in regs]), "kept_median": med([r["kept"] for r in regs]),
                    "thrown_median": med([r["thrown"] for r in regs]),
                    "whole_region_decisions_area_share": med([r["decided_area_share"] for r in regs]),
                    "kept_area_share": med([r["kept_area_share"] for r in regs])},
        "cuts": {"per_mark_median": med([r["cuts"] for r in rows]), "per_mark_p25": q([r["cuts"] for r in rows], 25), "per_mark_p75": q([r["cuts"] for r in rows], 75),
                 "area_share_of_figure_median": med([r["cut_area_share"] for r in rows]),
                 "enclosed_share": float(np.mean([c["enclosed"] for c in all_cuts])),
                 "band_share": len(band) / max(1, len(all_cuts)),
                 "band_width_rel_median": med([c["width_rel"] for c in band]), "band_width_rel_p25": q([c["width_rel"] for c in band], 25),
                 "band_width_rel_p75": q([c["width_rel"] for c in band], 75),
                 "spot_width_rel_median": med([c["width_rel"] for c in spot]),
                 "width_rel_p95": q([c["width_rel"] for c in all_cuts], 95), "area_share_p95": q([c["area_share"] for c in all_cuts], 95),
                 "area_share_p98": q([c["area_share"] for c in all_cuts], 98)},
        "parts_median": med([r["parts"] for r in rows]), "single_piece_share": float(np.mean([r["parts"] == 1 for r in rows])),
        "added_to_animal_median": med([r["added_to_animal"] for r in rows if r["added_to_animal"] is not None]),
        "removed_from_animal_median": med([r["removed_from_animal"] for r in rows if r["removed_from_animal"] is not None]),
        "card": {k: med([c[k] for c in cards]) for k in ("mark_w", "mark_h", "mark_cy", "mark_cx", "name_h", "name_w_over_mark_w", "gap", "name_cx")}
                | {"measured_on": len(cards), "mark_lighter_than_card_share": float(np.mean([c["mark_lighter_than_card"] for c in cards])) if cards else None},
    }
    json.dump(out, open(os.path.join(a.out, "learned_results.json"), "w"), indent=1)
    print("\n" + json.dumps(out, indent=1))


if __name__ == "__main__":
    main()
