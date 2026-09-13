#!/usr/bin/env python3
"""Inference-only SAM 3.1 detector pilot; never writes reviewed labels.

Run inside the pinned official SAM environment with a prepared manifest/images
folder. Reference corners are used only after inference to report agreement.
"""
import argparse
import gc
import hashlib
import json
from pathlib import Path
import time

import cv2
import numpy as np
from PIL import Image, ImageDraw
from scipy.optimize import linear_sum_assignment


def digest(path):
    h = hashlib.sha256()
    with Path(path).open('rb') as stream:
        for chunk in iter(lambda: stream.read(1 << 20), b''):
            h.update(chunk)
    return h.hexdigest()


def reference_agreement(masks, cards, width, height):
    """Mask/full-outline agreement, NOT visible-mask accuracy on occluded cards."""
    truth = []
    for card in cards:
        mask = np.zeros((height, width), dtype=np.uint8)
        quad = np.rint(np.array(card['quad']) * [width, height]).astype(np.int32)
        cv2.fillConvexPoly(mask, quad, 1)
        truth.append(mask.astype(bool))
    matrix = np.zeros((len(truth), len(masks)))
    for i, a in enumerate(truth):
        for j, b in enumerate(masks):
            union = np.count_nonzero(a | b)
            matrix[i, j] = np.count_nonzero(a & b) / union if union else 0
    # Prefer more >= .50 matches before optimizing overlap quality.
    rr, cc = linear_sum_assignment(-((matrix >= .5).astype(float) * (len(truth) + 1) + matrix))
    assignments = [{'card': int(i + 1), 'mask': int(j + 1), 'fullOutlineIoU': float(matrix[i, j])} for i, j in zip(rr, cc)]
    matched = sum(r['fullOutlineIoU'] >= .5 for r in assignments)
    return dict(cards=len(cards), masks=len(masks), matchedAt50=matched,
                unmatchedCards=len(cards)-matched, extraMasks=len(masks)-matched, assignments=assignments)


def four_corner_draft(mask):
    """Accept a contour only if simplification naturally has four convex vertices."""
    contours, _ = cv2.findContours(mask.astype(np.uint8), cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if not contours:
        return None
    contour = max(contours, key=cv2.contourArea)
    approx = cv2.approxPolyDP(contour, .015 * cv2.arcLength(contour, True), True)
    if len(approx) != 4 or not cv2.isContourConvex(approx):
        return None
    points = approx[:, 0, :].astype(float)
    signed = sum(np.cross(points[i], points[(i+1) % 4]) for i in range(4))
    if signed < 0:
        points = points[::-1]
    points = np.roll(points, -int(np.argmin(points.sum(axis=1))), axis=0)
    return (points / [mask.shape[1], mask.shape[0]]).tolist()


def build_sam31_detector():
    """Use the official 3.1 detector construction, without allocating its tracker.

    SAM 3's ordinary image builder has a different vision neck and cannot load
    the SAM 3.1 checkpoint. This matches build_sam3_multiplex_video_predictor's
    detector section in the pinned source revision, including the TriHead neck.
    """
    import sam3
    from sam3 import model_builder as b
    from sam3.model.sam3_multiplex_detector import Sam3MultiplexDetector
    from sam3.model.vl_combiner import SAM3VLBackboneTri
    tokenizer = str(Path(sam3.__file__).parent / 'assets/bpe_simple_vocab_16e6.txt.gz')
    backbone = SAM3VLBackboneTri(scalp=0, visual=b._create_multiplex_tri_backbone(), text=b._create_text_encoder(tokenizer))
    return Sam3MultiplexDetector(num_feature_levels=1, backbone=backbone,
        transformer=b._create_sam3_transformer(), segmentation_head=b._create_segmentation_head(),
        semantic_segmentation_head=None, input_geometry_encoder=b._create_geometry_encoder(),
        use_early_fusion=True, use_dot_prod_scoring=True, dot_prod_scoring=b._create_dot_product_scoring(),
        supervise_joint_box_scores=True, is_multiplex=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--inputs', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    manifest = json.loads((args.inputs / 'manifest.json').read_text())
    args.output.mkdir(parents=True, exist_ok=True)
    import torch
    from huggingface_hub import hf_hub_download
    from sam3.model.sam3_image_processor import Sam3Processor
    assert torch.cuda.is_available(), 'This pilot requires the supported CUDA runtime'
    pins = manifest['pins']
    ckpt_info = pins['checkpoint'][0]
    ckpt = hf_hub_download('facebook/sam3.1', ckpt_info['filename'], revision=pins['modelRevision'])
    assert digest(ckpt) == ckpt_info['sha256'], 'Checkpoint hash differs'
    model = build_sam31_detector()
    weights = torch.load(ckpt, map_location='cpu', weights_only=True)
    weights = weights.get('model', weights)
    detector = {k.removeprefix('detector.'): v for k, v in weights.items() if k.startswith('detector.')}
    if not detector:
        detector = {k.removeprefix('sam3_model.'): v for k, v in weights.items() if k.startswith('sam3_model.')}
    # A new model must not run with silently random or missing parameters.
    model.load_state_dict(detector, strict=True)
    del weights, detector
    gc.collect()
    model.cuda().eval()
    processor = Sam3Processor(model, device='cuda', confidence_threshold=manifest['confidenceThreshold'])
    results = dict(schema='tcger-sam31-card-pilot/v1', pins=pins, manifestSha256=digest(args.inputs / 'manifest.json'), scriptSha256=digest(__file__),
                   mode='SAM 3.1 checkpoint image detector; no video tracking and no training',
                   metric='Predicted visible mask agreement with saved full-outline polygon; occluded cards are not visible-mask ground truth',
                   promotionEligible=False, results=[])
    colors = [(104, 230, 179), (241, 147, 91), (110, 175, 255), (242, 126, 190), (223, 214, 105)]
    for photo in manifest['photos']:
        path = args.inputs / photo['path']
        assert digest(path) == photo['sha256'], photo['id']
        image = Image.open(path).convert('RGB')
        torch.cuda.synchronize(); start = time.monotonic()
        with torch.inference_mode(), torch.autocast('cuda', dtype=torch.bfloat16):
            state = processor.set_image(image)
            for prompt in manifest['prompts']:
                processor.reset_all_prompts(state)
                output = processor.set_text_prompt(prompt=prompt, state=state)
                masks = output['masks'][:, 0].cpu().numpy().astype(bool)
                scores = output['scores'].float().cpu().tolist()
                boxes = output['boxes'].float().cpu().tolist()
                slug = photo['id'] + '-' + prompt.replace(' ', '-')
                folder = args.output / slug; folder.mkdir(exist_ok=True)
                mask_rows = []
                overlay = np.array(image).copy()
                for index, (mask, score, box) in enumerate(zip(masks, scores, boxes), 1):
                    name = f'mask-{index}.png'; Image.fromarray(mask.astype(np.uint8)*255).save(folder / name)
                    overlay[mask] = (.5 * overlay[mask] + .5 * np.array(colors[(index-1) % len(colors)])).astype(np.uint8)
                    mask_rows.append(dict(mask=name, score=score, box=box, draftQuad=four_corner_draft(mask), orientationKnown=False))
                preview = Image.fromarray(overlay); draw = ImageDraw.Draw(preview)
                for card in photo['cards']:
                    points = [(x*image.width, y*image.height) for x, y in card['quad']]
                    draw.line(points + points[:1], fill='white', width=3)
                preview.save(folder / 'overlay.jpg', quality=90)
                agreement = reference_agreement(masks, photo['cards'], image.width, image.height)
                torch.cuda.synchronize()
                row = dict(photoId=photo['id'], prompt=prompt, folder=slug, predictions=mask_rows,
                           agreement=agreement, elapsedSinceImageStart=time.monotonic()-start)
                results['results'].append(row)
                (args.output / 'results.json').write_text(json.dumps(results, indent=2))
                print(json.dumps({k: row[k] for k in ['photoId', 'prompt', 'agreement', 'elapsedSinceImageStart']}), flush=True)
        del state, output
        torch.cuda.empty_cache()
    results['complete'] = True
    results['peakGpuAllocatedBytes'] = torch.cuda.max_memory_allocated()
    (args.output / 'results.json').write_text(json.dumps(results, indent=2))
    print('SAM31_CARD_PILOT_COMPLETE', flush=True)


if __name__ == '__main__':
    main()
