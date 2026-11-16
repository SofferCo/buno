#!/usr/bin/env python3
"""Recover the designer's actual construction from each reference clip.

During the build phase every shape is drawn separately, so each stroke pixel of the finished
construction has a birth time: the frame from which it stays black. Pixels born together are
one shape. Each shape is then fitted as a straight line, a circle or an ellipse.

  constructions/<stem>.json   shapes in drawing order: type, geometry (in 720-wide frame
                              coordinates), time drawn
  constructions/<stem>.png    the fitted shapes drawn over the real frame, to check by eye

  python3 -I extract_constructions.py <dirs with mp4s> --phases dataset/reference_phases.json --out dataset/constructions
"""
import argparse, glob, json, os, subprocess, sys
import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import construct as K  # noqa: E402

FPS, AW = 10, 720


def read_gray(path, t0, t1, w, h):
    ah = int(round(h * AW / w)) // 2 * 2
    raw = subprocess.run(["ffmpeg", "-v", "error", "-ss", f"{t0:.3f}", "-t", f"{t1 - t0:.3f}", "-i", path,
                          "-vf", f"fps={FPS},scale={AW}:{ah}", "-f", "rawvideo", "-pix_fmt", "gray", "-"],
                         capture_output=True, check=True).stdout
    n = len(raw) // (AW * ah)
    return np.frombuffer(raw, np.uint8)[: n * AW * ah].reshape(n, ah, AW)


def probe(path):
    j = json.loads(subprocess.run(["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries",
                                   "stream=width,height:format=duration", "-of", "json", path],
                                  capture_output=True, text=True, check=True).stdout)
    return int(j["streams"][0]["width"]), int(j["streams"][0]["height"]), float(j["format"]["duration"])


def fit_shape(pts):
    """Line, circle or ellipse through a cloud of stroke pixels, or None. Strict: the pixels must
    cover the shape (a drawn line is continuous, a drawn oval goes all the way round), so that
    two unrelated fragments are never explained by one long line or one big oval."""
    if len(pts) < 8:
        return None
    c = pts.mean(0); u, sv, vt = np.linalg.svd(pts - c, full_matrices=False)
    d = vt[0]; proj = (pts - c) @ d; off = (pts - c) @ vt[1]
    length = proj.max() - proj.min()
    line_res = float(np.percentile(np.abs(off), 92))
    if line_res <= 2.3 and length >= 10:
        filled = len(np.unique(np.round(proj - proj.min()).astype(int))) / (length + 1)
        if filled >= 0.72:
            a, b = c + d * proj.min(), c + d * proj.max()
            return {"type": "line", "x1": float(a[0]), "y1": float(a[1]), "x2": float(b[0]), "y2": float(b[1])}, line_res
    if len(pts) < 30:
        return None
    sub = pts[:: max(1, len(pts) // 700)]; best = None
    for E, kind in ((K.fit_circle_free(sub), "circle"), (K.fit_ellipse(sub), "ellipse")):
        if E is None or E[3] < 3 or E[2] > 700 or E[2] / E[3] > 8:
            continue
        dist, t = K.ell_project(E, sub); res = float(np.percentile(dist, 92))
        cover = len(np.unique(np.round(t / (2 * np.pi) * 48).astype(int) % 48)) / 48
        if res <= 2.1 and cover >= 0.5 and (best is None or res < best[1] - 0.35):
            cx, cy, rx, ry, ph = E
            if kind == "circle" or abs(rx - ry) < 0.035 * rx:
                best = ({"type": "circle", "cx": cx, "cy": cy, "r": (rx + ry) / 2, "cover": round(cover, 2)}, res)
            else:
                best = ({"type": "ellipse", "cx": cx, "cy": cy, "rx": rx, "ry": ry,
                         "rot": float(np.degrees(ph)) % 180, "cover": round(cover, 2)}, res)
    return best


def explain_cluster(pts, rng):
    """Several shapes that appeared in the same instant (a mirrored copy, strokes crossing each
    other): peel them off one at a time, lines first, then whatever closed shapes remain."""
    out, pts = [], pts.copy()
    for _ in range(10):
        if len(pts) < 14:
            break
        best = None
        for _ in range(220):
            a, b = pts[rng.integers(len(pts), size=2)]
            L = np.hypot(*(b - a))
            if L < 12:
                continue
            d = (b - a) / L
            off = np.abs(d[0] * (pts[:, 1] - a[1]) - d[1] * (pts[:, 0] - a[0])); inl = off <= 1.7
            if inl.sum() < 14:
                continue
            pr = np.sort((pts[inl] - a) @ d); gaps = np.nonzero(np.diff(pr) > 5)[0]
            starts = np.concatenate([[0], gaps + 1]); ends = np.concatenate([gaps, [len(pr) - 1]])
            k = int(np.argmax(pr[ends] - pr[starts])); lo, hi = pr[starts[k]], pr[ends[k]]
            if hi - lo >= 14 and (best is None or hi - lo > best[0]):
                best = (hi - lo, a + d * lo, a + d * hi, d, a)
        if best is None:
            break
        _, A, B, d, a = best
        off = np.abs(d[0] * (pts[:, 1] - a[1]) - d[1] * (pts[:, 0] - a[0])); pr = (pts - a) @ d
        lo, hi = (A - a) @ d, (B - a) @ d
        take = (off <= 2.2) & (pr >= lo - 1) & (pr <= hi + 1)
        out.append(({"type": "line", "x1": float(A[0]), "y1": float(A[1]), "x2": float(B[0]), "y2": float(B[1])}, 1.7, int(take.sum())))
        pts = pts[~take]
    if len(pts) >= 30:                                   # what is left after the lines: closed shapes, one per blob
        x0, y0 = pts.min(0).astype(int) - 4; w_, h_ = (pts.max(0) - pts.min(0)).astype(int) + 9
        m = np.zeros((h_, w_), bool); m[(pts[:, 1] - y0).astype(int), (pts[:, 0] - x0).astype(int)] = True
        lab, k = ndimage.label(ndimage.binary_dilation(m, iterations=4))
        for c in range(1, k + 1):
            cy, cx = np.nonzero((lab == c) & m); q = np.stack([cx + x0, cy + y0], 1).astype(float)
            f = fit_shape(q)
            out.append((f[0], f[1], len(q)) if f else ({"type": "other"}, 0.0, len(q)))
    elif len(pts):
        out.append(({"type": "other"}, 0.0, len(pts)))
    return out


def merge_lines(shapes):
    """A stroke crossed by other strokes is recovered in pieces: join pieces that are collinear,
    nearly touching and drawn at the same moment back into the one stroke the designer drew."""
    lines = [s for s in shapes if s["type"] == "line"]; rest = [s for s in shapes if s["type"] != "line"]
    changed = True
    while changed:
        changed = False
        for i in range(len(lines)):
            for j in range(i + 1, len(lines)):
                a, b = lines[i], lines[j]
                if abs(a["t"] - b["t"]) > 0.45:
                    continue
                pa = np.array([[a["x1"], a["y1"]], [a["x2"], a["y2"]]]); pb = np.array([[b["x1"], b["y1"]], [b["x2"], b["y2"]]])
                da = pa[1] - pa[0]; La = np.hypot(*da); da /= La
                db = pb[1] - pb[0]; db /= np.hypot(*db)
                if abs(da @ db) < 0.9990:
                    continue
                off = np.abs(da[0] * (pb[:, 1] - pa[0, 1]) - da[1] * (pb[:, 0] - pa[0, 0]))
                if off.max() > 2.5:
                    continue
                tb = (pb - pa[0]) @ da; gap = max(tb.min() - La, 0 - tb.max(), 0)
                if gap > 18:
                    continue
                ts = np.concatenate([[0, La], tb]); A, B = pa[0] + da * ts.min(), pa[0] + da * ts.max()
                lines[i] = {**a, "x1": float(A[0]), "y1": float(A[1]), "x2": float(B[0]), "y2": float(B[1]),
                            "n": a["n"] + b["n"], "t": min(a["t"], b["t"])}
                del lines[j]; changed = True; break
            if changed:
                break
    return sorted(rest + lines, key=lambda s_: s_["t"])


def split_run(frames_pts):
    """A run of consecutive birth frames may hold several shapes drawn back to back. Find the split
    of the frames into the fewest intervals that are each one shape (dynamic programme)."""
    m = len(frames_pts); cache = {}

    def cost(a, b):
        if (a, b) not in cache:
            pts = np.vstack(frames_pts[a:b + 1])
            f = fit_shape(pts)
            cache[(a, b)] = (1.0 if f else 2.5 * (b - a + 1), f, pts)
        return cache[(a, b)]

    best = [(0.0, [])] + [None] * m
    for b in range(1, m + 1):
        cands = []
        for a in range(max(0, b - 9), b):
            c, f, pts = cost(a, b - 1)
            cands.append((best[a][0] + c, best[a][1] + [(f, pts)]))
        best[b] = min(cands, key=lambda t: t[0])
    return best[m][1]


def main():
    ap = argparse.ArgumentParser(); ap.add_argument("videos", nargs="+"); ap.add_argument("--phases", required=True)
    ap.add_argument("--out", required=True)
    a = ap.parse_args()
    files = []
    for v in a.videos:
        files += sorted(glob.glob(os.path.join(v, "*.mp4"))) if os.path.isdir(v) else [v]
    files.sort(key=os.path.basename)
    phases = {r["stem"]: r for r in json.load(open(a.phases))["clips"]}
    os.makedirs(a.out, exist_ok=True)
    for path in files:
        stem = os.path.splitext(os.path.basename(path))[0]; ph = phases[stem]
        w, h, dur = probe(path)
        full = read_gray(path, 0.0, dur, w, h)
        # the build ends at the first sudden large change of the frame (tool panel pops up, black
        # fill, card); while shapes are being drawn only a few pixels change per frame
        chg = np.array([(np.abs(full[k].astype(np.int16) - full[k - 1]) > 40).mean() for k in range(1, len(full))])
        big = np.nonzero((chg > 0.012) & (np.arange(len(chg)) > 5 * FPS))[0]
        i_end = int(big[0]) - 2 if len(big) else len(full) - 1
        if ph["construction_s"] >= 10:
            i_end = min(i_end, int(ph["construction_end"] * FPS))
        t_end = i_end / FPS
        fr = full[: i_end + 1]; del full
        n, H, W = fr.shape
        dark = min(80, max(40, int(np.percentile(fr[0], 0.5)) - 18))  # strokes are darker than the faded photo
        stroke = fr < dark
        final = stroke[-4:].sum(0) >= 3
        final &= ~stroke[0]                                            # dark parts of the photo itself
        thick = ndimage.binary_opening(final, structure=np.ones((5, 5), bool))   # cursor and other filled blobs
        final &= ~ndimage.binary_dilation(thick, iterations=4)
        alive = final.copy(); birth = np.full((H, W), n - 1, np.int32)
        for i in range(n - 1, -1, -1):
            alive &= stroke[i] | (i >= n - 4)                           # final = present in 3 of the last 4 frames
            birth[alive] = i
        ys, xs = np.nonzero(final); b = birth[ys, xs]
        counts = np.bincount(b, minlength=n)
        shapes, i = [], 1; rng = np.random.default_rng(0)
        while i < n:                                                    # runs of consecutive birth frames
            if counts[i] < 5:
                i += 1; continue
            j = i
            while j + 1 < n and counts[j + 1] >= 5:
                j += 1
            fp = [np.stack([xs[b == f], ys[b == f]], 1).astype(float) for f in range(i, j + 1)]
            for fit, pts in split_run(fp):
                if fit is None and len(pts) > 30:                       # still several things at once: peel them apart
                    m = np.zeros((H, W), bool); m[pts[:, 1].astype(int), pts[:, 0].astype(int)] = True
                    lab, k = ndimage.label(ndimage.binary_dilation(m, iterations=3))
                    for c in range(1, k + 1):
                        cy, cx = np.nonzero((lab == c) & m); q = np.stack([cx, cy], 1).astype(float)
                        f2 = fit_shape(q)
                        parts = [(f2[0], f2[1], len(q))] if f2 else explain_cluster(q, rng)
                        for g, res, cnt in parts:
                            shapes.append({**g, "res": round(res, 2), "t": round(i / FPS, 2), "n": cnt})
                    continue
                shapes.append(({**fit[0], "res": round(fit[1], 2)} if fit else {"type": "other"}) | {"t": round(i / FPS, 2), "n": len(pts)})
            i = j + 1
        shapes = merge_lines([s for s in shapes if s["type"] != "other" or s["n"] >= 25])
        kinds = {}
        for s_ in shapes:
            kinds[s_["type"]] = kinds.get(s_["type"], 0) + 1
        explained = sum(s_["n"] for s_ in shapes if s_["type"] != "other") / max(1, final.sum())
        json.dump({"stem": stem, "frame": [W, H], "t_end": round(t_end, 2), "shapes": shapes, "explained": round(explained, 3)},
                  open(os.path.join(a.out, stem + ".json"), "w"))
        # check image: real frame, fitted shapes in colour
        im = Image.fromarray(fr[-1]).convert("RGB"); d = ImageDraw.Draw(im)
        for s_ in shapes:
            if s_["type"] == "line":
                d.line([s_["x1"], s_["y1"], s_["x2"], s_["y2"]], fill=(230, 40, 40), width=2)
            elif s_["type"] == "circle":
                d.ellipse([s_["cx"] - s_["r"], s_["cy"] - s_["r"], s_["cx"] + s_["r"], s_["cy"] + s_["r"]], outline=(30, 120, 240), width=2)
            elif s_["type"] == "ellipse":
                q = K.ell_xy((s_["cx"], s_["cy"], s_["rx"], s_["ry"], np.radians(s_["rot"])), np.linspace(0, 2 * np.pi, 200))
                d.line([tuple(p) for p in q], fill=(20, 170, 60), width=2)
        im.save(os.path.join(a.out, stem + ".png"))
        print(f"{stem:26s} {len(shapes):3d} shapes {kinds}  strokes explained {explained:.0%}")


if __name__ == "__main__":
    main()
