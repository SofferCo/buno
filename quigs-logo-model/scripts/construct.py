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
# Parameters of the shapes-first construction. The values in dataset/trained_params.json (written by
# train_on_references.py, fitted against the designer's own constructions) override these defaults.
DEFAULTS = {
    "tol_rel": 0.0075,        # base tolerance as a share of the animal's size
    "oval_delta_mult": 1.0,   # how far an oval's edge may sit from the outline it explains (x tolerance)
    "line_tau_mult": 1.6,     # how far a straight stroke may sit from the outline (x tolerance)
    "oval_inside_min": 0.86,  # least share of an oval that must lie inside the animal
    "oval_max_r": 0.5,        # largest oval radius as a share of the animal's size
    "oval_min_r": 0.045,      # smallest
    "oval_max_aspect": 4.0,
    "oval_min_cover": 0.0,    # least share of an oval's circumference that must lie on the outline
    "oval_min_gain": 0.045,   # least share of the outline a new oval must explain
    "oval_max_k": 6,
    "circle_bonus": 1.08,     # preference for a perfect circle over an ellipse that explains as much
    "contour_sigma": 1.2,     # smoothing of the outline before fitting (points, 2 px apart)
    "curl_max_r": 0.075,      # a tight curl outside the ovals may become a small circle up to this radius
    "curl_min_span": 1.5,     # ... if it turns through at least this many radians
    # the outline as the fewest perfect shapes (dp_chain)
    "thick_k": 0.22,          # allowance = this share of the local thickness of the animal (or of the gap beside it)
    "tol_max_rel": 0.03,      # ... but never more than this share of the animal's size
    "arc_cost": 2.2,          # a circular arc is used where it replaces more than this many straight strokes
    "ell_cost": 2.9,          # same for an arc of an ellipse
    "arc_min_sweep": 0.6,     # an arc must turn through at least this many radians (flatter is a stroke)
    "ell_min_sweep": 1.6,
    "circle_max_r": 0.25,     # largest circle radius, share of the animal's size (designer: 90% are under 0.21)
    "ell_max_r": 0.35,        # largest ellipse half-length (designer: 90% are under 0.31)
    "ell_max_aspect": 2.6,    # longest ellipse (designer: median 1.55, three quarters under 2.13)
}
PARAMS = dict(DEFAULTS)
_tp = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "dataset", "trained_params.json")
if os.path.exists(_tp):
    PARAMS.update(json.load(open(_tp)).get("params", {}))

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


def _greedy(Q, eps):
    """Longest-fit primitives along an open run of points."""
    prims, m, i = [], len(Q), 0
    while i < m - 1:
        lo, hi, step = i + 1, None, 8
        best = fit_prim(Q[i:lo + 1], eps)
        j = lo
        while hi is None:                               # gallop
            j2 = min(m - 1, j + step); e, pr = fit_prim(Q[i:j2 + 1], eps)
            if e <= eps and pr:
                j, best = j2, (e, pr); step *= 2
                if j == m - 1:
                    hi = j
            else:
                hi = j2
        lo2, hi2 = j, hi
        while hi2 - lo2 > 1:                            # bisect
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


def fit_chain(P, eps, corners):
    """Greedy longest-fit chain of primitives around a closed contour, broken at corners."""
    n = len(P)
    if not corners:
        c = P.mean(0); corners = [int(np.argmax(np.hypot(*(P - c).T)))]
        corners.append((corners[0] + n // 2) % n); corners.sort()
    prims = []
    for a, b in zip(corners, corners[1:] + [corners[0] + n]):
        prims += _greedy(P[np.arange(a, b + 1) % n], eps)
    return prims


def fit_open(Q, eps, k=5, thr_deg=42):
    """Same, for an open run: split at its own corners first."""
    if len(Q) < 3:
        return [{"type": "line", "A": Q[0].tolist(), "B": Q[-1].tolist(), "err": 0.0, "len": float(len(Q) * STEP), "pts": Q}]
    cuts = [0]
    if len(Q) > 2 * k + 2:
        v1 = Q[k:-k] - Q[:-2 * k]; v2 = Q[2 * k:] - Q[k:-k]
        cos = (v1 * v2).sum(1) / (np.hypot(*v1.T) * np.hypot(*v2.T) + 1e-9)
        ang = np.degrees(np.arccos(np.clip(cos, -1, 1)))
        for i in np.argsort(-ang):
            if ang[i] < thr_deg:
                break
            if all(abs(i + k - c) > 6 for c in cuts) and 4 < i + k < len(Q) - 5:
                cuts.append(int(i + k))
    cuts = sorted(cuts) + [len(Q) - 1]
    prims = []
    for a, b in zip(cuts[:-1], cuts[1:]):
        if b > a:
            prims += _greedy(Q[a:b + 1], eps)
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


def fit_ellipse_axis(P):
    """Least-squares ellipse with horizontal/vertical axes (the ellipse tool, not rotated)."""
    m = P.mean(0); sc = np.abs(P - m).max() + 1e-9
    x, y = ((P - m) / sc).T
    M = np.stack([x * x, y * y, x, y], 1)
    (A, C, D, E_), *_ = np.linalg.lstsq(M, np.ones(len(x)), rcond=None)
    if A <= 1e-9 or C <= 1e-9:
        return None
    x0, y0 = -D / (2 * A), -E_ / (2 * C); rhs = 1 + A * x0 * x0 + C * y0 * y0
    if rhs <= 0:
        return None
    rx, ry = np.sqrt(rhs / A) * sc, np.sqrt(rhs / C) * sc
    cx, cy = x0 * sc + m[0], y0 * sc + m[1]
    return (float(cx), float(cy), float(rx), float(ry), 0.0) if rx >= ry else (float(cx), float(cy), float(ry), float(rx), float(np.pi / 2))


def perfect(E, P):
    """Snap a fitted oval to the shape a designer would draw: a true circle if it is nearly round,
    an unrotated ellipse if it is nearly upright. In the references 42% of ovals are circles and
    half of the ellipses are upright."""
    if E is None:
        return None
    cx, cy, rx, ry, ph = E
    if rx / max(ry, 1e-6) <= 1.09:
        return fit_circle_free(P) or E
    tilt = np.degrees(ph) % 90
    if min(tilt, 90 - tilt) <= 8:
        return fit_ellipse_axis(P) or E
    return E


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


# ------------------------------------------------------------------ shapes first: body-mass ovals, then lines
def _runs(flag):
    """Circular runs of True in a boolean ring: list of (start, length)."""
    n = len(flag)
    if flag.all():
        return [(0, n)]
    if not flag.any():
        return []
    start = int(np.nonzero(~flag)[0][0]); f = np.roll(flag, -start); out = []; i = 0
    while i < n:
        if f[i]:
            j = i
            while j < n and f[j]:
                j += 1
            out.append(((i + start) % n, j - i)); i = j
        else:
            i += 1
    return out


def inside_share(E, mask):
    t = np.linspace(0, 2 * np.pi, 48, endpoint=False); H, W = mask.shape; hit = tot = 0
    for f in (0.35, 0.7, 0.93):
        q = ell_xy((E[0], E[1], E[2] * f, E[3] * f, E[4]), t)
        x = np.clip(q[:, 0].round().astype(int), 0, W - 1); y = np.clip(q[:, 1].round().astype(int), 0, H - 1)
        ok = (q[:, 0] >= 0) & (q[:, 0] < W) & (q[:, 1] >= 0) & (q[:, 1] < H)
        hit += (mask[y, x] & ok).sum(); tot += len(t)
    return hit / tot


def ell_perimeter(E):
    a, b = E[2], E[3]; h = ((a - b) / (a + b)) ** 2
    return np.pi * (a + b) * (1 + 3 * h / (10 + np.sqrt(4 - 3 * h)))


def mass_ovals(P, mask, delta, log=None, prm=None):
    """Pick the circles and ellipses of the construction. Candidates are fitted to stretches of the
    outline; a candidate must explain a real stretch of outline with a real share of its own
    circumference; they are taken greedily by how much new outline each explains. Every threshold
    here is a trained parameter (see DEFAULTS)."""
    prm = prm or PARAMS
    N = len(P); size = max(np.ptp(P[:, 0]), np.ptp(P[:, 1])); Ps = P[::2]; cands = []
    for L in (30, 45, 70, 110, 170, 260, 380):
        if L > 0.7 * N:
            continue
        for s0 in range(0, N, max(6, L // 5)):
            seg = P[(s0 + np.arange(L)) % N]
            for E in (fit_circle_free(seg), perfect(fit_ellipse(seg), seg)):
                if E is None:
                    continue
                cx, cy, rx, ry, ph = E
                if ry < max(8, prm["oval_min_r"] * size) or rx > prm["oval_max_r"] * size or rx / ry > prm["oval_max_aspect"]:
                    continue
                if prm["oval_inside_min"] > 0 and inside_share(E, mask) < prm["oval_inside_min"]:
                    continue
                d, _ = ell_project(E, Ps)
                near = np.repeat(d <= delta, 2)[:N]
                keep = np.zeros(N, bool)
                for st, ln in _runs(near):
                    if ln >= 14:                        # touching the outline in passing does not count
                        keep[(st + np.arange(ln)) % N] = True
                if keep.sum() < 20 or keep.sum() * STEP < prm["oval_min_cover"] * ell_perimeter(E):
                    continue
                cands.append((E, keep, abs(rx - ry) < 0.03 * rx))
    chosen, covered = [], np.zeros(N, bool)
    while len(chosen) < prm["oval_max_k"] and cands:
        gains = [((k & ~covered).sum() * (prm["circle_bonus"] if circ else 1.0)) for _, k, circ in cands]
        b = int(np.argmax(gains))
        if gains[b] < max(24, prm["oval_min_gain"] * N):
            break
        E, keep, _ = cands[b]; chosen.append(E); covered |= keep
        if log:
            log(f"    oval {len(chosen)}: centre ({E[0]:.0f},{E[1]:.0f}) radii {E[2]:.0f}x{E[3]:.0f} explains {gains[b] * STEP:.0f}px of outline")
    return chosen


def to_earc(p):
    """A free circular arc as a piece of its own circle."""
    A, B, C, Q = (np.array(p[k]) for k in ("A", "B", "C", "Q"))
    a0, aq, a1 = (np.arctan2(*(X - C)[::-1]) for X in (A, Q, B))
    p.update({"type": "earc", "E": [float(C[0]), float(C[1]), p["r"], p["r"], 0.0], "t0": float(a0),
              "sw": float(wrap(aq - a0) + wrap(a1 - aq)), "g": next(_GID)})
    return p


def _dp(Q, eps):
    """Douglas-Peucker on an open run: indices of the kept points."""
    n = len(Q); keep = np.zeros(n, bool); keep[[0, n - 1]] = True; stack = [(0, n - 1)]
    while stack:
        a, b = stack.pop()
        if b <= a + 1:
            continue
        p, d = Q[a], Q[b] - Q[a]; L = np.hypot(*d); seg = Q[a + 1:b]
        dist = np.hypot(*(seg - p).T) if L < 1e-9 else np.abs(d[0] * (seg[:, 1] - p[1]) - d[1] * (seg[:, 0] - p[0])) / L
        i = int(np.argmax(dist))
        if dist[i] > eps:
            k = a + 1 + i; keep[k] = True; stack += [(a, k), (k, b)]
    return np.nonzero(keep)[0]


def shapes_first_chain(P, mask, delta, tau, log=None, with_ovals=True, prm=None):
    """Outline = stretches lying on the body-mass ovals + straight strokes (and the odd small
    circle for a tight curl) for everything between them."""
    N = len(P); size = max(np.ptp(P[:, 0]), np.ptp(P[:, 1]))
    prm = prm or PARAMS
    ovals = mass_ovals(P, mask, delta, log=log, prm=prm) if with_ovals else []
    lab = np.full(N, -1); best = np.full(N, 1e9)
    for k, E in enumerate(ovals):
        d, _ = ell_project(E, P)
        m = (d <= delta) & (d < best); lab[m] = k; best[m] = d[m]
    for k in range(len(ovals)):                         # an oval only owns real stretches
        for st, ln in _runs(lab == k):
            if ln < 14:
                lab[(st + np.arange(ln)) % N] = -1
    gids = [next(_GID) for _ in ovals]
    segs = []                                           # (label, start, length) around the ring
    if (lab == lab[0]).all():
        segs = [(int(lab[0]), 0, N)]
    else:
        start = int(np.nonzero(lab != np.roll(lab, 1))[0][0]); i = 0
        while i < N:
            a = (start + i) % N; j = i
            while j < N and lab[(start + j) % N] == lab[a]:
                j += 1
            segs.append((int(lab[a]), a, j - i)); i = j
    prims = []
    for k, a, ln in segs:
        pts = P[(a + np.arange(ln + 1)) % N] if ln < N else P
        if k >= 0:
            E = ovals[k]; t0, sw = sweep_on(E, pts)
            arc = ell_xy(E, t0 + np.linspace(0, sw, 48))
            far = np.sqrt(((arc[:, None] - pts[None]) ** 2).sum(-1).min(1)).max()
            if far <= 2.2 * delta and abs(sw) < 1.95 * np.pi:
                prims.append({"type": "earc", "E": list(E), "t0": t0, "sw": sw, "g": gids[k], "len": float(ln * STEP),
                              "A": ell_xy(E, t0).tolist(), "B": ell_xy(E, t0 + sw).tolist(), "pts": pts})
                continue
        for p in fit_open(pts, tau):
            tight = (with_ovals and p["type"] == "arc" and p["r"] <= prm["curl_max_r"] * size
                     and abs(p["len"] / p["r"]) >= prm["curl_min_span"])
            if tight:                                   # a real curl (tail tip, ear, paw): a small circle
                prims.append(to_earc(p))
            elif p["type"] == "arc":                    # any other curve is drawn with straight strokes, as in the references
                Q = p["pts"]; idx = _dp(Q, tau)
                for a0, b0 in zip(idx[:-1], idx[1:]):
                    prims.append({"type": "line", "A": Q[a0].tolist(), "B": Q[b0].tolist(), "err": tau,
                                  "len": float((b0 - a0) * STEP), "pts": Q[a0:b0 + 1]})
            else:
                prims.append(p)
    n = len(prims)                                      # strokes meet the ovals exactly: no step at the joins
    for i, p in enumerate(prims):
        if p["type"] == "line":
            prv, nxt = prims[i - 1], prims[(i + 1) % n]
            if prv["type"] == "earc":
                p["A"] = list(prv["B"])
            if nxt["type"] == "earc":
                p["B"] = list(nxt["A"])
    return prims, ovals


# ------------------------------------------------------------------ the outline as the fewest perfect shapes
def local_tolerance(P, mask, tmin, tmax, k):
    """How far the built outline may sit from each outline point. The designer redraws a broad
    body boldly and a thin leg precisely, so the allowance is a share of how thick the animal
    is behind the point - or how wide the gap is in front of it, whichever is smaller."""
    N = len(P); H, W = mask.shape
    tan = np.roll(P, -4, 0) - np.roll(P, 4, 0); tan /= np.hypot(*tan.T)[:, None] + 1e-9
    nrm = np.stack([-tan[:, 1], tan[:, 0]], 1)
    q = P + 3 * nrm; xi = np.clip(q[:, 0].round().astype(int), 0, W - 1); yi = np.clip(q[:, 1].round().astype(int), 0, H - 1)
    if mask[yi, xi].mean() < 0.5:
        nrm = -nrm
    s = np.arange(2.0, max(12.0, 14 * tmax), 2.0)

    def depth(sign, m):
        dt = ndimage.distance_transform_edt(m)
        X = P[:, None, :] + sign * s[None, :, None] * nrm[:, None, :]
        xi = X[..., 0].round().astype(int); yi = X[..., 1].round().astype(int)
        ok = (xi >= 0) & (xi < W) & (yi >= 0) & (yi < H)
        v = np.where(ok, dt[np.clip(yi, 0, H - 1), np.clip(xi, 0, W - 1)], 1e6 if sign < 0 else 0.0)
        alive = np.cumprod(v > 0, axis=1).astype(bool)
        rising = np.ones_like(alive); rising[:, 2:] = (v[:, 2:] - v[:, :-2]) >= 1.0      # the ridge: thickness stops growing
        rising = np.cumprod(rising, axis=1).astype(bool)
        return np.where(alive & rising, v, 0).max(1)

    h = np.minimum(depth(+1, mask), depth(-1, ~mask))
    tol = np.clip(k * h, tmin, tmax)
    tol = ndimage.minimum_filter1d(tol, 9, mode="wrap")
    return ndimage.gaussian_filter1d(tol, 3, mode="wrap")


def _line_fit(Q, w):
    m = (Q * w[:, None]).sum(0) / w.sum(); X = (Q - m) * np.sqrt(w)[:, None]
    _, _, vt = np.linalg.svd(X, full_matrices=False); d = vt[0]
    return m, d, np.abs((Q - m) @ np.array([-d[1], d[0]]))


def _circle_fit(Q, w):
    E = fit_circle_free(Q)
    if E is None:
        return None, None
    cx, cy, r = E[0], E[1], E[2]
    for _ in range(3):                                  # geometric refinement (the algebraic fit shrinks short arcs)
        dx, dy = Q[:, 0] - cx, Q[:, 1] - cy; d = np.hypot(dx, dy) + 1e-9
        J = np.stack([-dx / d, -dy / d, -np.ones_like(d)], 1) * w[:, None]
        try:
            step, *_ = np.linalg.lstsq(J, -(d - r) * w, rcond=None)
        except np.linalg.LinAlgError:
            break
        cx, cy, r = cx + step[0], cy + step[1], r + step[2]
        if not np.isfinite(r) or r <= 0:
            return None, None
    return (float(cx), float(cy), float(r), float(r), 0.0), np.abs(np.hypot(Q[:, 0] - cx, Q[:, 1] - cy) - r)


def _sub(a, b, n=56):
    return np.unique(np.linspace(a, b, min(n, b - a + 1)).round().astype(int))


def dp_chain(P, mask, tmin, prm=None, log=None):
    """The outline as the cheapest chain of perfect shapes: straight strokes, arcs of true circles
    and arcs of ellipses, each within the local allowance of the points it replaces. A dynamic
    programme over the whole ring picks the breakpoints, so a long bold stroke is preferred to
    several timid ones. Corners are where neighbouring shapes actually intersect."""
    prm = prm or PARAMS
    N = len(P); size = max(np.ptp(P[:, 0]), np.ptp(P[:, 1]))
    tau = local_tolerance(P, mask, tmin, prm["tol_max_rel"] * size, prm["thick_k"])
    v1 = P - np.roll(P, 5, 0); v2 = np.roll(P, -5, 0) - P
    turn = np.degrees(np.arccos(np.clip((v1 * v2).sum(1) / (np.hypot(*v1.T) * np.hypot(*v2.T) + 1e-9), -1, 1)))
    start = int(np.argmax(turn)); P = np.roll(P, -start, 0); tau = np.roll(tau, -start); turn = np.roll(turn, -start)
    P2 = np.vstack([P, P]); tau2 = np.concatenate([tau, tau]); w2 = 1.0 / tau2
    m = max(2, N // int(prm.get("dp_nodes", 320))); B = list(range(0, N, m))
    if N - B[-1] < m // 2 + 1:
        B.pop()
    B.append(N); K = len(B) - 1                          # breakpoints 0..K, B[K] closes the ring
    rmin, rmax, emax = prm["oval_min_r"] * size, prm["circle_max_r"] * size, prm["ell_max_r"] * size

    def line_ok(a, b):
        i = _sub(a, b); _, _, r = _line_fit(P2[i], w2[i])
        return bool((r <= tau2[i]).all())

    def circle(a, b, slack=1.0):
        i = _sub(a, b)
        if len(i) < 6:
            return None
        E0 = fit_circle_free(P2[i])                     # cheap screen before the careful fit
        if E0 is None or (np.abs(np.hypot(P2[i, 0] - E0[0], P2[i, 1] - E0[1]) - E0[2]) > 3 * tau2[i]).any():
            return None
        E, r = _circle_fit(P2[i], w2[i])
        if E is None or not (rmin <= E[2] <= rmax) or (r > slack * tau2[i]).any():
            return None
        sw = (b - a) * STEP / E[2]
        return E if prm["arc_min_sweep"] <= sw <= 1.9 * np.pi else None

    def ellipse(a, b, slack=1.0):
        i = _sub(a, b, 44)
        if len(i) < 16:
            return None
        E = perfect(fit_ellipse(P2[i]), P2[i])
        if E is None or abs(E[2] - E[3]) < 0.03 * E[2]:
            return None
        if not (E[3] >= rmin and E[2] <= emax and E[2] / E[3] <= prm["ell_max_aspect"]):
            return None
        d, t = ell_project(E, P2[i])
        if (d > slack * tau2[i]).any():
            return None
        sw = abs(wrap(np.diff(t)).sum())
        return E if prm["ell_min_sweep"] <= sw <= 1.9 * np.pi else None

    reach_l = np.zeros(K, int); lo_c = np.full(K, K + 1); hi_c = np.zeros(K, int); lo_e = np.full(K, K + 1); hi_e = np.zeros(K, int)
    span = max(2, int(0.75 * K))
    for k in range(K):
        top = min(K, k + span)
        j, stp = k + 1, 1                               # straight strokes: gallop, then bisect
        while j < top and line_ok(B[k], B[min(top, j + stp)]):
            j = min(top, j + stp); stp *= 2
        lo, hi = j, min(top, j + stp)
        while hi - lo > 1:
            mid = (lo + hi) // 2
            if line_ok(B[k], B[mid]):
                lo = mid
            else:
                hi = mid
        reach_l[k] = lo
        for fn, lo_a, hi_a, on in ((circle, lo_c, hi_c, True), (ellipse, lo_e, hi_e, prm["ell_cost"] < 50)):
            if not on:
                continue
            L = max(3, reach_l[k] - k + 1); last = None  # ovals: a ladder of lengths beyond what a stroke can do
            while k + L <= top:
                if fn(B[k], B[k + L]) is not None:
                    lo_a[k] = min(lo_a[k], k + L); last = k + L
                elif last is not None:
                    break
                L = max(L + 1, int(L * 1.22))
            if last is not None:
                lo, hi = last, min(top, max(last + 1, int((last - k) * 1.22) + k))
                while hi - lo > 1:
                    mid = (lo + hi) // 2
                    if fn(B[k], B[mid]) is not None:
                        lo = mid
                    else:
                        hi = mid
                hi_a[k] = lo
    corner = np.array([1.0 - min(1.0, turn[B[j] % N] / 60.0) for j in range(K + 1)]) * 0.08   # break at real corners
    f = np.full(K + 1, 1e9); f[0] = 0.0; back = [None] * (K + 1)
    for j in range(1, K + 1):
        for typ, cost in (("line", 1.0), ("circle", prm["arc_cost"]), ("ellipse", prm["ell_cost"])):
            if typ == "line":
                ok = reach_l[:j] >= j
            elif typ == "circle":
                ok = (lo_c[:j] <= j) & (hi_c[:j] >= j)
            else:
                ok = (lo_e[:j] <= j) & (hi_e[:j] >= j)
            if ok.any():
                c = np.where(ok, f[:j] + cost, 1e9); i = int(np.argmin(c))
                if c[i] + corner[j] < f[j]:
                    f[j] = c[i] + corner[j]; back[j] = (i, typ)
    segs = []; j = K
    while j > 0:
        i, typ = back[j]; segs.append((i, j, typ)); j = i
    segs.reverse()
    prims = []
    for i, j, typ in segs:
        a, b = B[i], B[j]; pts = P2[a:b + 1]; E = None
        fn = circle if typ == "circle" else (ellipse if typ == "ellipse" else None)
        if fn is not None:
            E = fn(a, b) or fn(a, b, 1.5)
        if E is not None:
            t0, sw = sweep_on(E, pts)
            prims.append({"type": "earc", "E": list(E), "t0": t0, "sw": sw, "g": next(_GID), "len": float((b - a) * STEP),
                          "A": ell_xy(E, t0).tolist(), "B": ell_xy(E, t0 + sw).tolist(), "pts": pts, "tau": tau2[a:b + 1]})
        elif typ != "line":                             # the oval does not hold on the full run: strokes and smaller arcs
            T = tau2[a:b + 1]; k0 = 0
            for q in fit_open(pts, float(np.median(T))):
                n_q = len(q["pts"]); q["tau"] = T[k0:k0 + n_q] if k0 + n_q <= len(T) else np.full(n_q, T[-1]); k0 += n_q - 1
                if q["type"] == "arc":
                    to_earc(q)
                    q["A"] = ell_xy(q["E"], q["t0"]).tolist(); q["B"] = ell_xy(q["E"], q["t0"] + q["sw"]).tolist()
                prims.append(q)
        else:
            ii = np.arange(a, b + 1); c0, d, _ = _line_fit(P2[ii], w2[ii])
            if (P2[b] - P2[a]) @ d < 0:
                d = -d
            A = c0 + d * ((P2[a] - c0) @ d); Bp = c0 + d * ((P2[b] - c0) @ d)
            prims.append({"type": "line", "A": A.tolist(), "B": Bp.tolist(), "err": 0.0, "len": float((b - a) * STEP), "pts": pts, "tau": tau2[a:b + 1]})
    share_ovals(prims)
    join_shapes(prims)
    if log:
        n_o = len({p["g"] for p in prims if p["type"] == "earc"})
        log(f"    outline: {sum(p['type'] == 'line' for p in prims)} strokes + {n_o} ovals, allowance {tau.min():.1f}-{tau.max():.1f}px")
    return prims


def share_ovals(prims):
    """Arcs that belong to one and the same circle or ellipse become pieces of that one shape."""
    arcs = [p for p in prims if p["type"] == "earc"]
    for i, a in enumerate(arcs):
        for b in arcs[i + 1:]:
            if a["g"] == b["g"]:
                continue
            Ea, Eb = a["E"], b["E"]; ra, rb = (Ea[2] + Ea[3]) / 2, (Eb[2] + Eb[3]) / 2
            if not (0.75 <= ra / rb <= 1.33) or np.hypot(Ea[0] - Eb[0], Ea[1] - Eb[1]) > 0.45 * min(ra, rb):
                continue
            Q = np.vstack([a["pts"], b["pts"]]); T = np.concatenate([a["tau"], b["tau"]]); idx = _sub(0, len(Q) - 1, 90)
            round_ = abs(Ea[2] - Ea[3]) < 0.03 * Ea[2] and abs(Eb[2] - Eb[3]) < 0.03 * Eb[2]
            E = _circle_fit(Q[idx], 1.0 / T[idx])[0] if round_ else perfect(fit_ellipse(Q[idx]), Q[idx])
            if E is None or (ell_project(E, Q[idx])[0] > 1.15 * T[idx]).any():
                continue
            old = b["g"]
            for p in arcs:
                if p["g"] in (a["g"], old):
                    t0, sw = sweep_on(E, p["pts"])
                    p.update({"E": list(E), "t0": t0, "sw": sw, "g": a["g"], "A": ell_xy(E, t0).tolist(), "B": ell_xy(E, t0 + sw).tolist()})


def _implicit(p, X):
    if p["type"] == "line":
        A, B = np.array(p["A"]), np.array(p["B"]); d = (B - A) / (np.hypot(*(B - A)) + 1e-9)
        return d[0] * (X[:, 1] - A[1]) - d[1] * (X[:, 0] - A[0])
    cx, cy, rx, ry, ph = p["E"]; c, s_ = np.cos(ph), np.sin(ph); dx, dy = X[:, 0] - cx, X[:, 1] - cy
    return ((dx * c + dy * s_) / rx) ** 2 + ((-dx * s_ + dy * c) / ry) ** 2 - 1.0


def _trace(p, q, reach):
    """Points along the whole shape near q: the extended line, or the full ellipse."""
    if p["type"] == "line":
        A, B = np.array(p["A"]), np.array(p["B"]); d = (B - A) / (np.hypot(*(B - A)) + 1e-9)
        t = (q - A) @ d + np.linspace(-reach, reach, 400)
        return A[None] + t[:, None] * d[None]
    return ell_xy(p["E"], np.linspace(0, 2 * np.pi, 1441))


def join_shapes(prims):
    """Corners are the points where neighbouring shapes really cross, as in a construction made of
    overlapping circles and lines. Where they do not cross nearby, the join stays a short step."""
    n = len(prims)
    for i in range(n):
        a, b = prims[i], prims[(i + 1) % n]
        q = (np.array(a["B"]) + np.array(b["A"])) / 2; lim = 2.0 * float(min(a["tau"][-1], b["tau"][0])) + 4.0
        X = _trace(a, q, 6 * lim); f = _implicit(b, X); k = np.nonzero(np.sign(f[:-1]) != np.sign(f[1:]))[0]
        C = q                                           # no crossing nearby (two nearly parallel strokes): meet half way
        if len(k):
            u = f[k] / (f[k] - f[k + 1] + 1e-12); Cs = X[k] + u[:, None] * (X[k + 1] - X[k])
            dist = np.hypot(*(Cs - q).T); j = int(np.argmin(dist))
            if dist[j] <= lim:
                C = Cs[j]
        a["B"] = np.asarray(C).tolist(); b["A"] = np.asarray(C).tolist()
    for p in prims:                                     # arcs follow their new end points
        if p["type"] == "earc":
            _, t = ell_project(tuple(p["E"]), np.array([p["A"], p["B"]]))
            sw = wrap(t[1] - t[0]); sgn = np.sign(p["sw"]) or 1.0
            if np.sign(sw) != sgn:
                sw += sgn * 2 * np.pi
            if abs(abs(sw) - abs(p["sw"])) > 1.2:        # wrapped the wrong way round a nearly closed arc
                sw = p["sw"]; t = [p["t0"]]
                p["A"] = ell_xy(p["E"], p["t0"]).tolist(); p["B"] = ell_xy(p["E"], p["t0"] + sw).tolist()
            p["t0"], p["sw"] = float(t[0]), float(sw)
            p["A"] = ell_xy(p["E"], p["t0"]).tolist(); p["B"] = ell_xy(p["E"], p["t0"] + p["sw"]).tolist()


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


def _same(a, b):
    return abs(a[0] - b[0]) < 0.05 and abs(a[1] - b[1]) < 0.05


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
            if k and not _same(prims[k - 1]["B"], p["A"]):
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


def build_guides(chains, W, full_r=400, min_line=12):
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
            if Ln < min_line:
                continue                                # a tiny chamfer is not a construction stroke
            d = (B - A) / Ln
            if d[0] < 0 or (abs(d[0]) < 1e-9 and d[1] < 0):
                d, A, B = -d, B, A
            for l in lines:
                offs = [abs(l["d"][0] * (X[1] - l["p"][1]) - l["d"][1] * (X[0] - l["p"][0])) for X in (A, B)]
                ts = [(X - l["p"]) @ l["d"] for X in (A, B)]
                gap = max(min(ts) - l["t1"], l["t0"] - max(ts), 0)
                if abs(d @ l["d"]) > 0.9985 and max(offs) < 3.5 and gap < 90:
                    l["t0"], l["t1"] = min(l["t0"], *ts), max(l["t1"], *ts); break
            else:
                lines.append({"p": A, "d": d, "t0": 0.0, "t1": float(Ln)})
    ovals = []
    for sh in shapes.values():
        cx, cy, rx, ry, ph = sh["E"]; m = sh["m"]
        if len(m) == 1 and m[0]["type"] == "earc" and (rx > full_r or (m[0].get("cut") and rx > 45)):   # drawn as a stroke, not a whole circle
            p = m[0]; sw = p["sw"]; ext = np.sign(sw) * min(0.25 * abs(sw) + 45 / rx, 0.6)
            t = np.linspace(p["t0"] - ext, p["t0"] + sw + ext, max(8, int(abs(sw + 2 * ext) * rx / 6)))
            pts = ell_xy(sh["E"], t)
            if pts[0, 0] > pts[-1, 0]:
                pts, sw = pts[::-1], -sw
            sweeps.append({"type": "path", "x1": float(pts[0, 0]), "y1": float(pts[0, 1]), "pts": np.round(pts, 1).tolist(),
                           "d": "M" + "L".join(f"{x:.1f},{y:.1f}" for x, y in pts), "E": [float(v) for v in sh["E"]]})
        elif abs(rx - ry) < 0.03 * rx:
            ovals.append({"type": "circle", "cx": cx, "cy": cy, "r": (rx + ry) / 2})
        else:
            ovals.append({"type": "ellipse", "cx": cx, "cy": cy, "rx": rx, "ry": ry, "rot": float(np.degrees(ph))})
    out_lines = []
    for l in lines:
        ext = 0.16 * (l["t1"] - l["t0"]) + 20            # strokes overshoot their corners a little, as drawn by hand
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


def envelope(logo, size):
    """The figure a mark occupies: the mark with its negative space filled in (gaps up to about
    7% of its size closed, holes filled)."""
    r = max(3, int(round(0.035 * size)))
    m = ndimage.binary_closing(np.pad(logo, r + 2), structure=disk(r))[r + 2:-(r + 2), r + 2:-(r + 2)]
    return ndimage.binary_fill_holes(m | logo)


def cut_list(logo, size):
    """Negative space of a mark: every white shape inside its envelope, with its share of the
    figure, its width, whether it is a band or a spot, and whether it is enclosed."""
    env = envelope(logo, size); cuts = env & ~logo
    lab, n = ndimage.label(cuts); out = []
    if not n:
        return env, out, lab
    areas = np.asarray(ndimage.sum(cuts, lab, range(1, n + 1))); dt = ndimage.distance_transform_edt(cuts)
    outside = ndimage.binary_dilation(~env, iterations=2); ey, ex = np.nonzero(env)
    for i in range(1, n + 1):
        if areas[i - 1] < max(10, 0.0006 * env.sum()):
            continue
        comp = lab == i; width = 2 * float(dt[comp].max()); ys, xs = np.nonzero(comp)
        out.append({"label": i, "area_share": float(areas[i - 1] / env.sum()), "width_rel": width / size,
                    "elongation": float(areas[i - 1] / max(width * width, 1.0)),
                    "enclosed": not bool((comp & outside).any()),
                    "cx_rel": float((xs.mean() - ex.min()) / size), "cy_rel": float((ys.mean() - ey.min()) / size)})
    return env, out, lab


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
    try:
        path = potrace.Bitmap(~mask).trace(turdsize=10, alphamax=0.9, opticurve=True, opttolerance=0.5)
    except ValueError:                                  # the tracer's curve optimiser fails on some crisp polygons
        path = potrace.Bitmap(~mask).trace(turdsize=10, alphamax=0.9, opticurve=False)
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
def fit_mask(mask, eps, share=True, shapes_first=False, delta=None, log=None, prm=None):
    """shapes_first: the big outline is built from body-mass ovals and straight strokes (the way
    the reference clips are built). Otherwise: free line/arc fit, optionally sharing shapes."""
    chains = []; prm = prm or PARAMS
    for P in outline_points(mask):
        big = len(P) * STEP > 260
        P = ndimage.gaussian_filter1d(P, prm["contour_sigma"] if (shapes_first is True and big) else 1.2, axis=0, mode="wrap")
        if shapes_first == "dp" and big:
            prims = dp_chain(ndimage.gaussian_filter1d(P, 0.4, axis=0, mode="wrap"), mask, eps, prm=prm, log=log)
        elif shapes_first is True and big:
            prims, _ = shapes_first_chain(P, mask, (delta or eps) * prm["oval_delta_mult"], prm["line_tau_mult"] * eps, log=log, prm=prm)
        elif shapes_first == "cut":
            E = fit_circle_free(P); d = ell_project(E, P)[0].max() if E else 1e9
            if E and d <= max(2.5, 0.12 * E[2]) and E[2] < 60:        # a round cut (an eye) is simply a circle
                gid = next(_GID)
                prims = [{"type": "earc", "E": list(E), "t0": t0, "sw": np.pi, "g": gid, "len": float(np.pi * E[2]),
                          "A": ell_xy(E, t0).tolist(), "B": ell_xy(E, t0 + np.pi).tolist(), "pts": P} for t0 in (0.0, np.pi)]
            else:                                                     # any other cut: a few strokes, straight or one arc each
                prims = fit_chain(P, eps, find_corners(P))
                for q in prims:
                    if q["type"] == "arc":
                        to_earc(q)["cut"] = True
        else:
            prims = fit_chain(P, eps if big else min(eps, 2.0), find_corners(P))   # eyes and small cuts stay crisp
        if len(prims) >= 2:
            chains.append(prims)
    if not shapes_first:
        if share:
            consolidate(chains, 1.3 * eps)
        else:
            return chains
    else:
        for c in chains:
            for p in c:
                if p["type"] == "arc":
                    to_earc(p)
    return chains


def upsample(mask, f):
    """The mask at f times the resolution with smooth edges, so that a fit is not limited by pixels."""
    from PIL import ImageFilter
    im = Image.fromarray((mask * 255).astype(np.uint8)).resize((mask.shape[1] * f, mask.shape[0] * f), Image.BICUBIC)
    return np.asarray(im.filter(ImageFilter.GaussianBlur(0.8 * f))) > 127


def scale_chains(chains, f):
    """Chains fitted at another resolution, brought back to canvas coordinates."""
    for c in chains:
        for p in c:
            for k in ("A", "B", "C", "Q"):
                if k in p:
                    p[k] = [float(v) * f for v in p[k]]
            for k in ("r", "s", "len", "err"):
                if k in p:
                    p[k] = float(p[k]) * f
            if "E" in p:
                p["E"] = [p["E"][0] * f, p["E"][1] * f, p["E"][2] * f, p["E"][3] * f, p["E"][4]]
            for k in ("pts", "tau"):
                if k in p:
                    p[k] = np.asarray(p[k]) * f
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
