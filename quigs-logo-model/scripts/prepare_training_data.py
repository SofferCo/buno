#!/usr/bin/env python3
"""Build the folder a LoRA trainer consumes from dataset/.

  train_data/<stem>.png + <stem>.txt   (train split only, holdout kept apart)
  holdout/<stem>.png + <stem>.txt      (never trained on; used by generate.py --holdout)

Optional augmentation (--mirror) adds a horizontally flipped copy of every
side-profile logo; the style is direction-agnostic so this doubles the set
without teaching anything wrong. Symmetrical front-facing marks are skipped.

Usage: python3 prepare_training_data.py --dataset dataset --out train_data [--mirror]
"""
import argparse, json, os, shutil
from PIL import Image, ImageOps

ap = argparse.ArgumentParser()
ap.add_argument("--dataset", default="dataset")
ap.add_argument("--out", default="train_data")
ap.add_argument("--mirror", action="store_true")
a = ap.parse_args()

manifest = json.load(open(os.path.join(a.dataset, "manifest.json")))
os.makedirs(a.out, exist_ok=True)
os.makedirs("holdout", exist_ok=True)
n = 0
for m in manifest:
    stem = m["stem"]
    src = os.path.join(a.dataset, "logos", stem + ".png")
    cap_path = os.path.join(a.dataset, "captions", stem + ".txt")
    cap = open(cap_path).read().strip() if os.path.exists(cap_path) else f"QUIGS logo mark, a {m['animal'].replace('-', ' ')}, geometric minimalist flat black silhouette, solid white background, vector icon"
    dst_dir = a.out if m["split"] == "train" else "holdout"
    shutil.copy(src, os.path.join(dst_dir, stem + ".png"))
    open(os.path.join(dst_dir, stem + ".txt"), "w").write(cap + "\n")
    n += 1
    if a.mirror and m["split"] == "train" and "symmetrical" not in cap:
        ImageOps.mirror(Image.open(src)).save(os.path.join(dst_dir, stem + "_flip.png"))
        open(os.path.join(dst_dir, stem + "_flip.txt"), "w").write(cap.replace("side profile", "side profile facing the other way") + "\n")
        n += 1
print(f"wrote {n} image/caption pairs -> {a.out}/ (train) and holdout/")
