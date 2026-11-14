#!/usr/bin/env python3
"""Put everything the references give us into one coordinate frame (720-wide video frame):

  ref/<stem>.photo.png   first frame: the animal photo before anything is drawn
  ref/<stem>.sil.png     the animal's silhouette (local background removal, rembg)
  ref/<stem>.logo.png    the designer's finished mark as a mask (black fill on the photo)
  + dataset/constructions/<stem>.json from extract_constructions.py (same coordinates)

  python3 -I build_reference_set.py <dirs with mp4s> --phases dataset/reference_phases.json --out ref
"""
import argparse, glob, io, json, os, subprocess, contextlib
import numpy as np
from PIL import Image
from scipy import ndimage

AW = 720


def frame(path, t):
    raw = subprocess.run(["ffmpeg", "-v", "error", "-ss", f"{max(0, t):.3f}", "-i", path, "-frames:v", "1", "-vf", f"scale={AW}:-2",
                          "-f", "image2pipe", "-vcodec", "png", "-"], capture_output=True, check=True).stdout
    return Image.open(io.BytesIO(raw)).convert("RGB")


def main():
    ap = argparse.ArgumentParser(); ap.add_argument("videos", nargs="+"); ap.add_argument("--phases", required=True); ap.add_argument("--out", required=True)
    a = ap.parse_args()
    files = []
    for v in a.videos:
        files += sorted(glob.glob(os.path.join(v, "*.mp4"))) if os.path.isdir(v) else [v]
    phases = {r["stem"]: r for r in json.load(open(a.phases))["clips"]}
    os.makedirs(a.out, exist_ok=True)
    with contextlib.redirect_stderr(io.StringIO()):
        from rembg import remove, new_session
        sess = new_session("isnet-general-use")
    for path in sorted(files, key=os.path.basename):
        stem = os.path.splitext(os.path.basename(path))[0]; ph = phases[stem]
        photo = frame(path, 0.05); photo.save(os.path.join(a.out, stem + ".photo.png"))
        lf = np.asarray(frame(path, ph["cards"] - 0.3).convert("L"))
        logo = ndimage.binary_opening(lf < 48, structure=np.ones((3, 3), bool))
        lab, n = ndimage.label(logo)
        if n:
            sizes = np.asarray(ndimage.sum(logo, lab, range(1, n + 1)))
            logo = np.isin(lab, 1 + np.nonzero(sizes >= 0.01 * sizes.max())[0])
        Image.fromarray(np.where(logo, 0, 255).astype(np.uint8)).save(os.path.join(a.out, stem + ".logo.png"))
        # the clips show the photo under a white veil; lift it before cutting the animal out
        px = np.asarray(photo).astype(np.float32)
        alpha = float(np.clip(np.percentile(px.min(-1), 0.5) / 255.0, 0.0, 0.7))
        clear = Image.fromarray(np.clip((px - 255 * alpha) / (1 - alpha), 0, 255).astype(np.uint8))
        clear.save(os.path.join(a.out, stem + ".clear.jpg"), quality=90)
        cands = []
        for src in (clear, photo):
            m = np.asarray(remove(src, session=sess, only_mask=True)) > 127
            lab, n = ndimage.label(m)
            if n > 1:                                   # keep the subject the designer drew
                ov = np.asarray(ndimage.sum(logo, lab, range(1, n + 1))); m = lab == (1 + int(np.argmax(ov)))
            body = ndimage.binary_fill_holes(logo)
            cands.append(((m & body).sum() / max(1, (m | body).sum()), m))
        sil = max(cands, key=lambda t: t[0])[1]         # whichever cut-out agrees better with where the mark is
        lab, n = 0, 0
        lab, n = ndimage.label(sil)
        if n > 1:                                       # keep the subject the designer drew: the blob that overlaps the mark most
            ov = np.asarray(ndimage.sum(logo, lab, range(1, n + 1)))
            sil = lab == (1 + int(np.argmax(ov)))
        Image.fromarray(np.where(sil, 0, 255).astype(np.uint8)).save(os.path.join(a.out, stem + ".sil.png"))
        body = ndimage.binary_fill_holes(logo); iou = (sil & body).sum() / max(1, (sil | body).sum())
        print(f"{stem:26s} veil {alpha:.2f}; designer mark (holes filled) vs animal silhouette IoU {iou:.2f}")


if __name__ == "__main__":
    main()
