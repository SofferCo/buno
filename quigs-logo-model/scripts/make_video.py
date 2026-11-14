#!/usr/bin/env python3
"""Logo process video, 9:16, in the format of the reference clips:

  photo -> construction circles and lines drawn one by one -> red outline trace
        -> black fill -> guides off -> white card -> branded colour card.

  python3 make_video.py --photo bg.png --logo logo.png --animal-mask cutout.png \
      --name "Maneo" --bg "#2b1a10" --fg "#f0b24a" -o lion.mp4

  --photo        any image; cover-fitted to 1080x1920 (outpaint it to 9:16 first)
  --logo         clean black-on-white mark (output of photo_to_logo.py / logo_post.finalize)
  --placed       --logo is already a 1080x1920 mask sitting on the animal (silhouette_logo.py);
                 this is the mode where the outline follows the real animal exactly
  --animal-mask  RGBA cutout or mask of the animal, same framing as --photo; the logo is
                 scaled and moved onto the animal by maximising overlap. Without it the
                 logo is centred at 45% height.

The construction geometry is derived from the mark itself: largest inscribed circles for the
body masses, extended lines along its straight edges, circles fitted to its curved edges.
Frames are rendered from video/template.html by scripts/render_video.cjs (Playwright + ffmpeg).
"""
import argparse, json, os, subprocess, sys
import numpy as np
from PIL import Image
from scipy import ndimage, signal
import potrace

W, H, FPS = 1080, 1920, 30
HERE = os.path.dirname(os.path.abspath(__file__))


def cover(im, resample=Image.LANCZOS):
    s = max(W / im.width, H / im.height)
    nw, nh = round(im.width * s), round(im.height * s)
    im = im.resize((nw, nh), resample)
    l, t = (nw - W) // 2, (nh - H) // 2
    return im.crop((l, t, l + W, t + H))


def bbox(m):
    ys, xs = np.nonzero(m)
    return xs.min(), ys.min(), xs.max() + 1, ys.max() + 1


def place_logo(logo, animal):
    """Scale + translate the logo crop onto the animal mask (max IoU). Returns canvas mask."""
    lh, lw = logo.shape
    if animal is None:
        s = 0.72 * W / lw
        best = (0, s, (W - lw * s) / 2, 0.45 * H - lh * s / 2)
    else:
        ax0, ay0, ax1, ay1 = bbox(animal)
        s0 = 0.5 * ((ax1 - ax0) / lw + (ay1 - ay0) / lh)
        A = animal[::4, ::4].astype(np.float32)
        best = (-1, s0, ax0, ay0)
        for s in s0 * np.arange(0.75, 1.26, 0.025):
            sw, sh = max(4, round(lw * s / 4)), max(4, round(lh * s / 4))
            if sw >= A.shape[1] or sh >= A.shape[0]:
                continue
            L = (np.asarray(Image.fromarray((logo * 255).astype(np.uint8)).resize((sw, sh), Image.BILINEAR)) > 127).astype(np.float32)
            inter = signal.fftconvolve(A, L[::-1, ::-1], mode="valid")
            iou = inter / (A.sum() + L.sum() - inter + 1e-6)
            k = np.unravel_index(np.argmax(iou), iou.shape)
            if iou[k] > best[0]:
                best = (float(iou[k]), s, k[1] * 4, k[0] * 4)
    iou, s, tx, ty = best
    sw, sh = round(lw * s), round(lh * s)
    L = np.asarray(Image.fromarray((logo * 255).astype(np.uint8)).resize((sw, sh), Image.LANCZOS)) > 127
    canvas = np.zeros((H, W), bool)
    tx, ty = int(round(tx)), int(round(ty))
    x0, y0 = max(0, tx), max(0, ty)
    x1, y1 = min(W, tx + sw), min(H, ty + sh)
    canvas[y0:y1, x0:x1] = L[y0 - ty:y1 - ty, x0 - tx:x1 - tx]
    return canvas, iou


def trace(mask):
    """potrace -> list of (svg d string, dense closed polyline Nx2)."""
    path = potrace.Bitmap(~mask).trace(turdsize=8, alphamax=1.0, opticurve=True, opttolerance=0.4)
    out = []
    for curve in path:
        p = curve.start_point
        d = [f"M{p.x:.1f},{p.y:.1f}"]
        pts = [(p.x, p.y)]
        for seg in curve:
            e = seg.end_point
            if seg.is_corner:
                d.append(f"L{seg.c.x:.1f},{seg.c.y:.1f}L{e.x:.1f},{e.y:.1f}")
                pts += [(seg.c.x, seg.c.y), (e.x, e.y)]
            else:
                d.append(f"C{seg.c1.x:.1f},{seg.c1.y:.1f} {seg.c2.x:.1f},{seg.c2.y:.1f} {e.x:.1f},{e.y:.1f}")
                p0 = np.array(pts[-1]); c1 = np.array([seg.c1.x, seg.c1.y]); c2 = np.array([seg.c2.x, seg.c2.y]); p3 = np.array([e.x, e.y])
                for u in np.linspace(0, 1, 14)[1:]:
                    q = (1 - u) ** 3 * p0 + 3 * (1 - u) ** 2 * u * c1 + 3 * (1 - u) * u ** 2 * c2 + u ** 3 * p3
                    pts.append((q[0], q[1]))
        d.append("Z")
        out.append(("".join(d), resample(np.array(pts), 2.0)))
    out.sort(key=lambda t: -len(t[1]))
    return out


def resample(pts, step):
    pts = np.vstack([pts, pts[:1]])
    seg = np.hypot(*np.diff(pts, axis=0).T)
    keep = np.concatenate([[True], seg > 1e-6])
    pts = pts[keep]; seg = np.hypot(*np.diff(pts, axis=0).T)
    s = np.concatenate([[0], np.cumsum(seg)])
    u = np.arange(0, s[-1], step)
    return np.stack([np.interp(u, s, pts[:, 0]), np.interp(u, s, pts[:, 1])], 1)


def douglas_peucker(P, eps):
    n = len(P); keep = np.zeros(n, bool); keep[[0, n - 1]] = True
    stack = [(0, n - 1)]
    while stack:
        a, b = stack.pop()
        if b <= a + 1:
            continue
        p, d = P[a], P[b] - P[a]
        L = np.hypot(*d); seg = P[a + 1:b]
        dist = np.hypot(*(seg - p).T) if L < 1e-9 else np.abs(d[0] * (seg[:, 1] - p[1]) - d[1] * (seg[:, 0] - p[0])) / L
        i = int(np.argmax(dist))
        if dist[i] > eps:
            k = a + 1 + i; keep[k] = True; stack += [(a, k), (k, b)]
    return np.nonzero(keep)[0]


def inscribed_circles(mask, n=5):
    dt = ndimage.distance_transform_edt(mask)
    work = dt.copy(); yy, xx = np.mgrid[0:H, 0:W]; out = []
    for _ in range(n):
        k = np.unravel_index(np.argmax(work), work.shape); r = float(dt[k])
        if r < 16 or (out and r < 0.28 * out[0]["r"]):
            break
        out.append({"type": "circle", "cx": float(k[1]), "cy": float(k[0]), "r": r})
        work[(xx - k[1]) ** 2 + (yy - k[0]) ** 2 < (1.3 * r) ** 2] = 0
    return out


def edge_lines(contours, n=7, min_len=80):
    cand = []
    for _, P in contours:
        if len(P) < 30:
            continue
        c = P.mean(0); start = int(np.argmax(np.hypot(*(P - c).T)))
        Q = np.vstack([np.roll(P, -start, axis=0), P[start:start + 1]])
        idx = douglas_peucker(Q, 2.5)
        for a, b in zip(idx[:-1], idx[1:]):
            p, q = Q[a], Q[b]; L = np.hypot(*(q - p))
            if L < min_len:
                continue
            d = (q - p) / L; seg = Q[a:b + 1]
            dev = np.abs(d[0] * (seg[:, 1] - p[1]) - d[1] * (seg[:, 0] - p[0])).max()
            if dev < 1.6:
                cand.append((L, p, q, d))
    cand.sort(key=lambda t: -t[0]); out = []
    for L, p, q, d in cand:
        dup = False
        for o in out:
            od = np.array([o["x2"] - o["x1"], o["y2"] - o["y1"]]); od /= np.hypot(*od)
            mid = (p + q) / 2
            off = abs(od[0] * (mid[1] - o["y1"]) - od[1] * (mid[0] - o["x1"]))
            if abs(d @ od) > 0.985 and off < 14:
                dup = True; break
        if dup:
            continue
        ext = 0.3 * L + 28
        a, b = p - d * ext, q + d * ext
        if a[0] > b[0]:
            a, b = b, a
        out.append({"type": "line", "x1": float(a[0]), "y1": float(a[1]), "x2": float(b[0]), "y2": float(b[1])})
        if len(out) == n:
            break
    out.sort(key=lambda o: o["x1"])
    return out


def fit_circle(P):
    A = np.c_[P, np.ones(len(P))]; b = -(P ** 2).sum(1)
    (a, bb, c), *_ = np.linalg.lstsq(A, b, rcond=None)
    cx, cy = -a / 2, -bb / 2; r2 = cx * cx + cy * cy - c
    if r2 <= 0:
        return None
    r = np.sqrt(r2); rms = np.sqrt(((np.hypot(P[:, 0] - cx, P[:, 1] - cy) - r) ** 2).mean())
    return cx, cy, r, rms


def arc_circles(contours, existing, n=6):
    allp = np.vstack([P for _, P in contours])
    bx0, by0, bx1, by1 = allp[:, 0].min(), allp[:, 1].min(), allp[:, 0].max(), allp[:, 1].max()
    mx, my = 0.08 * (bx1 - bx0), 0.08 * (by1 - by0)    # circle centres stay on the mark, not floating beside it
    cand = []
    for _, P in contours:
        m = len(P)
        for win in (50, 90, 150):                       # points at 2px spacing -> 100/180/300 px of outline
            if m < win * 1.2:
                continue
            for s in range(0, m, 8):
                seg = P[np.arange(s, s + win) % m]
                f = fit_circle(seg)
                if not f:
                    continue
                cx, cy, r, rms = f
                span = 2 * win / r
                if 20 < r < 0.33 * W and rms < 1.4 and span > 1.0 and bx0 - mx < cx < bx1 + mx and by0 - my < cy < by1 + my:
                    cand.append((min(span, 6.283) * r / (1 + rms), cx, cy, r))
    cand.sort(key=lambda t: -t[0]); out = []
    for _, cx, cy, r in cand:
        if any(np.hypot(cx - o["cx"], cy - o["cy"]) < 0.4 * max(r, o["r"]) and abs(r - o["r"]) < 0.35 * max(r, o["r"])
               for o in existing + out):
            continue
        out.append({"type": "circle", "cx": float(cx), "cy": float(cy), "r": float(r)})
        if len(out) == n:
            break
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--photo", required=True)
    ap.add_argument("--logo", required=True)
    ap.add_argument("--animal-mask")
    ap.add_argument("--placed", action="store_true",
                    help="--logo is already a 1080x1920 canvas mask in photo coordinates (silhouette_logo.py output)")
    ap.add_argument("--name", default="")
    ap.add_argument("--bg", default="#2b1a10")
    ap.add_argument("--fg", default="#f0b24a")
    ap.add_argument("-o", "--out", default="logo_video.mp4")
    ap.add_argument("--still", type=float, action="append", help="also save a PNG of the frame at this time (s)")
    a = ap.parse_args()

    work = os.path.splitext(os.path.abspath(a.out))[0] + "_work"
    os.makedirs(work, exist_ok=True)
    bg_path = os.path.join(work, "bg.jpg")
    cover(Image.open(a.photo).convert("RGB")).save(bg_path, quality=95)

    lm = np.asarray(Image.open(a.logo).convert("L")) < 128
    if not a.placed:
        x0, y0, x1, y1 = bbox(lm); lm = lm[y0:y1, x0:x1]
    animal = None
    if a.animal_mask and not a.placed:
        am = Image.open(a.animal_mask)
        am = am.getchannel("A") if am.mode in ("RGBA", "LA") else am.convert("L")
        animal = np.asarray(cover(am, Image.BILINEAR)) > 127
        lab, n = ndimage.label(animal)                  # keep the main subject only
        if n > 1:
            animal = lab == (1 + int(np.argmax(ndimage.sum(animal, lab, range(1, n + 1)))))
    mask, iou = (lm, 1.0) if a.placed else place_logo(lm, animal)
    contours = [c for c in trace(mask) if len(c[1]) > 20]

    big = inscribed_circles(mask)
    lines = edge_lines(contours)
    arcs = arc_circles(contours, big)
    prims = big + lines + arcs

    # ---- timeline (seconds)
    t = 1.25
    for p in prims:
        p["t0"], p["t1"], p["t2"] = round(t, 3), round(t + 0.18, 3), round(t + 0.48, 3)
        t += 0.5
    trace_start = t + 0.3
    lens = np.array([len(c[1]) for c in contours], float)
    durs = np.maximum(0.22, 3.4 * lens / lens.sum())
    paths, tt = [], trace_start
    for (d, _), du in zip(contours, durs):
        paths.append({"d": d, "ta": round(tt, 3), "tb": round(tt + du, 3)}); tt += du + 0.05
    fill = tt + 0.2
    guides_off = fill + 1.1
    card_white = guides_off + 1.2
    card_color = card_white + 1.1
    end = card_color + 3.0
    bx0, by0, bx1, by1 = bbox(mask)
    scene = {"W": W, "H": H, "fps": FPS, "duration": round(end, 3), "bg": "file://" + bg_path,
             "wash": 0.4, "prims": prims, "paths": paths, "fillD": " ".join(c[0] for c in contours),
             "t": {"washStart": 0.7, "washEnd": 1.1, "traceStart": round(trace_start, 3), "fill": round(fill, 3),
                   "guidesOff": round(guides_off, 3), "cardWhite": round(card_white, 3), "cardColor": round(card_color, 3)},
             "card": {"bg": a.bg, "fg": a.fg, "name": a.name},
             "logoBBox": [int(bx0), int(by0), int(bx1), int(by1)]}
    scene_path = os.path.join(work, "scene.json")
    json.dump(scene, open(scene_path, "w"))
    print(f"placement IoU {iou:.2f} | {len(big)} body circles, {len(lines)} lines, {len(arcs)} arc circles, "
          f"{len(paths)} contours | {end:.1f}s")
    cmd = ["node", os.path.join(HERE, "render_video.cjs"), scene_path, os.path.abspath(a.out)]
    for s in a.still or []:
        cmd += ["--still", str(s)]
    subprocess.run(cmd, check=True)
    print("wrote", a.out)


if __name__ == "__main__":
    main()
