#!/usr/bin/env python3
"""Study how the reference videos are built, not just how they end.

For every reference clip this finds the phases (photo, construction, shape-builder merge, black
fill, clean-up, cards) from simple per-frame signals, and saves the frames worth looking at:

  study/construction/<stem>.png   all guide shapes drawn, just before the merge starts
  study/merge/<stem>.png          mid shape-builder (red outline + dotted regions)
  study/logo_on_photo/<stem>.png  finished black mark on the photo, guides deleted
  study/phases.json               phase times per clip and their medians

  python3 -I study_references.py <dirs with mp4s> --out study
"""
import argparse, glob, json, os, subprocess
import numpy as np
from scipy import ndimage

FPS, AW = 5, 360


def probe(path):
    j = json.loads(subprocess.run(["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries",
                                   "stream=width,height:format=duration", "-of", "json", path],
                                  capture_output=True, text=True, check=True).stdout)
    return int(j["streams"][0]["width"]), int(j["streams"][0]["height"]), float(j["format"]["duration"])


def frames(path, w, h):
    ah = int(round(h * AW / w)) // 2 * 2
    raw = subprocess.run(["ffmpeg", "-v", "error", "-i", path, "-vf", f"fps={FPS},scale={AW}:{ah}", "-f", "rawvideo",
                          "-pix_fmt", "rgb24", "-"], capture_output=True, check=True).stdout
    n = len(raw) // (AW * ah * 3)
    return np.frombuffer(raw, np.uint8)[: n * AW * ah * 3].reshape(n, ah, AW, 3)


def signals(fr):
    out = []
    for f in fr:
        r, g, b = (f[..., i].astype(np.int32) for i in range(3))
        gray = (r + g + b) / 3
        q = (f >> 4).reshape(-1, 3); keys = q[:, 0].astype(np.int32) * 256 + q[:, 1] * 16 + q[:, 2]
        flat = np.bincount(keys).max() / keys.size
        red = ((r > 170) & (g < 110) & (b < 110) & (r - g > 90)).mean()
        black = (f.max(-1) < 45).mean()
        stroke = ((ndimage.uniform_filter(gray, 9) - gray) > 38).mean()        # thin dark lines on a lighter ground
        tool = ((np.abs(r - g) < 8) & (np.abs(g - b) < 8) & (gray > 60) & (gray < 110)).mean()   # Illustrator tool panel
        out.append((flat, red, black, stroke, tool))
    return np.array(out)


def grab(path, t, out):
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-ss", f"{max(0, t):.3f}", "-i", path, "-frames:v", "1", out], check=True)


def main():
    ap = argparse.ArgumentParser(); ap.add_argument("videos", nargs="+"); ap.add_argument("--out", default="study")
    a = ap.parse_args()
    files = []
    for v in a.videos:
        files += sorted(glob.glob(os.path.join(v, "*.mp4"))) if os.path.isdir(v) else [v]
    files.sort(key=lambda p: os.path.basename(p))
    for d in ("construction", "merge", "logo_on_photo"):
        os.makedirs(os.path.join(a.out, d), exist_ok=True)
    rows = []
    for path in files:
        stem = os.path.splitext(os.path.basename(path))[0]
        w, h, dur = probe(path); sg = signals(frames(path, w, h)); n = len(sg); T = lambda i: i / FPS
        flat, red, black, stroke, tool = sg.T
        red = red - np.median(red[:8]); black = black - np.median(black[:8])      # the photo itself may be red or dark
        tool = tool - np.median(tool[:8])
        i_card = n
        while i_card > 0 and flat[i_card - 1] > 0.55:
            i_card -= 1
        final_black = np.median(black[max(0, i_card - 4):i_card]) if i_card > 4 else black[:i_card].max()
        fill = np.nonzero(black[:i_card] > 0.6 * final_black)[0]
        i_fill = int(fill[0]) if len(fill) and final_black > 0.004 else i_card
        redon = np.nonzero(red[:i_fill + 1] > 0.0015)[0]
        redon = redon[redon > 2 * FPS]                                           # the merge never starts in the first seconds
        i_red = int(redon[0]) if len(redon) else i_fill
        smax = stroke[:i_red + 1].max() if i_red > 0 else 0
        on = np.nonzero(stroke[:i_red + 1] > 0.08 * smax)[0]
        i_c0 = int(on[0]) if len(on) and smax > 0 else 0
        toolon = np.nonzero(tool[i_c0:i_red + 1] > 0.02)[0]
        i_c1 = i_c0 + int(toolon[0]) - 1 if len(toolon) else i_red - 1     # last frame before the tool panel pops up
        i_c1 = max(i_c0, i_c1)
        # leftovers deleted: last frame before the cards where stroke amount has dropped
        i_clean = i_card - 1
        grab(path, T(i_c1), os.path.join(a.out, "construction", stem + ".png"))
        grab(path, T((i_red + i_fill) // 2), os.path.join(a.out, "merge", stem + ".png"))
        grab(path, T(i_clean) - 0.1, os.path.join(a.out, "logo_on_photo", stem + ".png"))
        row = {"stem": stem, "duration": round(dur, 1), "construction_start": T(i_c0), "construction_end": T(i_c1),
               "merge_start": T(i_red), "fill": T(i_fill), "cards": T(i_card),
               "construction_s": round(T(i_c1) - T(i_c0), 1), "select_and_merge_s": round(T(i_fill) - T(i_c1), 1),
               "cleanup_s": round(T(i_card) - T(i_fill), 1), "cards_s": round(dur - T(i_card), 1),
               "stroke_px_share": round(float(stroke[i_c1]), 4)}
        rows.append(row)
        print(f"{stem:26s} {dur:5.1f}s | build {row['construction_start']:4.1f}-{row['construction_end']:4.1f} ({row['construction_s']:4.1f}s) | "
              f"merge {row['select_and_merge_s']:4.1f}s | clean-up {row['cleanup_s']:4.1f}s | cards {row['cards_s']:4.1f}s")
    med = {k: float(np.median([r[k] for r in rows])) for k in ("duration", "construction_start", "construction_s",
                                                                "select_and_merge_s", "cleanup_s", "cards_s")}
    json.dump({"median": med, "clips": rows}, open(os.path.join(a.out, "phases.json"), "w"), indent=1)
    print("\nmedian:", json.dumps(med))


if __name__ == "__main__":
    main()
