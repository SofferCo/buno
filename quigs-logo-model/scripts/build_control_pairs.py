#!/usr/bin/env python3
"""Build aligned (photo -> logo) pairs for training an image-to-image model (FLUX Kontext LoRA).

The silhouette in the *overlay* frame sits exactly where the animal is in the photo, so its
bounding box (plus the same padding used for logos/) crops the first frame of the video into a
control image that lines up with dataset/logos/<stem>.png.

  python3 build_control_pairs.py --frames <extract output with photo/ overlay/> --dataset dataset

Writes dataset/control/<stem>.png (1024x1024 photo crop) and dataset/preview/pairs_sheet.jpg.
"""
import argparse, json, os, sys
import numpy as np
from PIL import Image, ImageDraw

sys.path.insert(0, os.path.dirname(__file__))
from extract_dataset import clean_mask  # noqa: E402

ap = argparse.ArgumentParser()
ap.add_argument("--frames", required=True, help="folder holding photo/ and overlay/ full-res frames")
ap.add_argument("--dataset", default="dataset")
ap.add_argument("--size", type=int, default=1024)
ap.add_argument("--pad", type=float, default=0.12)
a = ap.parse_args()

manifest = json.load(open(os.path.join(a.dataset, "manifest.json")))
out = os.path.join(a.dataset, "control"); os.makedirs(out, exist_ok=True)
rows = []
for m in manifest:
    stem = m["stem"]
    ov = np.asarray(Image.open(os.path.join(a.frames, "overlay", stem + ".png")).convert("RGB")).astype(np.int32)
    dark = (ov.max(-1) < 45)                                   # the black silhouette (photo is faded)
    mask = clean_mask(dark)
    ys, xs = np.nonzero(mask)
    if ys.size == 0:
        print("!! no silhouette in overlay for", stem); continue
    y0, y1, x0, x1 = ys.min(), ys.max() + 1, xs.min(), xs.max() + 1
    ch, cw = y1 - y0, x1 - x0
    side = int(max(ch, cw) * (1 + 2 * a.pad))
    cy, cx = (y0 + y1) // 2, (x0 + x1) // 2
    photo = Image.open(os.path.join(a.frames, "photo", stem + ".png")).convert("RGB")
    # pad the photo so the square crop never leaves the frame
    P = side
    padded = Image.new("RGB", (photo.width + 2 * P, photo.height + 2 * P), (128, 128, 128))
    padded.paste(photo, (P, P))
    box = (cx - side // 2 + P, cy - side // 2 + P, cx - side // 2 + P + side, cy - side // 2 + P + side)
    crop = padded.crop(box).resize((a.size, a.size), Image.LANCZOS)
    crop.save(os.path.join(out, stem + ".png"))
    m["control_bbox_in_photo"] = [int(x0), int(y0), int(x1), int(y1)]
    rows.append(stem)
    print(stem, "bbox", (x0, y0, x1, y1))
json.dump(manifest, open(os.path.join(a.dataset, "manifest.json"), "w"), indent=2)

# preview: photo crop | logo, 4 pairs per row
T = 200; cols = 4
sheet = Image.new("RGB", (T * 2 * cols, T * ((len(rows) + cols - 1) // cols)), "white")
for i, stem in enumerate(rows):
    r, c = divmod(i, cols)
    sheet.paste(Image.open(os.path.join(out, stem + ".png")).resize((T, T)), (c * 2 * T, r * T))
    sheet.paste(Image.open(os.path.join(a.dataset, "logos", stem + ".png")).resize((T, T)), (c * 2 * T + T, r * T))
os.makedirs(os.path.join(a.dataset, "preview"), exist_ok=True)
sheet.save(os.path.join(a.dataset, "preview", "pairs_sheet.jpg"), quality=85)
print("wrote", len(rows), "control images")
