#!/usr/bin/env python3
"""Put a photo with a plain backdrop (studio shot) on the 1080x1920 canvas without outpainting.

The animal is scaled to a sensible size and centred at 45% height; the rest of the canvas is
filled with the photo's own backdrop colour. Photo and cutout get the same transform, so the
outputs feed straight into silhouette_logo.py prepare. A photo with a real scene behind the
animal needs outpainting to 9:16 instead.

  python3 frame_photo.py --photo up.png --cutout cutout.png --out work/
  -> work/bg.png, work/cutout.png (both 1080x1920)
"""
import argparse, os
import numpy as np
from PIL import Image

W, H = 1080, 1920
ap = argparse.ArgumentParser()
ap.add_argument("--photo", required=True); ap.add_argument("--cutout", required=True); ap.add_argument("--out", required=True)
ap.add_argument("--max-w", type=float, default=0.72); ap.add_argument("--max-h", type=float, default=0.40)
a = ap.parse_args()

photo = Image.open(a.photo).convert("RGB")
cut = Image.open(a.cutout)
alpha = (cut.getchannel("A") if cut.mode in ("RGBA", "LA") else cut.convert("L")).resize(photo.size, Image.BILINEAR)
m = np.asarray(alpha) > 127
ys, xs = np.nonzero(m)
x0, x1, y0, y1 = xs.min(), xs.max() + 1, ys.min(), ys.max() + 1
s = min(a.max_w * W / (x1 - x0), a.max_h * H / (y1 - y0))
px = np.asarray(photo)
border = np.concatenate([px[:6].reshape(-1, 3), px[-6:].reshape(-1, 3), px[:, :6].reshape(-1, 3), px[:, -6:].reshape(-1, 3)])
fill = tuple(int(v) for v in np.median(border, axis=0))
nw, nh = round(photo.width * s), round(photo.height * s)
ox = round(W / 2 - (x0 + x1) / 2 * s); oy = round(0.45 * H - (y0 + y1) / 2 * s)
bg = Image.new("RGB", (W, H), fill); bg.paste(photo.resize((nw, nh), Image.LANCZOS), (ox, oy))
ca = Image.new("L", (W, H), 0); ca.paste(alpha.resize((nw, nh), Image.LANCZOS), (ox, oy))
os.makedirs(a.out, exist_ok=True)
bg.save(os.path.join(a.out, "bg.png"))
out = Image.new("RGBA", (W, H), (0, 0, 0, 0)); out.putalpha(ca); out.save(os.path.join(a.out, "cutout.png"))
print(f"animal {x1-x0}x{y1-y0}px in the photo -> scale {s:.2f}, {round((x1-x0)*s)}x{round((y1-y0)*s)}px on canvas, backdrop {fill}")
