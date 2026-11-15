#!/usr/bin/env python3
"""Photo-anchored logo: the outline comes from the animal's real silhouette, the model only adds cuts.

  prepare  cutout (same framing as the 9:16 photo) -> simplified exact silhouette on the
           1080x1920 canvas + a square crop of it and of the photo to send to the image model
  combine  model output (silhouette with negative-space cuts) -> final canvas mask:
           outline = simplified real silhouette, cuts = what the model carved out of it

  python3 silhouette_logo.py prepare --photo bg.png --cutout cutout.png --out work/
  python3 silhouette_logo.py combine --work work/ --model-output gen.png
  -> work/construction.json (arcs, lines, guides, critique; feed to make_video.py --construction),
     work/logo.svg (pure arcs and lines), work/logo.png, work/critique.png
"""
import argparse, json, os, sys
import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from make_video import W, H, cover, bbox, place_logo  # noqa: E402
import construct as K  # noqa: E402
from extract_dataset import to_svg  # noqa: E402
from logo_post import raster_to_mask, mask_to_square  # noqa: E402


def disk(r):
    y, x = np.mgrid[-r:r + 1, -r:r + 1]
    return x * x + y * y <= r * r


def simplify(mask, close_r=6, open_r=3):
    """Real cutout -> clean silhouette: fur fringe closed, specks removed, one piece, no pinholes.
    The shape is not stylised here; construct.py rebuilds it from arcs and lines."""
    m = ndimage.binary_closing(np.pad(mask, 20), structure=disk(close_r))[20:-20, 20:-20]
    m = ndimage.binary_opening(m, structure=disk(open_r)) | ndimage.binary_erosion(mask, structure=disk(1))
    lab, n = ndimage.label(m)
    if n > 1:
        m = lab == (1 + int(np.argmax(ndimage.sum(m, lab, range(1, n + 1)))))
    holes, n = ndimage.label(~m)
    sizes = ndimage.sum(~m, holes, range(1, n + 1))
    for k, sz in enumerate(sizes, start=1):
        if sz < 150:
            m |= holes == k
    return m


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
    sil = simplify(animal)
    Image.fromarray(np.where(animal, 0, 255).astype(np.uint8)).save(os.path.join(a.out, "animal_canvas.png"))
    box = square_box(sil)
    Image.fromarray(np.where(sil, 0, 255).astype(np.uint8)).save(os.path.join(a.out, "silhouette_canvas.png"))
    crop_pad(Image.fromarray(np.where(sil, 0, 255).astype(np.uint8)), box, 255).resize((1024, 1024), Image.LANCZOS) \
        .convert("RGB").save(os.path.join(a.out, "silhouette_sq.png"))
    crop_pad(cover(Image.open(a.photo).convert("RGB")), box, (255, 255, 255)).resize((1024, 1024), Image.LANCZOS) \
        .save(os.path.join(a.out, "photo_sq.jpg"), quality=92)
    json.dump({"box": [int(v) for v in box]}, open(os.path.join(a.out, "prepare.json"), "w"))
    iou = (sil & animal).sum() / (sil | animal).sum()
    print(f"silhouette vs cutout IoU {iou:.3f}; square crop {box}")


SYMMETRY_MIN = 0.72     # a drawing whose mirror image overlaps it at least this much is meant to be symmetric


def symmetrize(mark):
    """An animal that faces the viewer is drawn mirror-symmetric. If the drawing nearly is (its
    mirror image overlaps it by SYMMETRY_MIN or more about the best vertical axis), it is made exactly so:
    the drawing and its mirror image are averaged. Returns (mark, axis x or None)."""
    ys, xs = np.nonzero(mark); cx = (xs.min() + xs.max()) / 2; best = (0.0, None)
    for ax2 in range(int(2 * cx) - 40, int(2 * cx) + 41):          # axis at ax2 / 2
        idx = ax2 - np.arange(mark.shape[1]); ok = (idx >= 0) & (idx < mark.shape[1])
        mir = np.zeros_like(mark); mir[:, ok] = mark[:, idx[ok]]
        v = (mark & mir).sum() / max(1, (mark | mir).sum())
        if v > best[0]:
            best = (v, ax2, mir)
    print(f"   mirror overlap of the drawing: {best[0]:.2f}")
    if best[0] < SYMMETRY_MIN:
        return mark, None
    sd = lambda m: ndimage.distance_transform_edt(m) - ndimage.distance_transform_edt(~m)
    return (sd(mark) + sd(best[2])) > 0, best[1] / 2.0


def combine(a):
    sil = np.asarray(Image.open(os.path.join(a.work, "silhouette_canvas.png")).convert("L")) < 128
    best = None                                        # several drawings: take the one that sits best on the animal
    for path in a.model_output:
        gen = raster_to_mask(Image.open(path)); x0, y0, x1, y1 = bbox(gen)
        placed, iou = place_logo(gen[y0:y1, x0:x1], sil)   # snap the model's drawing back onto the silhouette
        score = iou
        if a.eyes:                                      # the head matters most: how well the drawing covers the animal around the eye
            ys_, xs_ = np.nonzero(sil); rad = 0.2 * max(np.ptp(xs_), np.ptp(ys_)); yy_, xx_ = np.mgrid[:sil.shape[0], :sil.shape[1]]
            near = np.zeros_like(sil)
            for e in json.load(open(a.eyes))["eyes"]:
                near |= (xx_ - e["x"]) ** 2 + (yy_ - e["y"]) ** 2 <= rad * rad
            head = (placed & sil & near).sum() / max(1, ((placed | sil) & near).sum()); score = 0.5 * iou + 0.5 * head
        if len(a.model_output) > 1:
            print(f"   {os.path.basename(path)}: overlaps the animal {iou:.3f}" + (f", around the eye {head:.3f}" if a.eyes else ""))
        if best is None or score > best[3]:
            best = (placed, iou, path, score)
    placed, iou, chosen, _ = best
    if len(a.model_output) > 1:
        print(f"   using {os.path.basename(chosen)}")
    if a.abstract:
        # The model was shown the designer's own photo -> mark pairs and drew his kind of abstraction
        # of this animal. That drawing is the mark: its outline is rebuilt from perfect shapes as it
        # is (no further simplification), its enclosed white shapes are the cuts.
        if iou < 0.7:
            print(f"   warning: the drawing only overlaps the animal {iou:.2f}; it may have drifted from the pose")
        mark = ndimage.binary_opening(placed, structure=disk(1)); lab, n = ndimage.label(mark)
        if n > 1:
            sizes = np.asarray(ndimage.sum(mark, lab, range(1, n + 1)))
            mark = np.isin(lab, 1 + np.nonzero(sizes >= 0.004 * sizes.sum())[0])
        mark, axis = symmetrize(mark)
        if axis is not None:
            print(f"   the drawing faces the viewer: made exactly mirror-symmetric about x = {axis:.0f}")
        sil = ndimage.binary_fill_holes(mark); holes = sil & ~mark; lab, n = ndimage.label(holes)
        if a.eyes:
            # The eye belongs where the animal's eye is in the photo. The drawing's own eye is
            # dropped and a perfect circle is cut at the real position.
            ys, xs = np.nonzero(sil); size0 = max(np.ptp(xs), np.ptp(ys)); eyes = json.load(open(a.eyes))["eyes"]
            small = [ndimage.center_of_mass(lab == k) for k in range(1, n + 1) if (lab == k).sum() < 0.012 * sil.sum()]
            if small and len(eyes) > 1:                 # a marked "eye" the drawing has no eye near is a look-alike (a cheek scale, a spot)
                seen = [e for e in eyes if min(np.hypot(cx - e["x"], cy - e["y"]) for cy, cx in small) < 0.1 * size0]
                if seen and len(seen) < len(eyes):
                    print(f"   {len(eyes) - len(seen)} marked eye(s) with no eye in the drawing nearby: ignored"); eyes = seen
            for k in range(1, n + 1):
                comp = lab == k; cy, cx = ndimage.center_of_mass(comp)
                d = min(np.hypot(cx - e["x"], cy - e["y"]) for e in eyes)
                if comp.sum() < 0.012 * sil.sum() and d < 0.1 * size0:
                    mark |= comp; print(f"   the drawing's eye was {d:.0f}px ({d / size0:.1%} of the animal) from the real eye: moved")
            if axis is not None and len(eyes) == 2 and (eyes[0]["x"] - axis) * (eyes[1]["x"] - axis) < 0:
                off = (abs(eyes[0]["x"] - axis) + abs(eyes[1]["x"] - axis)) / 2; y_ = (eyes[0]["y"] + eyes[1]["y"]) / 2
                for e in eyes:                          # a pair of eyes sits symmetrically about the same axis
                    e["x"] = axis + np.sign(e["x"] - axis) * off; e["y"] = y_
                    for k_ in ("r", "rx", "ry"):
                        e[k_] = (eyes[0].get(k_, eyes[0]["r"]) + eyes[1].get(k_, eyes[1]["r"])) / 2
            yy, xx = np.mgrid[:sil.shape[0], :sil.shape[1]]; room = ndimage.distance_transform_edt(sil)
            for e in eyes:
                need = 0.008 * size0 + 4                # an eye that falls on the edge of the drawing moves just far enough inside
                if room[int(np.clip(e["y"], 0, sil.shape[0] - 1)), int(np.clip(e["x"], 0, sil.shape[1] - 1))] < need:
                    d2 = np.where(room >= need, (xx - e["x"]) ** 2 + (yy - e["y"]) ** 2, 1e12); k_ = int(np.argmin(d2))
                    if d2.flat[k_] <= (0.07 * size0) ** 2:
                        print(f"   the real eye at ({e['x']:.0f},{e['y']:.0f}) is on the edge of the drawing: moved {np.sqrt(d2.flat[k_]):.0f}px inside")
                        e["x"], e["y"] = float(xx.flat[k_]), float(yy.flat[k_]); e["rx"] = e["ry"] = e["r"] = 0.0
            for e in eyes:                              # the eye keeps its own shape: a circle, or for an elongated eye the lens between two circles
                lo, hi = 0.008 * size0, 0.06 * size0
                rx, ry = float(np.clip(e.get("rx", e["r"]), lo, hi)), float(np.clip(e.get("ry", e["r"]), lo, hi))
                if max(rx, ry) / min(rx, ry) <= 1.12:
                    rx = ry = float(np.sqrt(rx * ry))
                c_, s_ = np.cos(np.radians(e.get("rot", 0.0))), np.sin(np.radians(e.get("rot", 0.0)))
                u = (xx - e["x"]) * c_ + (yy - e["y"]) * s_; v = -(xx - e["x"]) * s_ + (yy - e["y"]) * c_
                for shrink in (1.0, 0.85, 0.7, 0.55):
                    a_, b_ = max(lo, rx * shrink), max(lo, ry * shrink)
                    if not (((u / (a_ + 3)) ** 2 + (v / (b_ + 3)) ** 2 <= 1) & ~sil).any():
                        if a_ == b_:
                            eye = u ** 2 + v ** 2 <= a_ * a_
                        else:                           # two equal circles whose overlap is a_ long and b_ wide
                            hl, hw = max(a_, b_), min(a_, b_); R = (hl * hl + hw * hw) / (2 * hw)
                            p_, q_ = (u, v) if a_ >= b_ else (v, u)
                            eye = (p_ ** 2 + (q_ - (R - hw)) ** 2 <= R * R) & (p_ ** 2 + (q_ + (R - hw)) ** 2 <= R * R)
                        mark &= ~eye
                        print(f"   eye cut at ({e['x']:.0f},{e['y']:.0f}): {a_:.0f}x{b_:.0f}px" + ("" if shrink == 1.0 else f" (reduced to {shrink:.0%} to keep a rim)"))
                        break
                else:
                    print(f"   warning: the real eye at ({e['x']:.0f},{e['y']:.0f}) falls on the edge of the drawing; eye not cut")
            sil = ndimage.binary_fill_holes(mark); holes = sil & ~mark; lab, n = ndimage.label(holes)
        cuts = np.zeros_like(sil); kept = 0
        for k in range(1, n + 1):
            if (lab == k).sum() >= 0.0006 * sil.sum():
                cuts |= lab == k; kept += 1
        a.no_ground = True
    else:
        # The model's own negative space: white shapes inside the envelope of what it drew. Taking the
        # cuts this way keeps the open gaps (between legs, under a mane) that make up 82% of the
        # designer's cuts, and ignores places where the model merely redrew the outline.
        x0, y0, x1, y1 = bbox(sil); size = max(x1 - x0, y1 - y0)
        env_m, mcuts, mlab = K.cut_list(placed, size)
        learned = json.load(open(os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "dataset", "learned_results.json")))["cuts"]
        cuts = np.zeros_like(sil); kept = 0; total = 0.0
        for c in sorted(mcuts, key=lambda c: -c["area_share"]):
            comp = ndimage.binary_opening((mlab == c["label"]) & sil, structure=disk(2))
            if comp.sum() < 0.0006 * sil.sum() or c["width_rel"] < 0.012:     # a sliver, not a designed gap
                continue
            edge = comp & ~ndimage.binary_erosion(comp); rim = (edge & ndimage.binary_dilation(~sil, iterations=2)).sum() / max(1, edge.sum())
            large = c["width_rel"] > learned["width_rel_p95"] or c["area_share"] > learned["area_share_p95"]
            if large and not (c["enclosed"] and rim == 0 and c["area_share"] <= learned["area_share_p98"]):
                if a.verbose: print(f"    cut skipped (too large): width {c['width_rel']:.3f} area {c['area_share']:.3f} enclosed {c['enclosed']}")
                continue                                   # a wide open gap is a misdrawn limb; a large patch fully inside (a white chest) is a marking
            if a.verbose: print(f"    cut: width {c['width_rel']:.3f} area {c['area_share']:.3f} share of its edge on the outline {rim:.2f} enclosed {c['enclosed']}")
            if rim > a.max_rim:                            # it runs along the outline: the model redrew the edge, it did not carve a gap
                continue

            if kept >= a.max_cuts or total + comp.sum() / sil.sum() > a.max_cut_share:
                continue
            cuts |= comp; kept += 1; total += comp.sum() / sil.sum()
    body = sil.copy()
    if not a.no_ground:                                # feet end on one flat ground line, as in the references
        x0, y0, x1, y1 = bbox(body)
        body[int(y1 - 0.012 * (y1 - y0)) - 1:] = False
    cuts &= body
    final = body & ~cuts
    lab, n = ndimage.label(final)                      # drop crumbs the cuts detached
    if n > 1:
        sizes = np.asarray(ndimage.sum(final, lab, range(1, n + 1)))
        final = np.isin(lab, 1 + np.nonzero(sizes >= 0.004 * sizes.sum())[0])
    animal = np.asarray(Image.open(os.path.join(a.work, "animal_canvas.png")).convert("L")) < 128
    print(f"model drawing vs silhouette IoU {iou:.2f}; kept {kept} cuts. Building the body, shapes first:")

    # 1. the uncut body, built the way the reference clips are: a few ovals that sit inside the
    #    animal as its masses, then straight strokes for everything else
    bx0, by0, bx1, by1 = bbox(body); size = max(bx1 - bx0, by1 - by0)
    prm = dict(K.PARAMS)
    UP = 2 if a.abstract else 1                        # a drawing is fitted at twice the resolution: crisp corners, no pixel steps
    if a.abstract:                                     # the drawing is already abstract: rebuild it as it is
        prm.update({"thick_k": 0.0, "tol_rel": a.tolerance or 0.005, "arc_cost": a.arc_cost, "arc_cost_long": a.arc_cost_long,
                    "ell_cost": 99, "ell_cost_long": 99,       # circles and strokes only: no ellipses
                    "circle_max_r": a.max_circle or prm["circle_max_r"],   # no circle larger than the designer's (90% of his are under 0.21 of the animal)
                    "arc_long_rel": 0.10,                                  # a long curve is cheaper still: arcs, not facets
                    "arc_min_sweep": 0.35, "oval_min_r": 0.02})
    tol = float(np.clip((a.tolerance or prm["tol_rel"]) * size * UP, 3.0, 26.0 * UP))
    fit = (lambda m, t, **kw: K.scale_chains(K.fit_mask(K.upsample(m, UP), t, **kw), 1.0 / UP)) if UP > 1 else K.fit_mask
    body_chains = fit(body, tol, shapes_first="dp", delta=tol, log=print, prm=prm); tol /= UP
    st = K.stats(body_chains); eps = tol; trail = []
    # 2. each cut is its own closed shape that gets deleted from the merged body
    cut_items, cut_chains = [], []
    clab, cn = ndimage.label(cuts)
    depth = ndimage.distance_transform_edt(cuts)
    for i in range(1, cn + 1):
        comp = clab == i
        ext = comp | (ndimage.binary_dilation(comp, structure=disk(6)) & ~body)   # reach past the outline at an open mouth
        ch = fit(ext, (0.7 * tol if comp.sum() > 1500 else min(tol, 2.5)) * UP, shapes_first="cut")
        if not ch:
            continue
        py, px = ndimage.maximum_position(depth, clab, i)
        cut_chains += ch
        cm = K.rasterize(ch, body.shape) & ndimage.binary_dilation(ext, iterations=4)   # the fitted cut may not bite beyond the gap itself
        if not (ext & ~body).any():                    # a marking inside the body keeps a rim of body around it
            cm &= ndimage.binary_erosion(body, iterations=4)
        cut_items.append({"d": " ".join(K.chain_path(c) for c in ch), "pole": [float(px), float(py)], "area": int(comp.sum()), "mask": cm})
    cut_items.sort(key=lambda c: -c["area"])
    state = K.rasterize(body_chains, body.shape); fill_states = [K.mask_path(state)]   # merged body, then minus each cut
    body_built = state.copy()
    for c in cut_items:
        state = state & ~c.pop("mask"); fill_states.append(K.mask_path(state))
    guides = K.build_guides(body_chains + cut_chains, W)
    # one long ground line under the feet, as in nearly every reference clip
    gy = float(bbox(body_built)[3]); gl = [g for g in guides if g["type"] == "line" and abs(g["y1"] - g["y2"]) < 2.5 and abs(g["y1"] - gy) < 4]
    if gl and not a.no_ground:
        guides = [g for g in guides if g not in gl]
        k = next((i for i, g in enumerate(guides) if g["type"] == "line"), len(guides))
        guides.insert(k, {"type": "line", "x1": float(bx0 - 0.07 * size), "y1": gy, "x2": float(bx1 + 0.07 * size), "y2": gy})
    plan = K.merge_plan(guides, body_built)
    # 3. the finished mark = built body minus the cuts, re-expressed as clean arcs and lines for the SVG
    # (a drawing: the mark is exactly the shapes it was rebuilt from, holes included)
    final_chains = body_chains + cut_chains if a.abstract else K.fit_mask(state, 1.5, share=False)
    logo = K.rasterize(final_chains, final.shape); bb = [int(v) for v in bbox(logo)]
    target = animal & ~cuts                            # judge the outline, not the cuts carved on purpose
    cr = K.critique(logo, target); fst = K.stats(final_chains)
    kinds = {}
    for g in guides:
        kinds[g["type"]] = kinds.get(g["type"], 0) + 1

    Image.fromarray(np.where(logo, 0, 255).astype(np.uint8)).save(os.path.join(a.work, "logo_canvas.png"))
    K.render_square(final_chains, bb).save(os.path.join(a.work, "logo_sharp.png"))
    K.write_svg(final_chains, bb, os.path.join(a.work, "logo_sharp.svg"))          # exactly the construction: arcs and lines
    # the finished logo: the same shapes with every corner eased (--corner-radius is given for a logo
    # 512 px across, 2-5 px there; on the canvas it scales with the mark)
    r_px = a.corner_radius * max(bb[2] - bb[0], bb[3] - bb[1]) / 512.0
    round_chains = K.fillet_chains(final_chains, r_px) if a.corner_radius > 0 else final_chains
    n_f = sum(p["type"] == "fillet" for c in round_chains for p in c)
    print(f"   {n_f} corners eased by up to {r_px:.1f}px on the canvas ({a.corner_radius:g}px at a 512px logo)")
    round_d = " ".join(K.chain_path(c) for c in round_chains)
    K.render_square(round_chains, bb).save(os.path.join(a.work, "logo.png"))
    K.write_svg(round_chains, bb, os.path.join(a.work, "logo.svg"))
    json.dump({"eps": eps, "paths": [K.chain_path(c) for c in final_chains], "guides": guides, "bbox": bb,
               "fill_states": fill_states, "cuts": cut_items, "merge": plan, "round_path": round_d,
               "stats": {k: v for k, v in fst.items() if k != "radii"}, "critique": cr, "search": trail},
              open(os.path.join(a.work, "construction.json"), "w"))
    img = np.full(final.shape + (3,), 255, np.uint8); img[logo & target] = (30, 30, 30)
    img[logo & ~target] = (230, 50, 40); img[target & ~logo] = (40, 110, 230)
    Image.fromarray(img).crop((max(0, bb[0] - 40), max(0, bb[1] - 40), bb[2] + 40, bb[3] + 40)).save(os.path.join(a.work, "critique.png"))
    print(f"-> {len(guides)} guide shapes {kinds} cut the plane into {plan['regions']} regions inside the animal; "
          f"{len(cut_items)} cuts deleted\n"
          f"   critique vs the animal: IoU {cr['iou']:.3f} | outline off by mean {cr['outline_mean_px']:.1f}px, "
          f"p95 {cr['outline_p95_px']:.1f}px, max {cr['outline_max_px']:.0f}px")


if __name__ == "__main__":
    ap = argparse.ArgumentParser(); sub = ap.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("prepare"); p.add_argument("--photo", required=True); p.add_argument("--cutout", required=True)
    p.add_argument("--out", required=True); p.set_defaults(f=prepare)
    c = sub.add_parser("combine"); c.add_argument("--work", required=True); c.add_argument("--model-output", required=True, nargs="+", help="one or more drawings from the image model; the one that overlaps the animal best is used")
    c.add_argument("--abstract", action="store_true", help="the model output is the designer-style abstraction of the animal (see dataset/abstraction/): build the mark from it instead of from the silhouette"); c.add_argument("--max-circle", type=float, help="with --abstract: largest circle radius as a share of the animal's size (default: the trained value, 0.25)"); c.add_argument("--eyes", help="eyes.json from locate_eyes.py: where the animal's eyes are in the photo"); c.add_argument("--corner-radius", type=float, default=5.0, help="radius that eases the corners of the finished logo, in px for a logo 512 px across (2-5); 0 keeps them sharp"); c.add_argument("--arc-cost", type=float, default=0.9, help="with --abstract: cost of a short circular arc against 1.0 for a straight stroke. Near 1 the mark is built from circles wherever a circle fits, and strokes are left for what is truly straight"); c.add_argument("--arc-cost-long", type=float, default=0.7, help="... and of an arc longer than a tenth of the animal"); c.add_argument("--max-cuts", type=int, default=10); c.add_argument("--max-rim", type=float, default=0.3, help="most of a cut's edge that may lie on the animal's outline"); c.add_argument("--verbose", action="store_true"); c.add_argument("--max-cut-share", type=float, default=0.16, help="most of the figure the cuts may remove (designer median 0.064, upper quartile about 0.08)"); c.add_argument("--no-ground", action="store_true"); c.add_argument("--tolerance", type=float, default=None, help="how far the built outline may sit from the animal, as a share of its size (default: trained value)"); c.set_defaults(f=combine)
    a = ap.parse_args(); a.f(a)
