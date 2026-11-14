#!/usr/bin/env python3
"""Train the construction method against the designer's own constructions.

For every reference clip the method gets what it would get for a new photo, the animal's
silhouette, and its output is scored against what the designer actually made:

  mark      IoU between the built body and the designer's finished mark (holes filled)
  ovals     F1 of the method's circles/ellipses against the designer's (same place, same size)
  strokes   F1 of the method's straight strokes against the designer's (same direction, same place)
  mix       how close the share of outline on ovals vs strokes is to the designer's
  counts    how close the number of ovals and of strokes is to the designer's for that animal
  length    how close the typical stroke length is to the designer's (his strokes are long)

The last three keep the method at the designer's level of abstraction: without them the best
score comes from tracing the photo tightly with many short strokes.

Parameters are tuned by coordinate descent on the training clips only; the hold-out clips are
scored before and after and never used for tuning.

  python3 -I train_on_references.py --ref ref --constructions dataset/constructions --out dataset/trained_params.json
"""
import argparse, json, os, sys, time
import numpy as np
from PIL import Image
from scipy import ndimage

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import construct as K  # noqa: E402

SCALE = 1.5          # reference frames are 720 wide; the method works on a 1080-wide canvas
GRID = {
    "tol_rel": [0.005, 0.0075, 0.011, 0.016, 0.022],
    "oval_inside_min": [0.0, 0.4, 0.86],
    "oval_min_cover": [0.0, 0.12, 0.2, 0.3],
    "oval_max_r": [0.2, 0.3, 0.5],
    "oval_min_r": [0.02, 0.045, 0.07],
    "oval_min_gain": [0.025, 0.045, 0.07],
    "oval_max_k": [4, 6, 8, 10],
    "oval_delta_mult": [0.7, 1.0, 1.5],
    "line_tau_mult": [1.0, 1.6, 2.4],
    "circle_bonus": [1.0, 1.08, 1.3],
    "contour_sigma": [1.2, 3.0, 6.0],
    "curl_max_r": [0.04, 0.075, 0.12],
}


def load_clip(ref, cons, stem):
    def m(kind):
        im = Image.open(os.path.join(ref, f"{stem}.{kind}.png")).convert("L")
        im = im.resize((int(im.width * SCALE), int(im.height * SCALE)), Image.BILINEAR)
        return np.asarray(im) < 128
    logo, sil = m("logo"), m("sil")
    body = ndimage.binary_fill_holes(logo)
    shapes = json.load(open(os.path.join(cons, stem + ".json")))["shapes"]
    ys, xs = np.nonzero(body); size = max(np.ptp(xs), np.ptp(ys)) + 1
    ovals, lines = [], []
    for s in shapes:
        if s["type"] == "circle":
            ovals.append((s["cx"] * SCALE, s["cy"] * SCALE, s["r"] * SCALE, s["r"] * SCALE))
        elif s["type"] == "ellipse":
            ovals.append((s["cx"] * SCALE, s["cy"] * SCALE, s["rx"] * SCALE, s["ry"] * SCALE))
        elif s["type"] == "line":
            a = np.array([s["x1"], s["y1"]]) * SCALE; b = np.array([s["x2"], s["y2"]]) * SCALE
            if np.hypot(*(b - a)) >= 0.045 * size:
                lines.append((a, b))
    ovals = [o for o in ovals if max(o[2], o[3]) >= 0.03 * size]
    # close the silhouette a little, as the pipeline does before building
    s2 = ndimage.binary_closing(np.pad(sil, 20), structure=K.disk(6))[20:-20, 20:-20]
    s2 = ndimage.binary_opening(s2, structure=K.disk(3)); lab, n = ndimage.label(s2)
    if n > 1:
        s2 = lab == (1 + int(np.argmax(ndimage.sum(s2, lab, range(1, n + 1)))))
    med_len = float(np.median([np.hypot(*(b - a)) for a, b in lines])) if lines else 0.0
    return {"stem": stem, "sil": s2, "body": body, "size": size, "ovals": ovals, "lines": lines, "med_len": med_len,
            "sil_iou": (sil & body).sum() / max(1, (sil | body).sum())}


def f1(tp, n_pred, n_gt):
    if n_pred == 0 or n_gt == 0:
        return 0.0
    p, r = tp / n_pred, tp / n_gt
    return 0.0 if p + r == 0 else 2 * p * r / (p + r)


def match_ovals(pred, gt):
    used, tp = set(), 0
    for g in gt:
        rg = (g[2] + g[3]) / 2
        for i, p in enumerate(pred):
            if i in used:
                continue
            rp = (p[2] + p[3]) / 2
            if 0.7 <= rp / rg <= 1.43 and np.hypot(p[0] - g[0], p[1] - g[1]) <= 0.4 * min(rp, rg):
                used.add(i); tp += 1; break
    return tp


def match_lines(pred, gt, size):
    used, tp = set(), 0
    for a, b in gt:
        d = (b - a) / np.hypot(*(b - a)); mid = (a + b) / 2
        for i, (pa, pb) in enumerate(pred):
            if i in used:
                continue
            Lp = np.hypot(*(pb - pa)); dp = (pb - pa) / Lp
            if abs(d @ dp) < 0.985:                     # within 10 degrees
                continue
            off = abs(dp[0] * (mid[1] - pa[1]) - dp[1] * (mid[0] - pa[0])); t = (mid - pa) @ dp
            if off <= 0.025 * size and -0.1 * size <= t <= Lp + 0.1 * size:
                used.add(i); tp += 1; break
    return tp


def run_clip(c, prm, keep=False):
    tol = float(np.clip(prm["tol_rel"] * c["size"], 3.0, 26.0))
    chains = K.fit_mask(c["sil"], tol, shapes_first=True, delta=tol, prm=prm)
    guides = K.build_guides(chains, c["sil"].shape[1])
    built = K.rasterize(chains, c["sil"].shape)
    po = [(g["cx"], g["cy"], g.get("r", g.get("rx")), g.get("r", g.get("ry"))) for g in guides if g["type"] in ("circle", "ellipse")]
    po += [tuple(g["E"][:4]) for g in guides if g["type"] == "path" and "E" in g]
    pl = [(np.array([g["x1"], g["y1"]]), np.array([g["x2"], g["y2"]])) for g in guides if g["type"] == "line"]
    prims = [p for ch in chains for p in ch]; tot = sum(p["len"] for p in prims) or 1
    mix = sum(p["len"] for p in prims if p["type"] != "line") / tot
    iou = (built & c["body"]).sum() / max(1, (built | c["body"]).sum())
    fo = f1(match_ovals(po, c["ovals"]), len(po), len(c["ovals"]))
    fl = f1(match_lines(pl, c["lines"], c["size"]), len(pl), len(c["lines"]))
    near = lambda p_, g_: float(np.exp(-abs(np.log(max(p_, 0.5) / max(g_, 0.5)))))
    counts = 0.5 * near(len(po), len(c["ovals"])) + 0.5 * near(len(pl), len(c["lines"]))
    # stroke length as the designer measures it: the part of each stroke that is outline, i.e. the primitive itself
    plen = [p["len"] for p in prims if p["type"] == "line" and p["len"] >= 0.03 * c["size"]]
    length = near(float(np.median(plen)) if plen else 1.0, 0.53 * c["med_len"]) if c["med_len"] else 0.0
    out = {"mark": float(iou), "ovals": fo, "strokes": fl, "mix": float(mix), "counts": counts, "length": length,
           "n_ovals": len(po), "n_lines": len(pl)}
    if keep:
        out.update({"guides": guides, "built": built})
    return out


_POOL = None
_CLIPS = {}


def _work(args):
    key, i, prm = args
    return run_clip(_CLIPS[key][i], prm)


def score(clips, prm, target_mix, key=None):
    if _POOL is not None and key in _CLIPS:
        rows = _POOL.map(_work, [(key, i, prm) for i in range(len(clips))])
    else:
        rows = [run_clip(c, prm) for c in clips]
    agg = {k: float(np.mean([r[k] for r in rows])) for k in ("mark", "ovals", "strokes", "mix", "counts", "length", "n_ovals", "n_lines")}
    agg["total"] = (0.3 * agg["mark"] + 0.2 * agg["ovals"] + 0.2 * agg["strokes"] + 0.1 * agg["counts"] + 0.1 * agg["length"]
                    + 0.1 * (1 - min(1, abs(agg["mix"] - target_mix) / 0.3)))
    return agg, rows


def main():
    ap = argparse.ArgumentParser(); ap.add_argument("--ref", required=True); ap.add_argument("--constructions", required=True)
    ap.add_argument("--out", required=True); ap.add_argument("--passes", type=int, default=2); ap.add_argument("--grammar")
    a = ap.parse_args()
    stems = sorted(f[:-5] for f in os.listdir(a.constructions) if f.endswith(".json"))
    clips = [load_clip(a.ref, a.constructions, s) for s in stems]
    usable = [c for c in clips if c["sil_iou"] >= 0.6 and len(c["lines"]) + len(c["ovals"]) >= 12]
    train = [c for c in usable if c["stem"].endswith("_train")]; hold = [c for c in usable if c["stem"].endswith("_holdout")]
    print(f"{len(clips)} clips; usable (the local cut-out found the animal): {len(train)} train, {len(hold)} hold-out")
    target_mix = float(np.median(json.load(open(a.grammar))["per_clip"] and [r["outline_on_ovals"] for r in json.load(open(a.grammar))["per_clip"]])) if a.grammar else 0.31
    fmt = lambda s: (f"total {s['total']:.3f} | mark IoU {s['mark']:.3f} | ovals F1 {s['ovals']:.2f} | strokes F1 {s['strokes']:.2f} | "
                     f"counts {s['counts']:.2f} | length {s['length']:.2f} | on ovals {s['mix']:.0%} | "
                     f"{s['n_ovals']:.1f} ovals, {s['n_lines']:.1f} strokes")
    global _POOL
    _CLIPS["train"], _CLIPS["hold"] = train, hold
    import multiprocessing as mp
    _POOL = mp.get_context("fork").Pool(4)
    gt_o = np.mean([len(c["ovals"]) for c in train]); gt_l = np.mean([len(c["lines"]) for c in train])
    print(f"designer on the training clips: {gt_o:.1f} ovals, {gt_l:.1f} strokes per animal", flush=True)
    prm = dict(K.DEFAULTS)
    base_tr, _ = score(train, prm, target_mix, "train"); base_ho, _ = score(hold, prm, target_mix, "hold")
    print("before  train:", fmt(base_tr)); print("before  hold :", fmt(base_ho), flush=True); best = base_tr["total"]; log = []
    for ps in range(a.passes):
        improved = False
        for key, values in GRID.items():
            t0 = time.time(); keep = prm[key]
            for v in values:
                if v == keep:
                    continue
                trial = dict(prm); trial[key] = v
                sc, _ = score(train, trial, target_mix, "train")
                if sc["total"] > best + 0.0015:
                    best, prm, improved = sc["total"], trial, True
            log.append({"pass": ps + 1, "param": key, "from": keep, "to": prm[key], "train_total": round(best, 4)})
            print(f"pass {ps + 1} {key:16s} {keep} -> {prm[key]}   train total {best:.3f}  ({time.time() - t0:.0f}s)", flush=True)
        if not improved:
            break
    tr, _ = score(train, prm, target_mix, "train"); ho, _ = score(hold, prm, target_mix, "hold")
    print("after   train:", fmt(tr)); print("after   hold :", fmt(ho))
    json.dump({"params": prm, "trained_on": [c["stem"] for c in train], "held_out": [c["stem"] for c in hold],
               "before": {"train": base_tr, "holdout": base_ho}, "after": {"train": tr, "holdout": ho},
               "target_share_of_outline_on_ovals": target_mix, "search": log}, open(a.out, "w"), indent=1)
    print("wrote", a.out)


if __name__ == "__main__":
    main()
