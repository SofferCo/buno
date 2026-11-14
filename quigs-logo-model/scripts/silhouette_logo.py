#!/usr/bin/env python3
"""Photo-anchored logo: the outline comes from the animal's real silhouette, the model only adds cuts.

  prepare  cutout (same framing as the 9:16 photo) -> simplified exact silhouette on the
           1080x1920 canvas + a square crop of it and of the photo to send to the image model
  combine  model output (silhouette with negative-space cuts) -> final canvas mask:
           outline = simplified real silhouette, cuts = what the model carved out of it

  python3 silhouette_logo.py prepare --photo bg.png --cutout cutout.png --out work/
  python3 silhouette_logo.py combine --work work/ --model-output gen.png
  -> work/logo_canvas.png (1080x1920, feed to make_video.py --placed) and work/logo.png / logo.svg
"""
import argparse, json, os, sys
import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from make_video import W, H, cover, bbox, trace, douglas_peucker, place_logo  # noqa: E402
from extract_dataset import to_svg  # noqa: E402
from logo_post import raster_to_mask, mask_to_square  # noqa: E402


def disk(r):
    y, x = np.mgrid[-r:r + 1, -r:r + 1]
    return x * x + y * y <= r * r


def simplify(mask, eps=4.0, close_r=6, open_r=3):
    """Real cutout -> blunt, angular silhouette that still follows the animal."""
    m = ndimage.binary_closing(np.pad(mask, 20), structure=disk(close_r))[20:-20, 20:-20]
    m = ndimage.binary_opening(m, structure=disk(open_r)) | ndimage.binary_erosion(mask, structure=disk(1))
    lab, n = ndimage.label(m)
    if n > 1:
        m = lab == (1 + int(np.argmax(ndimage.sum(m, lab, range(1, n + 1)))))
    S = 3                                             # supersample the polygon raster
    img = Image.new("L", (W * S, H * S), 0); d = ImageDraw.Draw(img)
    contours = trace(m)
    areas = []
    for _, P in contours:
        c = P.mean(0); start = int(np.argmax(np.hypot(*(P - c).T)))
        Q = np.vstack([np.roll(P, -start, axis=0), P[start:start + 1]])
        poly = Q[douglas_peucker(Q, eps)][:-1]
        x, y = poly[:, 0], poly[:, 1]
        areas.append((abs(np.dot(x, np.roll(y, 1)) - np.dot(y, np.roll(x, 1))) / 2, poly))
    areas.sort(key=lambda t: -t[0])
    for i, (area, poly) in enumerate(areas):
        if len(poly) < 3 or (i > 0 and area < 150):   # tiny holes are fur noise
            continue
        d.polygon([(float(px) * S, float(py) * S) for px, py in poly], fill=255 if i == 0 else 0)
    return np.asarray(img.resize((W, H), Image.LANCZOS)) > 127


def square_box(mask, pad=0.12):
    x0, y0, x1, y1 = bbox(mask)
    side = int(max(x1 - x0, y1 - y0) * (1 + 2 * pad))
    cx, cy = (x0 + x1) // 2, (y0 + y1) // 2
    return [cx - side // 2, cy - side // 2, cx - side // 2 + side, cy - side // 2 + side]


def crop_pad(im, box, fill):
    out = Image.new(im.mode, (box[2] - box[0], box[3] - box[1]), fill)
    out.paste(im, (-box[0], -box[1]))
    return out


def prepare(a):
    os.makedirs(a.out, exist_ok=True)
    am = Image.open(a.cutout)
    am = am.getchannel("A") if am.mode in ("RGBA", "LA") else am.convert("L")
    animal = np.asarray(cover(am, Image.BILINEAR)) > 127
    lab, n = ndimage.label(animal)
    if n > 1:
        animal = lab == (1 + int(np.argmax(ndimage.sum(animal, lab, range(1, n + 1)))))
    sil = simplify(animal, a.eps)
    box = square_box(sil)
    Image.fromarray(np.where(sil, 0, 255).astype(np.uint8)).save(os.path.join(a.out, "silhouette_canvas.png"))
    crop_pad(Image.fromarray(np.where(sil, 0, 255).astype(np.uint8)), box, 255).resize((1024, 1024), Image.LANCZOS) \
        .convert("RGB").save(os.path.join(a.out, "silhouette_sq.png"))
    crop_pad(cover(Image.open(a.photo).convert("RGB")), box, (255, 255, 255)).resize((1024, 1024), Image.LANCZOS) \
        .save(os.path.join(a.out, "photo_sq.jpg"), quality=92)
    json.dump({"box": [int(v) for v in box]}, open(os.path.join(a.out, "prepare.json"), "w"))
    iou = (sil & animal).sum() / (sil | animal).sum()
    print(f"silhouette vs cutout IoU {iou:.3f}; square crop {box}")


def combine(a):
    sil = np.asarray(Image.open(os.path.join(a.work, "silhouette_canvas.png")).convert("L")) < 128
    gen = raster_to_mask(Image.open(a.model_output))
    x0, y0, x1, y1 = bbox(gen)
    placed, iou = place_logo(gen[y0:y1, x0:x1], sil)   # snap the model's drawing back onto the silhouette
    depth = ndimage.distance_transform_edt(sil)
    cand = ndimage.binary_opening(sil & ~placed, structure=disk(3))
    lab, n = ndimage.label(cand)
    cuts = np.zeros_like(sil)
    kept = 0
    for i in range(1, n + 1):
        comp = lab == i
        # a real cut sits inside the body; where the model merely redrew the outline (legs,
        # paws) the difference hugs the silhouette edge, so its mean depth is small
        d = depth[comp]
        if comp.sum() >= 60 and d.mean() >= a.min_depth and (d < 5).mean() < 0.3:
            cuts |= comp; kept += 1
    final = sil & ~cuts
    lab, n = ndimage.label(final)                      # drop crumbs the cuts detached
    if n > 1:
        sizes = np.asarray(ndimage.sum(final, lab, range(1, n + 1)))
        final = np.isin(lab, 1 + np.nonzero(sizes >= 0.004 * sizes.sum())[0])
    Image.fromarray(np.where(final, 0, 255).astype(np.uint8)).save(os.path.join(a.work, "logo_canvas.png"))
    sq = mask_to_square(final, 1024)
    Image.fromarray(np.where(sq, 0, 255).astype(np.uint8)).convert("RGB").save(os.path.join(a.work, "logo.png"))
    to_svg(sq, os.path.join(a.work, "logo.svg"), 1024)
    print(f"model drawing vs silhouette IoU {iou:.2f}; kept {kept} cuts; outline stays on the real silhouette")


if __name__ == "__main__":
    ap = argparse.ArgumentParser(); sub = ap.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("prepare"); p.add_argument("--photo", required=True); p.add_argument("--cutout", required=True)
    p.add_argument("--out", required=True); p.add_argument("--eps", type=float, default=4.0); p.set_defaults(f=prepare)
    c = sub.add_parser("combine"); c.add_argument("--work", required=True); c.add_argument("--model-output", required=True)
    c.add_argument("--min-depth", type=float, default=15.0, help="mean distance (px) of a cut from the outline"); c.set_defaults(f=combine)
    a = ap.parse_args(); a.f(a)
