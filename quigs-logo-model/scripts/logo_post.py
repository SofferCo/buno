"""Post-processing shared by generate.py and make_card.py: raster -> clean mask -> SVG."""
import os, sys
import numpy as np
from PIL import Image

sys.path.insert(0, os.path.dirname(__file__))
from extract_dataset import clean_mask, to_svg  # noqa: E402


def raster_to_mask(img, thresh=128):
    """Any generated image -> boolean mask of the mark (True = ink)."""
    g = np.asarray(img.convert("L"))
    mask = g < thresh
    # if the model drew a dark background with a light mark, flip
    if mask.mean() > 0.5:
        mask = ~mask
    return clean_mask(mask)


def mask_to_square(mask, size=1024, pad=0.12):
    ys, xs = np.nonzero(mask)
    if ys.size == 0:
        return np.zeros((size, size), bool)
    crop = mask[ys.min():ys.max() + 1, xs.min():xs.max() + 1]
    ch, cw = crop.shape
    side = int(max(ch, cw) * (1 + 2 * pad))
    canvas = np.zeros((side, side), bool)
    oy, ox = (side - ch) // 2, (side - cw) // 2
    canvas[oy:oy + ch, ox:ox + cw] = crop
    im = Image.fromarray(np.where(canvas, 0, 255).astype(np.uint8), "L").resize((size, size), Image.LANCZOS)
    return np.asarray(im) < 128


def finalize(img, out_stem, size=1024):
    """Write <out_stem>.png (black on white) and <out_stem>.svg. Returns the mask."""
    mask = mask_to_square(raster_to_mask(img), size)
    Image.fromarray(np.where(mask, 0, 255).astype(np.uint8), "L").convert("RGB").save(out_stem + ".png")
    to_svg(mask, out_stem + ".svg", size)
    return mask
