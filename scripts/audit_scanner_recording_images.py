#!/usr/bin/env python3
"""Audit historical input/original pairs and make an isolated original-only fixture.

Historical exports lack the input crop rectangle. Recover it by full-resolution
pixel registration, require correlation >= 0.99, and measure reconstruction
error. These inferred recipes are diagnostic fixtures, not captured metadata or
new human labels. Never edits the source session. Requires Pillow/numpy/OpenCV.
"""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import shutil

import cv2
import numpy as np
from PIL import Image

from scanner_recording_images import load_input_image


def hashes(directory):
    return {str(p.relative_to(directory)): hashlib.sha256(p.read_bytes()).hexdigest()
            for p in sorted(directory.rglob('*')) if p.is_file()}


def audit(source: Path, output: Path):
    if output.exists():
        raise ValueError('Choose a new output directory; existing data is never overwritten')
    before = hashes(source)
    bundle = json.loads((source / 'results.json').read_text())
    evidence = json.loads((source / 'evidence.json').read_text())
    by_image = {r['imageFile']: r for r in evidence}
    rows = []
    saved_bytes = 0
    for frame in bundle['frames']:
        record = by_image[frame['imageFile']]
        original_file = record.get('originalImageFile')
        if not original_file:
            raise ValueError(f"No original for {frame['imageFile']}")
        original = np.asarray(Image.open(source / original_file).convert('RGB'))
        cropped = np.asarray(Image.open(source / frame['imageFile']).convert('RGB'))
        height, width = cropped.shape[:2]
        response = cv2.matchTemplate(cv2.cvtColor(original, cv2.COLOR_RGB2GRAY),
                                     cv2.cvtColor(cropped, cv2.COLOR_RGB2GRAY),
                                     cv2.TM_CCOEFF_NORMED)
        _, confidence, _, (x, y) = cv2.minMaxLoc(response)
        if confidence < 0.99:
            raise ValueError(f"Ambiguous registration for {frame['imageFile']}: {confidence}")
        recipe = {'version': 1, 'sourceImageFile': original_file,
                  'coordinateSpace': 'uprightPixelsTopLeft',
                  'sourcePixelWidth': original.shape[1], 'sourcePixelHeight': original.shape[0],
                  'cropRectPixels': [x, y, width, height]}
        restored = original[y:y+height, x:x+width]
        difference = np.abs(restored.astype(np.int16) - cropped.astype(np.int16))
        frame['inputImageTransform'] = recipe
        record['inputImageTransform'] = recipe
        rows.append({'imageFile': frame['imageFile'], 'cropRectPixels': recipe['cropRectPixels'],
                     'registrationCorrelation': confidence,
                     'meanAbsolutePixelDifference': float(difference.mean()),
                     'p95AbsolutePixelDifference': float(np.percentile(difference, 95))})
        saved_bytes += (source / frame['imageFile']).stat().st_size
    output.mkdir(parents=True)
    for name in {r['originalImageFile'] for r in evidence}:
        shutil.copy2(source / name, output / name)
    (output / 'results.json').write_text(json.dumps(bundle, indent=2) + '\n')
    (output / 'evidence.json').write_text(json.dumps(evidence, indent=2) + '\n')
    for frame in bundle['frames']:
        restored = load_input_image(output, frame)
        x, y, width, height = frame['inputImageTransform']['cropRectPixels']
        original = Image.open(source / frame['inputImageTransform']['sourceImageFile']).convert('RGB')
        np.testing.assert_array_equal(restored, original.crop((x, y, x+width, y+height)))
    after = hashes(source)
    if before != after:
        raise RuntimeError('Source session changed during audit')
    source_bytes = sum((source / name).stat().st_size for name in before)
    output_bytes = sum(p.stat().st_size for p in output.iterdir() if p.is_file())
    report = {'source': str(source), 'fixture': str(output),
              'recipeProvenance': 'inferred_by_pixel_registration_for_reconstruction_test_only',
              'sourceUnchanged': True, 'sourceHashes': before, 'framesVerified': len(rows),
              'sourceBytes': source_bytes, 'fixtureBytes': output_bytes,
              'removedInputJPEGBytes': saved_bytes, 'netBytesSaved': source_bytes-output_bytes,
              'minimumRegistrationCorrelation': min(r['registrationCorrelation'] for r in rows),
              'meanFramePixelDifference': float(np.mean([r['meanAbsolutePixelDifference'] for r in rows])),
              'maximumFramePixelDifference': max(r['meanAbsolutePixelDifference'] for r in rows),
              'frames': rows}
    report_path = output.parent / (output.name + '-audit.json')
    report_path.write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps({k: v for k, v in report.items() if k not in ['frames', 'sourceHashes']}, indent=2))
    print(f'Audit: {report_path}')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('source', type=Path)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    audit(args.source.resolve(), args.output.resolve())
