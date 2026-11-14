#!/usr/bin/env python3
"""Generate QUIGS-style logo marks with the trained FLUX LoRA, then clean + vectorise.

  python3 generate.py --lora path/to/quigs_logo_flux_lora.safetensors "an owl perched"
  python3 generate.py --lora ... --holdout          # regenerate the 5 held-out animals
                                                    # and build a side-by-side sheet
  python3 generate.py --lora ... --name "Owlio" --bg "#0a0a0a" --fg "#d5c9af" "an owl"

Each result is written to out/<slug>_<seed>.png (clean black-on-white), .svg (vector),
and, when --name is given, _card.png (the branded card like the end of the videos).
Needs a CUDA GPU (24 GB+) with diffusers >= 0.30, torch, peft.
"""
import argparse, json, os, re, sys

sys.path.insert(0, os.path.dirname(__file__))

TEMPLATE = ("QUIGS logo mark, {subject}, geometric minimalist flat black silhouette, "
            "bold negative-space cuts, solid white background, vector icon")
HOLDOUT = {
    "28_fox_holdout": "a fox pouncing in side profile with a bushy tail raised",
    "29_horse_holdout": "a horse galloping in side profile with a flowing mane",
    "30_serval_holdout": "a serval cat standing in side profile with large ears and a raised tail",
    "31_gazelle_holdout": "a gazelle leaping in side profile with curved horns",
    "32_bear_holdout": "a bear face seen from the front with round ears and a muzzle, symmetrical",
}


def load_pipe(lora, scale):
    import torch
    from diffusers import FluxPipeline
    pipe = FluxPipeline.from_pretrained("black-forest-labs/FLUX.1-dev", torch_dtype=torch.bfloat16)
    pipe.load_lora_weights(lora)
    pipe.fuse_lora(lora_scale=scale)
    pipe.enable_model_cpu_offload()
    return pipe


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("subject", nargs="?", help='e.g. "an owl perched in side profile"')
    ap.add_argument("--lora", required=True)
    ap.add_argument("--scale", type=float, default=1.0)
    ap.add_argument("--n", type=int, default=4, help="variations per subject")
    ap.add_argument("--seed", type=int, default=0)
    ap.add_argument("--steps", type=int, default=28)
    ap.add_argument("--guidance", type=float, default=3.5)
    ap.add_argument("--out", default="out")
    ap.add_argument("--holdout", action="store_true")
    ap.add_argument("--name", help="brand name for a card render")
    ap.add_argument("--bg", default="#ffffff")
    ap.add_argument("--fg", default="#000000")
    a = ap.parse_args()

    import torch
    from logo_post import finalize
    from make_card import render_card

    jobs = list(HOLDOUT.items()) if a.holdout else [(re.sub(r"[^a-z0-9]+", "-", a.subject.lower()).strip("-"), a.subject)]
    if not jobs or (not a.holdout and not a.subject):
        ap.error("give a subject or --holdout")
    os.makedirs(a.out, exist_ok=True)
    pipe = load_pipe(a.lora, a.scale)
    results = []
    for slug, subject in jobs:
        prompt = TEMPLATE.format(subject=subject)
        for k in range(a.n):
            seed = a.seed + k
            img = pipe(prompt, width=1024, height=1024, num_inference_steps=a.steps,
                       guidance_scale=a.guidance, generator=torch.Generator("cpu").manual_seed(seed)).images[0]
            stem = os.path.join(a.out, f"{slug}_{seed}")
            img.save(stem + "_raw.png")
            finalize(img, stem)
            if a.name:
                render_card(stem + ".png", a.name, a.bg, a.fg, stem + "_card.png")
            results.append({"slug": slug, "seed": seed, "prompt": prompt, "png": stem + ".png", "svg": stem + ".svg"})
            print("wrote", stem + ".svg")
    json.dump(results, open(os.path.join(a.out, "results.json"), "w"), indent=2)

    if a.holdout:
        from PIL import Image
        here = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        T = 256
        sheet = Image.new("RGB", (T * (a.n + 1), T * len(jobs)), "white")
        for r, (slug, _) in enumerate(jobs):
            ref = os.path.join(here, "dataset", "logos", slug + ".png")
            if os.path.exists(ref):
                sheet.paste(Image.open(ref).resize((T, T)), (0, r * T))
            for k in range(a.n):
                sheet.paste(Image.open(os.path.join(a.out, f"{slug}_{a.seed + k}.png")).resize((T, T)), ((k + 1) * T, r * T))
        sheet.save(os.path.join(a.out, "holdout_sheet.png"))
        print("holdout comparison (left column = real logo):", os.path.join(a.out, "holdout_sheet.png"))


if __name__ == "__main__":
    main()
