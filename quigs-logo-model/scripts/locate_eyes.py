#!/usr/bin/env python3
"""Where the animal's eyes are in the photo, so that the logo's eye can sit exactly on them.

An image model is asked to reproduce the photo with a magenta dot on every visible eye
(prompt below). Its copy is never pixel-exact, so the dots are only a first estimate: the copy
is registered to the photo, and each eye is then snapped to the dark blob of the real eye in the
photo itself.

  prompt: "Reproduce image 1 exactly: same framing, same size, same position, nothing moved and
           nothing else changed. The only difference: paint each visible eye of the animal
           solid flat pure magenta (#FF00FF), covering exactly the whole visible eye opening
           between the eyelids, pointed corners included, and following its exact outline and
           shape. Nothing outside the eye is painted."

  python3 locate_eyes.py --photo bg.png --cutout cutout.png --annotated marked.png --out work/eyes.json
"""
import argparse, json
import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage


def shift_between(a, b):
    """Translation that maps image a onto image b (phase correlation)."""
    fa, fb = np.fft.fft2(a - a.mean()), np.fft.fft2(b - b.mean())
    r = fa * np.conj(fb); r /= np.abs(r) + 1e-9
    c = np.abs(np.fft.ifft2(r)); y, x = np.unravel_index(np.argmax(c), c.shape)
    h, w = a.shape
    return (x if x <= w // 2 else x - w), (y if y <= h // 2 else y - h)


def main():
    ap = argparse.ArgumentParser(); ap.add_argument("--photo", required=True); ap.add_argument("--cutout", required=True)
    ap.add_argument("--annotated", required=True); ap.add_argument("--out", required=True); ap.add_argument("--check")
    a = ap.parse_args()
    P = Image.open(a.photo).convert("RGB"); W, H = P.size
    A = np.asarray(Image.open(a.annotated).convert("RGB").resize((W, H), Image.LANCZOS)).astype(int)
    animal = np.asarray(Image.open(a.cutout).convert("RGBA").resize((W, H)))[..., 3] > 128
    ys, xs = np.nonzero(animal); size = max(np.ptp(xs), np.ptp(ys))
    R, G, B = A[..., 0], A[..., 1], A[..., 2]
    mag = (R > 165) & (B > 165) & (G < 125) & (R - G > 75) & (B - G > 75)
    # register the copy to the photo around the animal
    x0, x1, y0, y1 = max(0, xs.min() - 40), min(W, xs.max() + 40), max(0, ys.min() - 40), min(H, ys.max() + 40)
    gp = np.asarray(P.convert("L")).astype(float)[y0:y1, x0:x1]; ga = A.mean(-1)[y0:y1, x0:x1]
    ga = np.where(mag[y0:y1, x0:x1], gp, ga)
    dx, dy = shift_between(ga, gp)
    if max(abs(dx), abs(dy)) > 0.08 * size:             # an implausible jump: do not trust the registration
        dx = dy = 0
    lab, n = ndimage.label(ndimage.binary_opening(mag, iterations=1)); eyes = []
    gray = ndimage.gaussian_filter(np.asarray(P.convert("L")).astype(float), 1.2)
    for k in range(1, n + 1):
        comp = lab == k; area = comp.sum()
        if area < 12:
            continue
        cy, cx = ndimage.center_of_mass(comp); x, y, r = cx - dx, cy - dy, float(np.sqrt(area / np.pi))
        py_, px_ = np.nonzero(comp); cov = np.cov(np.stack([px_ - cx, py_ - cy]))      # the eye's own shape: its ellipse
        lam, vec = np.linalg.eigh(cov); ry_, rx_ = 2 * np.sqrt(np.maximum(lam, 1e-6)); rot = float(np.degrees(np.arctan2(vec[1, 1], vec[0, 1])))
        if not animal[int(np.clip(y, 0, H - 1)), int(np.clip(x, 0, W - 1))]:
            continue
        # snap to the real eye: the darkest compact blob next to the estimate
        w = int(max(1.3 * r, 0.012 * size)); xa, xb, ya, yb = int(x) - w, int(x) + w + 1, int(y) - w, int(y) + w + 1
        win = gray[max(0, ya):yb, max(0, xa):xb]; moved = 0.0
        if win.size:
            dark = win <= np.percentile(win, 14); l2, m = ndimage.label(dark); best = None
            for j in range(1, m + 1):
                c = l2 == j
                if c.sum() < 6:
                    continue
                py, px = ndimage.center_of_mass(c); d = np.hypot(px + max(0, xa) - x, py + max(0, ya) - y)
                if best is None or d < best[0]:
                    best = (d, px + max(0, xa), py + max(0, ya))
            if best and best[0] <= 0.5 * r + 2 and r <= 0.02 * size:    # a small eye: trust the photo; a large one: trust its painted shape
                moved = float(best[0]); x, y = best[1], best[2]
        eyes.append({"x": float(x), "y": float(y), "r": r, "rx": float(rx_), "ry": float(ry_), "rot": rot, "snapped_px": round(moved, 1)})
    eyes.sort(key=lambda e: -e["r"]); kept = []            # a dot inside or beside a larger one (an ocellus, a highlight) is not a second eye
    for e in eyes:
        if all(np.hypot(e["x"] - k["x"], e["y"] - k["y"]) > 1.8 * k["r"] for k in kept):
            kept.append(e)
    eyes = kept
    json.dump({"eyes": eyes, "registration_shift_px": [int(dx), int(dy)], "animal_size_px": int(size)}, open(a.out, "w"), indent=1)
    print(f"{len(eyes)} eye(s); the model's copy was off by ({dx},{dy})px;",
          ", ".join(f"({e['x']:.0f},{e['y']:.0f}) {e['rx']:.0f}x{e['ry']:.0f}px at {e['rot']:.0f} deg, snapped {e['snapped_px']}px" for e in eyes))
    if a.check and eyes:
        e = eyes[0]; s = int(0.22 * size); box = (int(e["x"]) - s, int(e["y"]) - s, int(e["x"]) + s, int(e["y"]) + s)
        im = P.copy(); d = ImageDraw.Draw(im)
        for e in eyes:
            t = np.linspace(0, 2 * np.pi, 80); c_, s_ = np.cos(np.radians(e["rot"])), np.sin(np.radians(e["rot"]))
            d.line([(e["x"] + e["rx"] * np.cos(u) * c_ - e["ry"] * np.sin(u) * s_, e["y"] + e["rx"] * np.cos(u) * s_ + e["ry"] * np.sin(u) * c_) for u in t], fill=(255, 0, 255), width=2)
            d.line([e["x"] - 2 * e["r"], e["y"], e["x"] + 2 * e["r"], e["y"]], fill=(255, 0, 255)); d.line([e["x"], e["y"] - 2 * e["r"], e["x"], e["y"] + 2 * e["r"]], fill=(255, 0, 255))
        im.crop(box).resize((420, 420), Image.LANCZOS).save(a.check)


if __name__ == "__main__":
    main()
