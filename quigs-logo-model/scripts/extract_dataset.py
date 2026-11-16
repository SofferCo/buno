#!/usr/bin/env python3
"""Extract a training dataset from the "quigs" logo process videos.

Every video follows the same script:
  photo -> construction circles/lines -> red outline -> black silhouette on photo
        -> clean logo on a solid card -> logo + brand name card.

For each video we save:
  photo/      first frame (the reference animal photo)
  overlay/    last frame before the solid card (black silhouette on the photo)
  card/       first solid-card frame (logo alone, no text) at full resolution
  final/      last frame (logo + brand name)
  logos/      normalised training image: black logo on white, square, padded
  svg/        vectorised logo (potrace)
  palette.json  background / logo colours per logo
  captions/   <stem>.txt caption for LoRA training (from captions.json if present)

Usage:
  python3 -I extract_dataset.py <videos_dir...> --out <dataset_dir> [--size 1024]
"""
import argparse, json, os, re, subprocess, sys, glob
import numpy as np
from PIL import Image

FPS = 4          # analysis frame rate
AW = 192         # analysis width


def probe(path):
    out = subprocess.run(["ffprobe", "-v", "error", "-select_streams", "v:0",
                          "-show_entries", "stream=width,height:format=duration",
                          "-of", "json", path], capture_output=True, text=True, check=True).stdout
    j = json.loads(out)
    return int(j["streams"][0]["width"]), int(j["streams"][0]["height"]), float(j["format"]["duration"])


def analysis_frames(path, w, h):
    ah = int(round(h * AW / w)) // 2 * 2
    raw = subprocess.run(["ffmpeg", "-v", "error", "-i", path, "-vf", f"fps={FPS},scale={AW}:{ah}",
                          "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], capture_output=True, check=True).stdout
    n = len(raw) // (AW * ah * 3)
    return np.frombuffer(raw, np.uint8)[: n * AW * ah * 3].reshape(n, ah, AW, 3)


def flatness(frame):
    """Fraction of pixels sharing the dominant (quantised) colour."""
    q = (frame >> 4).reshape(-1, 3)
    keys = q[:, 0].astype(np.int32) * 256 + q[:, 1] * 16 + q[:, 2]
    counts = np.bincount(keys)
    return counts.max() / keys.size


def grab(path, t, out_png):
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-ss", f"{t:.3f}", "-i", path,
                    "-frames:v", "1", out_png], check=True)


def mode_color(px):
    q = px.reshape(-1, 3)
    keys = q[:, 0].astype(np.int32) * 65536 + q[:, 1].astype(np.int32) * 256 + q[:, 2]
    vals, counts = np.unique(keys, return_counts=True)
    k = int(vals[counts.argmax()])
    return np.array([k >> 16, (k >> 8) & 255, k & 255], np.uint8)


def clean_mask(mask):
    """Keep the logo, drop stray guide lines, specks and the brand-name text.

    1. morphological open (3x3, 2 iterations) removes specks and 1-4px lines
       left from the Illustrator artboard / ground lines; details touching the
       surviving blobs are restored afterwards;
    2. connected components:
       - very elongated thin components (bbox min side < 1.5% of the frame,
         aspect > 8) are leftover guide lines -> dropped;
       - components that start below the largest component and are much
         shorter than it are the brand name / (R) sign printed under the mark
         on branded cards -> dropped;
       - everything else (detached wings, antlers, antennae, stripes) is kept.
    """
    from scipy import ndimage
    H = mask.shape[0]
    opened = ndimage.binary_opening(mask, structure=np.ones((3, 3), bool), iterations=2)
    restored = ndimage.binary_dilation(opened, structure=np.ones((3, 3), bool), iterations=3) & mask
    lab, n = ndimage.label(restored)
    if n == 0:
        return restored
    sizes = np.asarray(ndimage.sum(restored, lab, range(1, n + 1)))
    sl = ndimage.find_objects(lab)
    boxes = [(s[0].start, s[0].stop, s[1].start, s[1].stop) for s in sl]
    keep = np.zeros(n + 1, bool)
    for i, (y0, y1, x0, x1) in enumerate(boxes):
        bh, bw = y1 - y0, x1 - x0
        if min(bh, bw) < 0.015 * H and max(bh, bw) > 8 * min(bh, bw):
            continue                                   # guide line
        keep[i + 1] = True
    if not keep.any():
        return restored
    main = int(np.argmax(np.where(keep[1:], sizes, -1)))
    my0, my1 = boxes[main][0], boxes[main][1]
    for i, (y0, y1, x0, x1) in enumerate(boxes):
        if keep[i + 1] and i != main and y0 >= my1 - 0.02 * H and (y1 - y0) < 0.35 * (my1 - my0):
            keep[i + 1] = False                        # brand name under the mark
    return keep[lab]


def normalise_logo(card_png, size, pad=0.12):
    """Card frame -> (black-on-white square PNG, bg colour, logo colour, mask)."""
    im = np.asarray(Image.open(card_png).convert("RGB"))
    h, w, _ = im.shape
    b = max(4, h // 50)
    border = np.concatenate([im[:b].reshape(-1, 3), im[-b:].reshape(-1, 3),
                             im[:, :b].reshape(-1, 3), im[:, -b:].reshape(-1, 3)])
    bg = mode_color(border)
    dist = np.abs(im.astype(np.int32) - bg.astype(np.int32)).sum(-1)
    mask = clean_mask(dist > 60)
    ys, xs = np.nonzero(mask)
    if ys.size == 0:
        raise RuntimeError(f"no logo found in {card_png}")
    logo_rgb = mode_color(im[mask])
    y0, y1, x0, x1 = ys.min(), ys.max() + 1, xs.min(), xs.max() + 1
    crop = mask[y0:y1, x0:x1]
    ch, cw = crop.shape
    side = int(max(ch, cw) * (1 + 2 * pad))
    canvas = np.zeros((side, side), bool)
    oy, ox = (side - ch) // 2, (side - cw) // 2
    canvas[oy:oy + ch, ox:ox + cw] = crop
    img = Image.fromarray(np.where(canvas, 0, 255).astype(np.uint8), "L").resize((size, size), Image.LANCZOS)
    img = img.point(lambda v: 255 if v > 127 else 0).convert("RGB")
    return img, bg, logo_rgb, canvas, (x0, y0, x1, y1)


def to_svg(mask, out_svg, size):
    try:
        import potrace
    except ImportError:
        return False
    side = mask.shape[0]
    bmp = potrace.Bitmap(~mask)  # potracer: False = black
    path = bmp.trace(turdsize=4, alphamax=1.0, opticurve=True, opttolerance=0.2)
    s = size / side
    parts = []
    for curve in path:
        sp = curve.start_point
        d = [f"M{sp.x*s:.2f},{sp.y*s:.2f}"]
        for seg in curve:
            if seg.is_corner:
                d.append(f"L{seg.c.x*s:.2f},{seg.c.y*s:.2f} L{seg.end_point.x*s:.2f},{seg.end_point.y*s:.2f}")
            else:
                d.append(f"C{seg.c1.x*s:.2f},{seg.c1.y*s:.2f} {seg.c2.x*s:.2f},{seg.c2.y*s:.2f} "
                         f"{seg.end_point.x*s:.2f},{seg.end_point.y*s:.2f}")
        d.append("Z")
        parts.append(" ".join(d))
    svg = (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {size} {size}" width="{size}" height="{size}">'
           f'<path fill="#000" fill-rule="evenodd" d="{" ".join(parts)}"/></svg>')
    with open(out_svg, "w") as f:
        f.write(svg)
    return True


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("videos", nargs="+")
    ap.add_argument("--out", required=True)
    ap.add_argument("--size", type=int, default=1024)
    ap.add_argument("--captions", default=None, help="captions.json {stem: caption}")
    a = ap.parse_args()

    files = []
    for v in a.videos:
        files += sorted(glob.glob(os.path.join(v, "*.mp4"))) if os.path.isdir(v) else [v]
    for d in ["photo", "overlay", "card", "final", "logos", "svg", "captions"]:
        os.makedirs(os.path.join(a.out, d), exist_ok=True)
    captions = json.load(open(a.captions)) if a.captions else {}
    palette, manifest = {}, []

    for path in files:
        stem = os.path.splitext(os.path.basename(path))[0]          # 01_wolf_train
        m = re.match(r"(\d+)_([a-z0-9-]+)_(train|holdout)", stem)
        idx, animal, split = m.groups() if m else ("", stem, "train")
        w, h, dur = probe(path)
        fr = analysis_frames(path, w, h)
        flat = np.array([flatness(f) for f in fr]) > 0.55
        # final run of flat frames (the solid cards)
        i = len(flat)
        while i > 0 and flat[i - 1]:
            i -= 1
        if i == len(flat):
            print(f"!! {stem}: no solid card found, skipping", file=sys.stderr)
            continue
        t_card = i / FPS + 0.5
        t_overlay = max(0.0, i / FPS - 0.4)
        t_final = max(t_card, dur - 0.3)
        o = lambda d: os.path.join(a.out, d, stem + ".png")
        grab(path, 0.3, o("photo"))
        grab(path, t_overlay, o("overlay"))
        grab(path, t_card, o("card"))
        grab(path, t_final, o("final"))
        img, bg, lc, mask, bbox = normalise_logo(o("card"), a.size)
        img.save(o("logos"))
        has_svg = to_svg(mask, os.path.join(a.out, "svg", stem + ".svg"), a.size)
        palette[stem] = {"background": "#%02x%02x%02x" % tuple(bg), "logo": "#%02x%02x%02x" % tuple(lc)}
        cap = captions.get(stem) or captions.get(animal)
        if cap:
            with open(os.path.join(a.out, "captions", stem + ".txt"), "w") as f:
                f.write(cap.strip() + "\n")
        manifest.append({"stem": stem, "index": idx, "animal": animal, "split": split,
                         "video": os.path.basename(path), "width": w, "height": h, "duration": round(dur, 2),
                         "t_overlay": round(t_overlay, 2), "t_card": round(t_card, 2), "t_final": round(t_final, 2),
                         "logo_bbox_in_card": [int(x) for x in bbox], "svg": has_svg})
        print(f"{stem:28s} card@{t_card:5.1f}s  bg={palette[stem]['background']} logo={palette[stem]['logo']}")

    json.dump(palette, open(os.path.join(a.out, "palette.json"), "w"), indent=2)
    json.dump(manifest, open(os.path.join(a.out, "manifest.json"), "w"), indent=2)
    print(f"done: {len(manifest)} logos -> {a.out}")


if __name__ == "__main__":
    main()
