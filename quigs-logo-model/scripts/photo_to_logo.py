#!/usr/bin/env python3
"""The system: animal photo in -> QUIGS-style logo out (PNG + SVG + branded card).

  python3 photo_to_logo.py photo.jpg --name "Stallion" --bg "#11393c" --fg "#ffffff"
  python3 photo_to_logo.py photo.jpg --backend gemini
  python3 photo_to_logo.py photo.jpg --backend kontext --lora quigs_kontext_lora.safetensors

Backends
  openai   gpt-image-1 image edit with the photo + 4 dataset logos as style references
           (needs OPENAI_API_KEY). Works today, no training.
  gemini   Gemini image model with the same inputs (needs GEMINI_API_KEY).
  kontext  local FLUX.1 Kontext [dev] + the LoRA trained with train/kontext_lora.yaml
           on the photo->logo pairs (needs a 24 GB GPU). Best fidelity once trained.

Every backend returns a raster; logo_post.py thresholds, cleans and vectorises it the
same way the dataset was built, so the output is a flat black mark on white + an SVG.
Outputs go to <out>/<slug>/: raw.png, logo.png, logo.svg, card.png, meta.json
"""
import argparse, base64, io, json, os, random, re, sys, time

sys.path.insert(0, os.path.dirname(__file__))
HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
from PIL import Image

STYLE_PROMPT = (
    "Image 1 is a photo of an animal. The other images are reference logo marks that define the "
    "exact target style. Redraw the animal from image 1 as a logo mark in precisely that style: one "
    "flat, solid black silhouette on a pure white background, constructed from simple geometric "
    "shapes (circles, straight lines, clean arcs), keeping the animal's exact pose, direction and "
    "proportions from the photo. Suggest the eye, legs, ears, mane and tail only with bold "
    "negative-space cuts (white gaps slicing through the black shape), never with outlines, thin "
    "lines or shading. No outlines, no gradients, no texture, no text, no background scenery, no "
    "shadows. The mark is centered with generous white margins, like a vector icon."
)
KONTEXT_PROMPT = "Turn this photo into a QUIGS logo mark: geometric minimalist flat black silhouette with bold negative-space cuts on a solid white background"
DEFAULT_REFS = ["01_wolf_train", "11_elk_train", "17_penguin_train", "19_eagle_train"]


def prep_photo(path, size=1024):
    """Square-pad the photo (keeps the whole animal) and downscale for the API."""
    im = Image.open(path).convert("RGB")
    s = max(im.size)
    sq = Image.new("RGB", (s, s), (255, 255, 255))
    sq.paste(im, ((s - im.width) // 2, (s - im.height) // 2))
    return sq.resize((size, size), Image.LANCZOS)


def ref_images(refs):
    return [Image.open(os.path.join(HERE, "dataset", "logos", r + ".png")).convert("RGB") for r in refs]


def to_png_bytes(im):
    b = io.BytesIO(); im.save(b, "PNG"); return b.getvalue()


# ---------------------------------------------------------------- backends
def run_openai(photo, refs, n):
    from openai import OpenAI
    client = OpenAI()
    files = [("photo.png", to_png_bytes(photo))] + [(f"ref{i}.png", to_png_bytes(r)) for i, r in enumerate(refs)]
    res = client.images.edit(model="gpt-image-1", image=[io.BytesIO(b) for _, b in files],
                             prompt=STYLE_PROMPT, n=n, size="1024x1024", quality="medium")
    return [Image.open(io.BytesIO(base64.b64decode(d.b64_json))) for d in res.data]


def run_gemini(photo, refs, n):
    from google import genai
    client = genai.Client()
    outs = []
    for _ in range(n):
        r = client.models.generate_content(model=os.environ.get("GEMINI_IMAGE_MODEL", "gemini-2.5-flash-image"),
                                           contents=[STYLE_PROMPT, photo, *refs])
        for part in r.candidates[0].content.parts:
            if getattr(part, "inline_data", None):
                outs.append(Image.open(io.BytesIO(part.inline_data.data)))
    return outs


def run_kontext(photo, refs, n, lora, seed=0):
    import torch
    from diffusers import FluxKontextPipeline
    pipe = FluxKontextPipeline.from_pretrained("black-forest-labs/FLUX.1-Kontext-dev", torch_dtype=torch.bfloat16)
    if lora:
        pipe.load_lora_weights(lora); pipe.fuse_lora()
    pipe.enable_model_cpu_offload()
    return [pipe(image=photo, prompt=KONTEXT_PROMPT, guidance_scale=2.5, num_inference_steps=28,
                 generator=torch.Generator("cpu").manual_seed(seed + k)).images[0] for k in range(n)]


BACKENDS = {"openai": run_openai, "gemini": run_gemini, "kontext": run_kontext}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("photo")
    ap.add_argument("--backend", choices=BACKENDS, default="openai")
    ap.add_argument("--lora", help="kontext backend: path to the trained LoRA")
    ap.add_argument("--n", type=int, default=2, help="variations to generate")
    ap.add_argument("--refs", nargs="*", default=DEFAULT_REFS, help="dataset stems used as style references")
    ap.add_argument("--name", default="", help="brand name for the card")
    ap.add_argument("--bg", default=None, help="card background; default: random dataset palette")
    ap.add_argument("--fg", default=None)
    ap.add_argument("--out", default="out")
    a = ap.parse_args()

    from logo_post import finalize
    from make_card import render_card

    slug = re.sub(r"[^a-z0-9]+", "-", os.path.splitext(os.path.basename(a.photo))[0].lower()).strip("-")
    out = os.path.join(a.out, slug); os.makedirs(out, exist_ok=True)
    photo, refs = prep_photo(a.photo), ref_images(a.refs)
    t0 = time.time()
    if a.backend == "kontext":
        rasters = run_kontext(photo, refs, a.n, a.lora)
    else:
        rasters = BACKENDS[a.backend](photo, refs, a.n)

    if a.bg is None or a.fg is None:
        pal = json.load(open(os.path.join(HERE, "dataset", "palette.json")))
        pick = random.choice([v for v in pal.values() if v["background"].lower() != "#ffffff"])
        a.bg, a.fg = a.bg or pick["background"], a.fg or pick["logo"]

    results = []
    for k, im in enumerate(rasters):
        stem = os.path.join(out, f"v{k}")
        im.save(stem + "_raw.png")
        finalize(im, stem)
        card = render_card(stem + ".png", a.name, a.bg, a.fg, stem + "_card.png")
        results.append({"raw": stem + "_raw.png", "logo": stem + ".png", "svg": stem + ".svg", "card": card})
        print("wrote", stem + ".svg")
    json.dump({"photo": a.photo, "backend": a.backend, "refs": a.refs, "name": a.name, "bg": a.bg, "fg": a.fg,
               "seconds": round(time.time() - t0, 1), "results": results}, open(os.path.join(out, "meta.json"), "w"), indent=2)


if __name__ == "__main__":
    main()
