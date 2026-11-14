#!/usr/bin/env python3
"""Measure the designer's construction grammar on the extracted reference constructions.

For every clip: how the finished outline is composed (share lying on ovals / on straight strokes),
and for every oval and stroke where it sits relative to the mark and to the animal.
Writes dataset/learned_grammar.json and prints the summary.

  python3 -I learn_from_references.py --ref ref --constructions dataset/constructions --out dataset/learned_grammar.json
"""
import argparse, glob, json, os, sys
import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import construct as K  # noqa: E402


def E_of(s):
    return (s["cx"], s["cy"], s["r"], s["r"], 0.0) if s["type"] == "circle" else (s["cx"], s["cy"], s["rx"], s["ry"], np.radians(s["rot"]))


def seg_dist(P, s):
    a = np.array([s["x1"], s["y1"]]); b = np.array([s["x2"], s["y2"]]); d = b - a; L2 = d @ d
    t = np.clip(((P - a) @ d) / max(L2, 1e-9), 0, 1)
    return np.hypot(*(P - (a + t[:, None] * d)).T)


def oval_mask(E, shape):
    H, W = shape; im = Image.new("L", (W, H), 0)
    ImageDraw.Draw(im).polygon([tuple(q) for q in K.ell_xy(E, np.linspace(0, 2 * np.pi, 120))], fill=255)
    return np.asarray(im) > 0


def load(ref, stem):
    g = lambda k: np.asarray(Image.open(os.path.join(ref, f"{stem}.{k}.png")).convert("L")) < 128
    return g("logo"), g("sil")


def analyse(stem, ref, cons, tol=3.0):
    logo, sil = load(ref, stem); shapes = json.load(open(os.path.join(cons, stem + ".json")))["shapes"]
    ys, xs = np.nonzero(logo); size = max(np.ptp(xs), np.ptp(ys)) + 1
    body = ndimage.binary_fill_holes(logo)
    ovals = [s for s in shapes if s["type"] in ("circle", "ellipse")]
    lines = [s for s in shapes if s["type"] == "line" and np.hypot(s["x2"] - s["x1"], s["y2"] - s["y1"]) >= 0.045 * size]
    P = np.vstack(K.outline_points(logo)) if logo.any() else np.zeros((0, 2))
    d_o = np.min([K.ell_project(E_of(s), P)[0] for s in ovals], axis=0) if ovals else np.full(len(P), 1e9)
    d_l = np.min([seg_dist(P, s) for s in lines], axis=0) if lines else np.full(len(P), 1e9)
    on_o = (d_o <= tol) & (d_o <= d_l); on_l = (d_l <= tol) & ~on_o
    row = {"stem": stem, "size": int(size), "ovals": len(ovals), "lines": len(lines),
           "outline_on_ovals": float(on_o.mean()), "outline_on_lines": float(on_l.mean()),
           "outline_unexplained": float(1 - on_o.mean() - on_l.mean()),
           "mark_vs_animal_iou": float((body & sil).sum() / max(1, (body | sil).sum()))}
    edge = logo ^ ndimage.binary_erosion(logo); dt = ndimage.distance_transform_edt(~edge)
    H, W = logo.shape; od = []
    for s in ovals:
        E = E_of(s); q = K.ell_xy(E, np.linspace(0, 2 * np.pi, 180, endpoint=False))
        xi = np.clip(q[:, 0].round().astype(int), 0, W - 1); yi = np.clip(q[:, 1].round().astype(int), 0, H - 1)
        m = oval_mask(E, logo.shape); area = max(1, m.sum())
        od.append({"kind": s["type"], "rel_size": max(E[2], E[3]) / size, "aspect": max(E[2], E[3]) / max(1e-6, min(E[2], E[3])),
                   "tilt": float(min(s.get("rot", 0) % 90, 90 - s.get("rot", 0) % 90)),
                   "edge_on_outline": float((dt[yi, xi] <= tol).mean()),
                   "inside_mark": float((m & body).sum() / area), "inside_animal": float((m & sil).sum() / area)})
    ld = []
    for s in lines:
        ang = np.degrees(np.arctan2(s["y2"] - s["y1"], s["x2"] - s["x1"])) % 180
        q = np.linspace([s["x1"], s["y1"]], [s["x2"], s["y2"]], 40)
        xi = np.clip(q[:, 0].round().astype(int), 0, W - 1); yi = np.clip(q[:, 1].round().astype(int), 0, H - 1)
        ld.append({"rel_len": float(np.hypot(s["x2"] - s["x1"], s["y2"] - s["y1"]) / size), "angle": float(ang),
                   "on_outline": float((dt[yi, xi] <= tol).mean())})
    return row, od, ld


def main():
    ap = argparse.ArgumentParser(); ap.add_argument("--ref", required=True); ap.add_argument("--constructions", required=True)
    ap.add_argument("--out", required=True)
    a = ap.parse_args()
    rows, O, L = [], [], []
    for f in sorted(glob.glob(os.path.join(a.constructions, "*.json"))):
        stem = os.path.basename(f)[:-5]
        r, od, ld = analyse(stem, a.ref, a.constructions); rows.append(r); O += od; L += ld
        print(f"{stem:26s} ovals {r['ovals']:2d} lines {r['lines']:2d} | outline: {r['outline_on_ovals']:.0%} on ovals, "
              f"{r['outline_on_lines']:.0%} on strokes, {r['outline_unexplained']:.0%} unexplained | mark vs animal IoU {r['mark_vs_animal_iou']:.2f}")
    med = lambda xs: float(np.median(xs))
    q = lambda xs, p: float(np.percentile(xs, p))
    big = [o for o in O if o["rel_size"] >= 0.08]
    ang = np.array([l["angle"] for l in L])
    g = {"clips": len(rows),
         "ovals_per_clip": {"median": med([r["ovals"] for r in rows]), "p25": q([r["ovals"] for r in rows], 25), "p75": q([r["ovals"] for r in rows], 75)},
         "lines_per_clip": {"median": med([r["lines"] for r in rows]), "p25": q([r["lines"] for r in rows], 25), "p75": q([r["lines"] for r in rows], 75)},
         "outline_on_ovals": med([r["outline_on_ovals"] for r in rows]), "outline_on_lines": med([r["outline_on_lines"] for r in rows]),
         "outline_unexplained": med([r["outline_unexplained"] for r in rows]),
         "mark_vs_animal_iou": med([r["mark_vs_animal_iou"] for r in rows if r["mark_vs_animal_iou"] > 0.5]),
         "oval": {"circle_share": float(np.mean([o["kind"] == "circle" for o in O])),
                  "ellipse_axis_aligned_share": float(np.mean([o["tilt"] <= 8 for o in O if o["kind"] == "ellipse"])),
                  "ellipse_aspect_median": med([o["aspect"] for o in O if o["kind"] == "ellipse"]),
                  "rel_size_median": med([o["rel_size"] for o in O]), "rel_size_p75": q([o["rel_size"] for o in O], 75),
                  "big_edge_on_outline_median": med([o["edge_on_outline"] for o in big]),
                  "big_edge_on_outline_p25": q([o["edge_on_outline"] for o in big], 25), "big_edge_on_outline_p75": q([o["edge_on_outline"] for o in big], 75),
                  "big_inside_mark_median": med([o["inside_mark"] for o in big]), "big_inside_mark_p25": q([o["inside_mark"] for o in big], 25),
                  "big_inside_animal_median": med([o["inside_animal"] for o in big])},
         "line": {"rel_len_median": med([l["rel_len"] for l in L]), "rel_len_p75": q([l["rel_len"] for l in L], 75),
                  "horizontal_or_vertical_share": float(np.mean((np.minimum(ang % 90, 90 - ang % 90) <= 4))),
                  "on_outline_median": med([l["on_outline"] for l in L])},
         "per_clip": rows}
    json.dump(g, open(a.out, "w"), indent=1)
    print("\n" + json.dumps({k: v for k, v in g.items() if k != "per_clip"}, indent=1))


if __name__ == "__main__":
    main()
