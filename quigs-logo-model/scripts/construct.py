#!/usr/bin/env python3
"""Build a mark out of circle arcs and straight lines, the way the reference logos are built.

The outline of a mask is re-expressed as a closed chain of primitives, each one either a straight
segment or an arc of a circle, joined end to end. The circles and lines those pieces belong to
are the construction guides: in the video they are drawn first, and the red outline then runs
along them exactly.

  calibrate   fit the 32 reference logos and store how dense their construction is
              (primitives per 1000 px of outline, share of lines, radii) -> dataset/style_stats.json
  build       mask (canvas coords) -> construction.json + logo.svg (true arcs/lines) + critique

The tolerance is not hand-picked: `build` takes the tightest fit to the animal whose primitive
density does not exceed the reference logos' density, then reports how far it is from the photo.
"""
import argparse, json, os, sys
import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage
import potrace

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
STEP = 2.0                                             # contour sampling, px
MIN_R = 9.0                                            # smaller arcs are treated as corners


# ------------------------------------------------------------------ contours
def outline_points(mask, min_len=24):
    """Closed contours of a mask as dense polylines (STEP px apart), longest first."""
    path = potrace.Bitmap(~mask).trace(turdsize=6, alphamax=0.6, opticurve=False)
    out = []
    for curve in path:
        p = curve.start_point; pts = [(p.x, p.y)]
        for seg in curve:
            e = seg.end_point
            if seg.is_corner:
                pts += [(seg.c.x, seg.c.y), (e.x, e.y)]
            else:
                p0 = np.array(pts[-1]); c1 = np.array([seg.c1.x, seg.c1.y]); c2 = np.array([seg.c2.x, seg.c2.y]); p3 = np.array([e.x, e.y])
                for u in np.linspace(0, 1, 12)[1:]:
                    q = (1 - u) ** 3 * p0 + 3 * (1 - u) ** 2 * u * c1 + 3 * (1 - u) * u ** 2 * c2 + u ** 3 * p3
                    pts.append((q[0], q[1]))
        P = np.array(pts); P = np.vstack([P, P[:1]])
        seg = np.hypot(*np.diff(P, axis=0).T); keep = np.concatenate([[True], seg > 1e-6]); P = P[keep]
        s = np.concatenate([[0], np.cumsum(np.hypot(*np.diff(P, axis=0).T))])
        if s[-1] < min_len:
            continue
        u = np.arange(0, s[-1], STEP)
        out.append(np.stack([np.interp(u, s, P[:, 0]), np.interp(u, s, P[:, 1])], 1))
    out.sort(key=lambda P: -len(P))
    return out


def find_corners(P, k=5, thr_deg=42, nms=6):
    v1 = P - np.roll(P, k, axis=0); v2 = np.roll(P, -k, axis=0) - P
    cos = (v1 * v2).sum(1) / (np.hypot(*v1.T) * np.hypot(*v2.T) + 1e-9)
    ang = np.degrees(np.arccos(np.clip(cos, -1, 1)))
    idx = []
    for i in np.argsort(-ang):
        if ang[i] < thr_deg:
            break
        if all(min(abs(i - j), len(P) - abs(i - j)) > nms for j in idx):
            idx.append(int(i))
    return sorted(idx)


# ------------------------------------------------------------------ one primitive through two fixed endpoints
def fit_prim(pts, eps):
    """Best line or circular arc from pts[0] to pts[-1]. Returns (max_err, prim dict)."""
    A, B = pts[0], pts[-1]; d = B - A; c = np.hypot(*d)
    if c < 1e-6:
        return 1e9, None
    n = np.array([-d[1], d[0]]) / c; M = (A + B) / 2
    off = (pts - M) @ n
    line_err = float(np.abs(off).max())
    line = {"type": "line", "A": A.tolist(), "B": B.tolist()}
    if line_err <= 0.9 * eps or len(pts) < 4:
        return line_err, line
    s0 = float(off[len(pts) // 2]); best = (line_err, line)
    span = max(3.0, 0.35 * abs(s0))
    for _ in range(2):
        s = s0 + np.linspace(-span, span, 21); s = s[np.abs(s) > 0.5]
        if not len(s):
            break
        r = ((c / 2) ** 2 + s ** 2) / (2 * np.abs(s))
        C = M[None] + ((s - np.sign(s) * r)[:, None]) * n[None]
        err = np.abs(np.hypot(pts[None, :, 0] - C[:, None, 0], pts[None, :, 1] - C[:, None, 1]) - r[:, None]).max(1)
        k = int(np.argmin(err))
        if err[k] < best[0]:
            best = (float(err[k]), {"type": "arc", "A": A.tolist(), "B": B.tolist(), "C": C[k].tolist(),
                                    "r": float(r[k]), "s": float(s[k]), "Q": (M + s[k] * n).tolist()})
        s0, span = float(s[k]), span / 8
    return best


def fit_chain(P, eps, corners):
    """Greedy longest-fit chain of primitives around a closed contour, broken at corners."""
    n = len(P)
    if not corners:
        c = P.mean(0); corners = [int(np.argmax(np.hypot(*(P - c).T)))]
        corners.append((corners[0] + n // 2) % n); corners.sort()
    prims = []
    for a, b in zip(corners, corners[1:] + [corners[0] + n]):
        idx = np.arange(a, b + 1) % n; Q = P[idx]; m = len(Q); i = 0
        while i < m - 1:
            lo, hi, step = i + 1, None, 8
            best = fit_prim(Q[i:lo + 1], eps)
            j = lo
            while hi is None:                           # gallop
                j2 = min(m - 1, j + step); e, pr = fit_prim(Q[i:j2 + 1], eps)
                if e <= eps and pr:
                    j, best = j2, (e, pr); step *= 2
                    if j == m - 1:
                        hi = j
                else:
                    hi = j2
            lo2, hi2 = j, hi
            while hi2 - lo2 > 1:                        # bisect
                mid = (lo2 + hi2) // 2; e, pr = fit_prim(Q[i:mid + 1], eps)
                if e <= eps and pr:
                    lo2, best = mid, (e, pr)
                else:
                    hi2 = mid
            pr = dict(best[1]); pr["err"] = best[0]; pr["len"] = float((lo2 - i) * STEP)
            if pr["type"] == "arc" and pr["r"] < MIN_R:
                pr = {"type": "line", "A": pr["A"], "B": pr["B"], "err": pr["err"], "len": pr["len"]}
            prims.append(pr); i = lo2
    return prims


# ------------------------------------------------------------------ geometry -> svg / raster / guides
def arc_points(p, step=2.0):
    A, B, C, Q = (np.array(p[k]) for k in ("A", "B", "C", "Q")); r = p["r"]
    a0, aq, a1 = (np.arctan2(*(X - C)[::-1]) for X in (A, Q, B))
    w = lambda x: (x + np.pi) % (2 * np.pi) - np.pi
    d1, d2 = w(aq - a0), w(a1 - aq)
    m = max(2, int(abs(d1 + d2) * r / step))
    t = a0 + np.concatenate([np.linspace(0, d1, m // 2 + 1), d1 + np.linspace(0, d2, m // 2 + 1)[1:]])
    return np.stack([C[0] + r * np.cos(t), C[1] + r * np.sin(t)], 1)


def chain_polyline(prims):
    pts = []
    for p in prims:
        pts.append(arc_points(p)[:-1] if p["type"] == "arc" else np.array([p["A"]]))
    return np.vstack(pts)


def chain_path(prims):
    d = [f"M{prims[0]['A'][0]:.2f},{prims[0]['A'][1]:.2f}"]
    for p in prims:
        if p["type"] == "line":
            d.append(f"L{p['B'][0]:.2f},{p['B'][1]:.2f}")
        else:
            A, B, Q = np.array(p["A"]), np.array(p["B"]), np.array(p["Q"])
            v1, v2 = Q - A, B - Q
            sweep = 1 if v1[0] * v2[1] - v1[1] * v2[0] > 0 else 0
            large = 1 if abs(p["s"]) > np.hypot(*(B - A)) / 2 else 0
            d.append(f"A{p['r']:.2f},{p['r']:.2f} 0 {large} {sweep} {B[0]:.2f},{B[1]:.2f}")
    return "".join(d) + "Z"


def rasterize(chains, shape):
    H, W = shape; out = np.zeros(shape, bool); S = 2
    for prims in chains:
        im = Image.new("L", (W * S, H * S), 0)
        ImageDraw.Draw(im).polygon([(float(x) * S, float(y) * S) for x, y in chain_polyline(prims)], fill=255)
        out ^= np.asarray(im.resize((W, H), Image.LANCZOS)) > 127
    return out


def build_guides(chains, W, full_circle_r=400):
    """One guide per primitive, so the mark is exactly a union of the regions the guides enclose:
    an arc gives its full circle (a very large one gives a longer sweep of itself), a line gives
    the line extended past both ends. Coincident circles and collinear lines share one guide."""
    circles, lines, sweeps = [], [], []
    for p in sorted([p for c in chains for p in c], key=lambda p: -p["len"]):
        if p["type"] == "arc" and p["r"] <= full_circle_r:
            for c in circles:
                if np.hypot(c["cx"] - p["C"][0], c["cy"] - p["C"][1]) < 2.0 and abs(c["r"] - p["r"]) < 2.0:
                    break
            else:
                circles.append({"type": "circle", "cx": p["C"][0], "cy": p["C"][1], "r": p["r"]})
        elif p["type"] == "arc":
            A, B, C, Q = (np.array(p[k]) for k in ("A", "B", "C", "Q")); r = p["r"]
            w = lambda x: (x + np.pi) % (2 * np.pi) - np.pi
            a0, aq, a1 = (np.arctan2(*(X - C)[::-1]) for X in (A, Q, B))
            sw = w(aq - a0) + w(a1 - aq); ext = np.sign(sw) * min(0.25 * abs(sw) + 45 / r, 0.6)
            ang = np.linspace(a0 - ext, a0 + sw + ext, max(8, int(abs(sw + 2 * ext) * r / 6)))
            pts = np.stack([C[0] + r * np.cos(ang), C[1] + r * np.sin(ang)], 1)
            if pts[0, 0] > pts[-1, 0]:
                pts, sw = pts[::-1], -sw
            sweeps.append({"type": "path", "x1": float(pts[0, 0]), "y1": float(pts[0, 1]), "pts": np.round(pts, 1).tolist(),
                           "d": f"M{pts[0,0]:.1f},{pts[0,1]:.1f}A{r:.1f},{r:.1f} 0 0 {1 if sw > 0 else 0} {pts[-1,0]:.1f},{pts[-1,1]:.1f}"})
        else:
            A, B = np.array(p["A"]), np.array(p["B"]); Ln = np.hypot(*(B - A))
            if Ln < 1e-6:
                continue
            d = (B - A) / Ln
            if d[0] < 0 or (abs(d[0]) < 1e-9 and d[1] < 0):
                d, A, B = -d, B, A
            for l in lines:
                off = abs(l["d"][0] * (A[1] - l["p"][1]) - l["d"][1] * (A[0] - l["p"][0]))
                if abs(d @ l["d"]) > 0.9996 and off < 2.0:
                    ts = [(X - l["p"]) @ l["d"] for X in (A, B)]
                    l["t0"], l["t1"] = min(l["t0"], *ts), max(l["t1"], *ts); break
            else:
                lines.append({"p": A, "d": d, "t0": 0.0, "t1": float(Ln)})
    out_lines = []
    for l in lines:
        ext = 0.2 * (l["t1"] - l["t0"]) + 24
        a, b = l["p"] + l["d"] * (l["t0"] - ext), l["p"] + l["d"] * (l["t1"] + ext)
        out_lines.append({"type": "line", "x1": float(a[0]), "y1": float(a[1]), "x2": float(b[0]), "y2": float(b[1])})
    big = sorted([c for c in circles if c["r"] >= 60], key=lambda c: -c["r"])
    small = sorted([c for c in circles if c["r"] < 60], key=lambda c: c["cx"])
    return big + sorted(sweeps, key=lambda l: l["x1"]) + sorted(out_lines, key=lambda l: l["x1"]) + small


# ------------------------------------------------------------------ regions between the guides (shape-builder plan)
def disk(r):
    y, x = np.mgrid[-r:r + 1, -r:r + 1]
    return x * x + y * y <= r * r


def raster_guides(guides, shape, width=3):
    im = Image.new("L", (shape[1], shape[0]), 0); d = ImageDraw.Draw(im)
    for g in guides:
        if g["type"] == "circle":
            d.ellipse([g["cx"] - g["r"], g["cy"] - g["r"], g["cx"] + g["r"], g["cy"] + g["r"]], outline=255, width=width)
        elif g["type"] == "line":
            d.line([g["x1"], g["y1"], g["x2"], g["y2"]], fill=255, width=width)
        else:
            d.line([tuple(q) for q in g["pts"]], fill=255, width=width)
    return np.asarray(im) > 0


def mask_path(mask, ox=0, oy=0):
    path = potrace.Bitmap(~mask).trace(turdsize=10, alphamax=0.9, opticurve=True, opttolerance=0.5)
    d = []
    for curve in path:
        p = curve.start_point; d.append(f"M{p.x + ox:.1f},{p.y + oy:.1f}")
        for seg in curve:
            e = seg.end_point
            if seg.is_corner:
                d.append(f"L{seg.c.x + ox:.1f},{seg.c.y + oy:.1f}L{e.x + ox:.1f},{e.y + oy:.1f}")
            else:
                d.append(f"C{seg.c1.x + ox:.1f},{seg.c1.y + oy:.1f} {seg.c2.x + ox:.1f},{seg.c2.y + oy:.1f} {e.x + ox:.1f},{e.y + oy:.1f}")
        d.append("Z")
    return "".join(d)


def merge_plan(guides, body, max_steps=18, min_face=220):
    """The guides cut the plane into regions. Return the regions inside the body in the order a
    shape-builder drag would sweep them (always growing from a neighbour), as cumulative unions."""
    ys, xs = np.nonzero(body); pad = 12
    y0, y1, x0, x1 = max(0, ys.min() - pad), ys.max() + pad, max(0, xs.min() - pad), xs.max() + pad
    B = body[y0:y1, x0:x1]; walls = raster_guides(guides, body.shape)[y0:y1, x0:x1]
    lab, n = ndimage.label(~walls)
    idx = np.arange(1, n + 1)
    area = np.asarray(ndimage.sum(np.ones(lab.shape), lab, idx)); inside = np.asarray(ndimage.sum(B, lab, idx)) / np.maximum(area, 1)
    faces = [int(i) for i in idx if inside[i - 1] > 0.5 and area[i - 1] >= min_face]
    small = [int(i) for i in idx if inside[i - 1] > 0.5 and area[i - 1] < min_face]
    dt = ndimage.distance_transform_edt(~walls)
    poles = {f: np.array(p[::-1], float) for f, p in zip(faces, ndimage.maximum_position(dt, lab, faces))}
    cur = min(faces, key=lambda f: poles[f][0]); remaining = set(faces); union = np.zeros(B.shape, bool); order = []
    while True:
        order.append(cur); remaining.discard(cur); union |= lab == cur
        if not remaining:
            break
        ring = ndimage.binary_dilation(union, structure=disk(5)) & ~union
        touching = set(np.unique(lab[ring]).tolist())
        adj = [f for f in remaining if f in touching] or list(remaining)
        cur = min(adj, key=lambda f: np.hypot(*(poles[f] - poles[order[-1]])))
    k = len(order); cuts_at = sorted(set(np.linspace(0, k - 1, min(k, max_steps)).round().astype(int).tolist()))
    steps, union = [], np.zeros(B.shape, bool); smallmask = np.isin(lab, small)
    for i, f in enumerate(order):
        union |= lab == f
        if i in cuts_at:
            U = ndimage.binary_closing(np.pad(union, 8), structure=disk(4))[8:-8, 8:-8]
            U |= ndimage.binary_dilation(U, structure=disk(4)) & smallmask
            U = ndimage.binary_closing(np.pad(U, 8), structure=disk(3))[8:-8, 8:-8] & ndimage.binary_dilation(B, structure=disk(2))
            holes, hn = ndimage.label(ndimage.binary_fill_holes(U) & ~U)       # slivers enclosed by merged regions
            if hn:
                hs = np.asarray(ndimage.sum(np.ones(U.shape), holes, range(1, hn + 1)))
                U |= np.isin(holes, 1 + np.nonzero(hs < 1400)[0])
            if i == k - 1:
                U = B
            steps.append({"d": mask_path(U, x0, y0), "poles": []})
    # every region the cursor passes, grouped under the step that shows it
    groups, g = [[] for _ in steps], 0
    for i, f in enumerate(order):
        groups[g].append([float(poles[f][0] + x0), float(poles[f][1] + y0)])
        if i in cuts_at:
            g += 1
    for st, gp in zip(steps, groups):
        st["poles"] = gp
    final_union = np.isin(lab, faces + small)
    covered = (ndimage.binary_closing(np.pad(final_union, 8), structure=disk(4))[8:-8, 8:-8] & B).sum() / B.sum()
    return {"steps": steps, "regions": k, "small_regions": len(small), "union_covers_body": float(covered),
            "bbox": [int(x0), int(y0), int(x1), int(y1)]}


# ------------------------------------------------------------------ fit a whole mask
def fit_mask(mask, eps):
    chains = []
    for P in outline_points(mask):
        P = ndimage.gaussian_filter1d(P, 1.2, axis=0, mode="wrap")
        e = eps if len(P) * STEP > 260 else min(eps, 2.0)   # eyes and small cuts stay crisp
        prims = fit_chain(P, e, find_corners(P))
        if len(prims) >= 2:
            chains.append(prims)
    return chains


def stats(chains):
    prims = [p for c in chains for p in c]
    per = sum(p["len"] for p in prims)
    return {"primitives": len(prims), "outline_px": per, "density": 1000 * len(prims) / max(per, 1),
            "line_share": sum(p["type"] == "line" for p in prims) / max(len(prims), 1),
            "radii": [p["r"] for p in prims if p["type"] == "arc"]}


def critique(logo, target):
    """How far is the constructed mark from the animal? Boundary distances in px."""
    def edge(m):
        return m & ~ndimage.binary_erosion(m)
    dt_t = ndimage.distance_transform_edt(~edge(target)); dt_l = ndimage.distance_transform_edt(~edge(logo))
    d1, d2 = dt_t[edge(logo)], dt_l[edge(target)]
    return {"iou": float((logo & target).sum() / (logo | target).sum()),
            "outline_mean_px": float(d1.mean()), "outline_p95_px": float(np.percentile(d1, 95)),
            "outline_max_px": float(d1.max()), "missed_animal_p95_px": float(np.percentile(d2, 95)),
            "outside_animal_share": float((logo & ~target).sum() / logo.sum()),
            "uncovered_animal_share": float((target & ~logo).sum() / target.sum())}


def calibrate(a):
    files = sorted(os.listdir(os.path.join(a.dataset, "logos")))
    rows = []
    for f in files:
        m = np.asarray(Image.open(os.path.join(a.dataset, "logos", f)).convert("L")) < 128
        st = stats(fit_mask(m, a.eps)); rows.append({"logo": f[:-4], **{k: v for k, v in st.items() if k != "radii"},
                                                     "r_median": float(np.median(st["radii"])) if st["radii"] else 0})
        print(f"{f[:-4]:26s} prims {st['primitives']:3d}  density {st['density']:5.1f}/1000px  lines {st['line_share']:.0%}")
    dens = np.array([r["density"] for r in rows]); ls = np.array([r["line_share"] for r in rows])
    out = {"fit_eps_px": a.eps, "logos": len(rows), "density_median": float(np.median(dens)),
           "density_p75": float(np.percentile(dens, 75)), "line_share_median": float(np.median(ls)),
           "primitives_median": float(np.median([r["primitives"] for r in rows])), "per_logo": rows}
    json.dump(out, open(os.path.join(a.dataset, "style_stats.json"), "w"), indent=1)
    print(f"\nreference style: {out['primitives_median']:.0f} primitives per mark, {out['density_median']:.1f} per 1000 px of "
          f"outline (p75 {out['density_p75']:.1f}), {out['line_share_median']:.0%} straight lines")


def construct(mask, target=None, style=None, log=print, max_guides=None):
    """Tightest construction whose density stays within the reference logos' density
    (and, when asked, whose number of guide shapes stays readable on screen)."""
    style = style or json.load(open(os.path.join(ROOT, "dataset", "style_stats.json")))
    budget = style["density_p75"]; chosen = None; trail = []
    for eps in (1.5, 2.0, 2.5, 3.0, 3.5, 4.0, 5.0, 6.0, 7.0, 8.0, 10.0, 12.0):
        chains = fit_mask(mask, eps); st = stats(chains); ng = len(build_guides(chains, mask.shape[1]))
        cr = critique(rasterize(chains, mask.shape), target if target is not None else mask)
        trail.append({"eps": eps, "primitives": st["primitives"], "density": round(st["density"], 1),
                      "line_share": round(st["line_share"], 2), "iou": round(cr["iou"], 4), "p95": round(cr["outline_p95_px"], 1)})
        log(f"  eps {eps:4.1f}px -> {st['primitives']:3d} primitives, {ng:2d} guides ({st['density']:5.1f}/1000px, budget {budget:.1f})  "
            f"IoU {cr['iou']:.3f}  outline p95 {cr['outline_p95_px']:.1f}px")
        if st["density"] <= budget and (max_guides is None or ng <= max_guides) and chosen is None:
            chosen = (eps, chains, st, cr)
            break
    if chosen is None:
        chosen = (eps, chains, st, cr)
    return chosen + (trail,)


def write_svg(chains, bbox_, path, pad=0.12, size=1024):
    x0, y0, x1, y1 = bbox_; side = max(x1 - x0, y1 - y0) * (1 + 2 * pad)
    ox, oy = (x0 + x1) / 2 - side / 2, (y0 + y1) / 2 - side / 2
    d = " ".join(chain_path(c) for c in chains)
    open(path, "w").write(f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{ox:.1f} {oy:.1f} {side:.1f} {side:.1f}" '
                          f'width="{size}" height="{size}"><path fill="#000" fill-rule="evenodd" d="{d}"/></svg>')


def build(a):
    mask = np.asarray(Image.open(a.mask).convert("L")) < 128
    target = None
    if a.target:
        t = Image.open(a.target); t = t.getchannel("A") if t.mode in ("RGBA", "LA") else t.convert("L")
        sys.path.insert(0, HERE); from make_video import cover
        target = np.asarray(cover(t, Image.BILINEAR)) > 127
        lab, n = ndimage.label(target)
        if n > 1:
            target = lab == (1 + int(np.argmax(ndimage.sum(target, lab, range(1, n + 1)))))
    eps, chains, st, cr, trail = construct(mask, target)
    logo = rasterize(chains, mask.shape)
    ys, xs = np.nonzero(logo); bb = (int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1)
    os.makedirs(a.out, exist_ok=True)
    Image.fromarray(np.where(logo, 0, 255).astype(np.uint8)).save(os.path.join(a.out, "logo_canvas.png"))
    write_svg(chains, bb, os.path.join(a.out, "logo.svg"))
    guides = build_guides(chains, mask.shape[1])
    json.dump({"eps": eps, "paths": [chain_path(c) for c in chains], "guides": guides, "bbox": bb,
               "stats": {k: v for k, v in st.items() if k != "radii"}, "critique": cr, "search": trail},
              open(os.path.join(a.out, "construction.json"), "w"))
    if target is not None:                             # red = mark outside the animal, blue = animal left uncovered
        img = np.full(mask.shape + (3,), 255, np.uint8); img[logo & target] = (30, 30, 30)
        img[logo & ~target] = (230, 50, 40); img[target & ~logo] = (40, 110, 230)
        Image.fromarray(img).crop((max(0, bb[0] - 40), max(0, bb[1] - 40), bb[2] + 40, bb[3] + 40)).save(os.path.join(a.out, "critique.png"))
    print(f"chosen eps {eps}px: {st['primitives']} primitives ({st['line_share']:.0%} lines), {len(guides)} guides | "
          f"vs animal: IoU {cr['iou']:.3f}, outline mean {cr['outline_mean_px']:.1f}px, p95 {cr['outline_p95_px']:.1f}px, max {cr['outline_max_px']:.0f}px")


if __name__ == "__main__":
    ap = argparse.ArgumentParser(); sub = ap.add_subparsers(dest="cmd", required=True)
    c = sub.add_parser("calibrate"); c.add_argument("--dataset", default=os.path.join(ROOT, "dataset")); c.add_argument("--eps", type=float, default=2.0); c.set_defaults(f=calibrate)
    b = sub.add_parser("build"); b.add_argument("--mask", required=True); b.add_argument("--target"); b.add_argument("--out", required=True); b.set_defaults(f=build)
    a = ap.parse_args(); a.f(a)
