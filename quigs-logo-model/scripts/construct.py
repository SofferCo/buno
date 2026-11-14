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
            pr = dict(best[1]); pr["err"] = best[0]; pr["len"] = float((lo2 - i) * STEP); pr["pts"] = Q[i:lo2 + 1]
            if pr["type"] == "arc" and (pr["r"] < MIN_R or (abs(pr["s"]) <= 1.3 * eps and pr["len"] < 260)):
                pr = {"type": "line", "A": pr["A"], "B": pr["B"], "err": pr["err"], "len": pr["len"], "pts": pr["pts"]}
            prims.append(pr); i = lo2
    return prims


# ------------------------------------------------------------------ shared shapes: circles and ellipses
def wrap(x):
    return (x + np.pi) % (2 * np.pi) - np.pi


def ell_xy(E, t):
    cx, cy, rx, ry, ph = E; c, s_ = np.cos(ph), np.sin(ph); t = np.asarray(t, float)
    return np.stack([cx + rx * np.cos(t) * c - ry * np.sin(t) * s_, cy + rx * np.cos(t) * s_ + ry * np.sin(t) * c], -1)


_T = np.linspace(0, 2 * np.pi, 540, endpoint=False)
_GID = __import__('itertools').count()


def ell_project(E, P):
    """Nearest point of the ellipse for each P: (distance, parameter)."""
    S = ell_xy(E, _T)
    d2 = (P[:, None, 0] - S[None, :, 0]) ** 2 + (P[:, None, 1] - S[None, :, 1]) ** 2
    k = d2.argmin(1); t = _T[k]; h = _T[1]
    for _ in range(3):                                  # refine between neighbouring samples
        h /= 3
        cand = np.stack([t - h, t, t + h], 1)
        Q = ell_xy(E, cand)
        dd = (P[:, None, 0] - Q[..., 0]) ** 2 + (P[:, None, 1] - Q[..., 1]) ** 2
        t = cand[np.arange(len(P)), dd.argmin(1)]
    Q = ell_xy(E, t)
    return np.hypot(P[:, 0] - Q[:, 0], P[:, 1] - Q[:, 1]), t


def fit_circle_free(P):
    A = np.c_[P, np.ones(len(P))]; b = -(P ** 2).sum(1)
    (a, bb, c), *_ = np.linalg.lstsq(A, b, rcond=None)
    cx, cy = -a / 2, -bb / 2; r2 = cx * cx + cy * cy - c
    return None if r2 <= 0 else (float(cx), float(cy), float(np.sqrt(r2)), float(np.sqrt(r2)), 0.0)


def fit_ellipse(P):
    """Direct least-squares ellipse (Halir-Flusser). Returns (cx, cy, rx, ry, phi) with rx >= ry, or None."""
    m = P.mean(0); sc = np.abs(P - m).max() + 1e-9
    x, y = ((P - m) / sc).T
    D1 = np.stack([x * x, x * y, y * y], 1); D2 = np.stack([x, y, np.ones_like(x)], 1)
    S1, S2, S3 = D1.T @ D1, D1.T @ D2, D2.T @ D2
    try:
        T = -np.linalg.solve(S3, S2.T)
        M = S1 + S2 @ T
        M = np.array([M[2] / 2, -M[1], M[0] / 2])
        w, v = np.linalg.eig(M)
    except np.linalg.LinAlgError:
        return None
    v = np.real(v); cond = 4 * v[0] * v[2] - v[1] ** 2
    if not (cond > 1e-12).any():
        return None
    a1 = v[:, int(np.argmax(cond))]
    A, B, C = a1; D, E_, F = T @ a1
    Qm = np.array([[A, B / 2], [B / 2, C]])
    try:
        c0 = -np.linalg.solve(Qm, np.array([D / 2, E_ / 2]))
    except np.linalg.LinAlgError:
        return None
    k = c0 @ Qm @ c0 + np.array([D, E_]) @ c0 + F
    lam, vec = np.linalg.eigh(Qm / (-k))
    if (lam <= 0).any():
        return None
    ax = 1 / np.sqrt(lam)                               # lam ascending -> ax descending
    ph = float(np.arctan2(vec[1, 0], vec[0, 0]))
    return (float(c0[0] * sc + m[0]), float(c0[1] * sc + m[1]), float(ax[0] * sc), float(ax[1] * sc), ph)


def sweep_on(E, pts):
    """Signed parameter sweep of a point run along the ellipse, and its start parameter."""
    idx = np.unique(np.linspace(0, len(pts) - 1, 9).round().astype(int))
    _, t = ell_project(E, pts[idx])
    return float(t[0]), float(wrap(np.diff(t)).sum())


def shape_ok(E, tol, groups_pts):
    """Does the shape carry every point run? Each run must lie within tol of it AND travel along
    it once, in one direction, over about its own length (otherwise the arc would be drawn the
    wrong way round the shape)."""
    if E is None:
        return None
    cx, cy, rx, ry, ph = E
    if not (ry >= 10 and rx <= 760 and rx / ry <= 5.5):
        return None
    cover = 0.0
    for P in groups_pts:
        d, t = ell_project(E, P[::2] if len(P) > 40 else P)
        if d.max() > tol:
            return None
        steps = wrap(np.diff(t))
        if len(steps) and (np.sign(steps[np.abs(steps) > 1e-4]) != np.sign(steps.sum())).mean() > 0.12:
            return None                                 # the run doubles back along the shape
        t0, sw = sweep_on(E, P)
        arc = ell_xy(E, t0 + np.linspace(0, sw, 40)); on_shape = np.hypot(*np.diff(arc, axis=0).T).sum()
        own = np.hypot(*np.diff(P, axis=0).T).sum()
        if not (0.7 * own <= on_shape <= 1.4 * own) or abs(sw) > 1.9 * np.pi:
            return None
        cover += abs(sw)
    return cover


def consolidate(chains, tol):
    """Let several outline pieces share one circle or ellipse, the way a designer's body ellipse
    gives both the back and the belly. Curved primitives are grouped greedily: a pair of groups
    merges when one circle (preferred) or ellipse fits all their points within tol."""
    prims = [p for c in chains for p in c if p["type"] == "arc"]
    groups = [{"m": [p], "E": (p["C"][0], p["C"][1], p["r"], p["r"], 0.0), "len": p["len"]} for p in prims]
    cache = {}

    def try_pair(g, h):
        pts = [p["pts"] for p in g["m"] + h["m"]]
        allp = np.vstack(pts)
        if len(allp) < 12:
            return None
        for E in (fit_circle_free(allp), fit_ellipse(allp)):
            cov = shape_ok(E, tol, pts)
            if cov is not None and cov >= 0.2 * 2 * np.pi:      # the pieces must span a real part of the shape
                return E
        return None

    while True:
        best = None
        for i in range(len(groups)):
            for j in range(i + 1, len(groups)):
                key = (id(groups[i]), id(groups[j]))
                if key not in cache:
                    cache[key] = try_pair(groups[i], groups[j])
                if cache[key] is not None:
                    score = groups[i]["len"] + groups[j]["len"]
                    if best is None or score > best[0]:
                        best = (score, i, j, cache[key])
        if best is None:
            break
        _, i, j, E = best
        g = {"m": groups[i]["m"] + groups[j]["m"], "E": E, "len": groups[i]["len"] + groups[j]["len"]}
        groups = [x for k, x in enumerate(groups) if k not in (i, j)] + [g]
    def own_arc(p):                                     # the primitive's original circle, exact through its endpoints
        A, B, C, Q = (np.array(p[k]) for k in ("A", "B", "C", "Q"))
        a0, aq, a1 = (np.arctan2(*(X - C)[::-1]) for X in (A, Q, B))
        return (C[0], C[1], p["r"], p["r"], 0.0), float(a0), float(wrap(aq - a0) + wrap(a1 - aq))

    final = []
    for g in groups:
        placed, ok = [], len(g["m"]) > 1
        for p in g["m"] if ok else []:
            t0, sw = sweep_on(g["E"], p["pts"])
            arc = ell_xy(g["E"], t0 + np.linspace(0, sw, 48))
            far = np.sqrt(((arc[:, None] - p["pts"][None]) ** 2).sum(-1).min(1)).max()
            ends = max(np.hypot(*(arc[0] - p["pts"][0])), np.hypot(*(arc[-1] - p["pts"][-1])))
            if far > 2.0 * tol or ends > 2.0 * tol:     # the drawn arc must stay on its own stretch of outline
                ok = False; break
            placed.append((p, t0, sw))
        if ok:
            final.append((g["E"], placed))
        else:                                           # fall back to one shape per piece
            for p in g["m"]:
                E, t0, sw = own_arc(p); final.append((E, [(p, t0, sw)]))
    groups = []
    for E, placed in final:
        gi = next(_GID)                                 # unique across calls: body, cuts and final mark are fitted separately
        for p, t0, sw in placed:
            p.update({"type": "earc", "E": list(E), "t0": t0, "sw": sw, "g": gi,
                      "A": ell_xy(E, t0).tolist(), "B": ell_xy(E, t0 + sw).tolist()})
        groups.append({"E": E, "m": [p for p, _, _ in placed], "len": sum(p["len"] for p, _, _ in placed)})
    return [{"E": list(g["E"]), "n": len(g["m"]), "cover": sum(abs(p["sw"]) for p in g["m"]),
             "len": g["len"]} for g in groups]


# ------------------------------------------------------------------ geometry -> svg / raster / guides
def arc_points(p, step=2.0):
    if p["type"] == "earc":
        E = p["E"]; n = max(3, int(abs(p["sw"]) * max(E[2], E[3]) / step))
        return ell_xy(E, p["t0"] + np.linspace(0, p["sw"], n))
    A, B, C, Q = (np.array(p[k]) for k in ("A", "B", "C", "Q")); r = p["r"]
    a0, aq, a1 = (np.arctan2(*(X - C)[::-1]) for X in (A, Q, B))
    d1, d2 = wrap(aq - a0), wrap(a1 - aq)
    m = max(2, int(abs(d1 + d2) * r / step))
    t = a0 + np.concatenate([np.linspace(0, d1, m // 2 + 1), d1 + np.linspace(0, d2, m // 2 + 1)[1:]])
    return np.stack([C[0] + r * np.cos(t), C[1] + r * np.sin(t)], 1)


def chain_polyline(prims):
    pts = []
    for p in prims:
        pts.append(np.array([p["A"]]) if p["type"] == "line" else arc_points(p))
    return np.vstack(pts)


def chain_path(prims):
    """SVG path made only of lines and (elliptical) arcs. A piece on a shared shape starts and ends
    on that shape; the join to its neighbour is a straight step no longer than the tolerance."""
    first = prims[0]["A"]
    d = [f"M{first[0]:.2f},{first[1]:.2f}"]
    for k, p in enumerate(prims):
        if p["type"] == "line":
            d.append(f"L{p['B'][0]:.2f},{p['B'][1]:.2f}")
        elif p["type"] == "earc":
            cx, cy, rx, ry, ph = p["E"]
            if k:
                d.append(f"L{p['A'][0]:.2f},{p['A'][1]:.2f}")
            sw = p["sw"]; parts = max(1, int(np.ceil(abs(sw) / 3.0)))   # keep every arc under 180 degrees
            for q in range(1, parts + 1):
                e = ell_xy(p["E"], p["t0"] + sw * q / parts)
                d.append(f"A{rx:.2f},{ry:.2f} {np.degrees(ph):.2f} 0 {1 if sw > 0 else 0} {e[0]:.2f},{e[1]:.2f}")
        else:
            A, B, Q = np.array(p["A"]), np.array(p["B"]), np.array(p["Q"])
            v1, v2 = Q - A, B - Q
            sweep = 1 if v1[0] * v2[1] - v1[1] * v2[0] > 0 else 0
            large = 1 if abs(p["s"]) > np.hypot(*(B - A)) / 2 else 0
            d.append(f"A{p['r']:.2f},{p['r']:.2f} 0 {large} {sweep} {B[0]:.2f},{B[1]:.2f}")
    return "".join(d) + "Z"


def rasterize(chains, shape, scale=1.0, ox=0.0, oy=0.0):
    """Even-odd raster of the chains; scale/offset render the vector at another size."""
    H, W = shape; out = np.zeros(shape, bool); S = 2
    for prims in chains:
        im = Image.new("L", (W * S, H * S), 0)
        ImageDraw.Draw(im).polygon([((float(x) - ox) * scale * S, (float(y) - oy) * scale * S) for x, y in chain_polyline(prims)], fill=255)
        out ^= np.asarray(im.resize((W, H), Image.LANCZOS)) > 127
    return out


def render_square(chains, bbox_, size=1024, pad=0.12):
    """The mark as a crisp black-on-white square image, drawn from the vector."""
    x0, y0, x1, y1 = bbox_; side = max(x1 - x0, y1 - y0) * (1 + 2 * pad)
    m = rasterize(chains, (size, size), size / side, (x0 + x1) / 2 - side / 2, (y0 + y1) / 2 - side / 2)
    return Image.fromarray(np.where(m, 0, 255).astype(np.uint8)).convert("RGB")


def build_guides(chains, W, full_r=400):
    """One guide per shape. A shared or compact shape is drawn whole (circle or ellipse); a lone,
    very large arc is drawn as a longer sweep of itself; a line is extended past both ends.
    Collinear lines share one guide."""
    shapes, lines, sweeps = {}, [], []
    for p in sorted([p for c in chains for p in c], key=lambda p: -p["len"]):
        if p["type"] == "earc":
            shapes.setdefault(p["g"], {"E": p["E"], "m": []})["m"].append(p)
        elif p["type"] == "arc":                        # not consolidated (calibration path)
            shapes.setdefault(id(p), {"E": [p["C"][0], p["C"][1], p["r"], p["r"], 0.0], "m": [p]})
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
    ovals = []
    for sh in shapes.values():
        cx, cy, rx, ry, ph = sh["E"]; m = sh["m"]
        if len(m) == 1 and rx > full_r and m[0]["type"] == "earc":
            p = m[0]; sw = p["sw"]; ext = np.sign(sw) * min(0.25 * abs(sw) + 45 / rx, 0.6)
            t = np.linspace(p["t0"] - ext, p["t0"] + sw + ext, max(8, int(abs(sw + 2 * ext) * rx / 6)))
            pts = ell_xy(sh["E"], t)
            if pts[0, 0] > pts[-1, 0]:
                pts, sw = pts[::-1], -sw
            sweeps.append({"type": "path", "x1": float(pts[0, 0]), "y1": float(pts[0, 1]), "pts": np.round(pts, 1).tolist(),
                           "d": "M" + "L".join(f"{x:.1f},{y:.1f}" for x, y in pts)})
        elif abs(rx - ry) < 0.03 * rx:
            ovals.append({"type": "circle", "cx": cx, "cy": cy, "r": (rx + ry) / 2})
        else:
            ovals.append({"type": "ellipse", "cx": cx, "cy": cy, "rx": rx, "ry": ry, "rot": float(np.degrees(ph))})
    out_lines = []
    for l in lines:
        ext = 0.2 * (l["t1"] - l["t0"]) + 24
        a, b = l["p"] + l["d"] * (l["t0"] - ext), l["p"] + l["d"] * (l["t1"] + ext)
        out_lines.append({"type": "line", "x1": float(a[0]), "y1": float(a[1]), "x2": float(b[0]), "y2": float(b[1])})
    size = lambda o: o.get("r", o.get("rx", 0))
    big = sorted([o for o in ovals if size(o) >= 60], key=lambda o: -size(o))
    small = sorted([o for o in ovals if size(o) < 60], key=lambda o: o["cx"])
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
        elif g["type"] == "ellipse":
            pts = ell_xy((g["cx"], g["cy"], g["rx"], g["ry"], np.radians(g["rot"])), np.linspace(0, 2 * np.pi, 400))
            d.line([tuple(q) for q in pts], fill=255, width=width)
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
def fit_mask(mask, eps, share=True):
    chains = []
    for P in outline_points(mask):
        P = ndimage.gaussian_filter1d(P, 1.2, axis=0, mode="wrap")
        e = eps if len(P) * STEP > 260 else min(eps, 2.0)   # eyes and small cuts stay crisp
        prims = fit_chain(P, e, find_corners(P))
        if len(prims) >= 2:
            chains.append(prims)
    if share:
        consolidate(chains, 1.3 * eps)
    return chains


def stats(chains):
    prims = [p for c in chains for p in c]
    per = sum(p["len"] for p in prims)
    return {"primitives": len(prims), "outline_px": per, "density": 1000 * len(prims) / max(per, 1),
            "line_share": sum(p["type"] == "line" for p in prims) / max(len(prims), 1),
            "radii": [p["r"] if p["type"] == "arc" else p["E"][2] for p in prims if p["type"] != "line"]}


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
        st = stats(fit_mask(m, a.eps, share=False)); rows.append({"logo": f[:-4], **{k: v for k, v in st.items() if k != "radii"},
                                                     "r_median": float(np.median(st["radii"])) if st["radii"] else 0})
        print(f"{f[:-4]:26s} prims {st['primitives']:3d}  density {st['density']:5.1f}/1000px  lines {st['line_share']:.0%}")
    dens = np.array([r["density"] for r in rows]); ls = np.array([r["line_share"] for r in rows])
    out = {"fit_eps_px": a.eps, "logos": len(rows), "density_median": float(np.median(dens)),
           "density_p75": float(np.percentile(dens, 75)), "line_share_median": float(np.median(ls)),
           "primitives_median": float(np.median([r["primitives"] for r in rows])), "per_logo": rows}
    json.dump(out, open(os.path.join(a.dataset, "style_stats.json"), "w"), indent=1)
    print(f"\nreference style: {out['primitives_median']:.0f} primitives per mark, {out['density_median']:.1f} per 1000 px of "
          f"outline (p75 {out['density_p75']:.1f}), {out['line_share_median']:.0%} straight lines")


def construct(mask, target=None, style=None, log=print, max_ovals=None):
    """Tightest construction whose density stays within the reference logos' density
    (and, when asked, whose number of guide shapes stays readable on screen)."""
    style = style or json.load(open(os.path.join(ROOT, "dataset", "style_stats.json")))
    budget = style["density_p75"]; chosen = None; trail = []
    for eps in (1.5, 2.0, 2.5, 3.0, 3.5, 4.0, 5.0, 6.0, 7.0, 8.0, 10.0, 12.0):
        chains = fit_mask(mask, eps); st = stats(chains); gs = build_guides(chains, mask.shape[1])
        ng = len(gs); no = sum(g["type"] != "line" for g in gs)     # circles, ellipses and sweeps crowd the frame; lines do not
        cr = critique(rasterize(chains, mask.shape), target if target is not None else mask)
        trail.append({"eps": eps, "primitives": st["primitives"], "density": round(st["density"], 1),
                      "line_share": round(st["line_share"], 2), "iou": round(cr["iou"], 4), "p95": round(cr["outline_p95_px"], 1)})
        log(f"  eps {eps:4.1f}px -> {st['primitives']:3d} primitives, {ng:2d} guides of which {no:2d} ovals ({st['density']:5.1f}/1000px, "
            f"budget {budget:.1f})  IoU {cr['iou']:.3f}  outline p95 {cr['outline_p95_px']:.1f}px")
        if st["density"] <= budget and (max_ovals is None or no <= max_ovals) and chosen is None:
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
