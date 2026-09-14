#!/usr/bin/env python3
"""Evaluate pinned saved checkpoints on frozen releases without training or label edits."""
import argparse
from collections import defaultdict
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import time

import numpy as np

from benchmark_geometry import benchmark, load_predictions, load_release, _iou, _prediction
from evaluate_geometry_candidate import (
    CONTEXT_MARGIN, DECODER_CONFIG, EVALUATION_CONTRACT, FOUR_WAY_POLICY,
    Predictor, evaluate_recognition_replay,
)
from report_session_iou import assigned_overlap, distribution


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def read(path):
    return json.loads(path.read_text())


def write(path, value):
    temporary = path.with_name(path.name + '.tmp')
    temporary.write_text(json.dumps(value, indent=2) + '\n')
    temporary.replace(path)


def human_corners(truth):
    corners = truth.instance.get('corners', [])
    return len(corners) == 4 and all(c.get('coordinateKnown') and c.get('cornerSource') == 'human' for c in corners)


def summarize_overlaps(truths, predictions):
    """Assign across the full photo before computing annotation-quality slices."""
    grouped = defaultdict(list)
    for truth in truths:
        if truth.geometry is not None:
            grouped[truth.record_id].append(truth)
    rows = []
    for record_id, targets in grouped.items():
        candidates = [_prediction(value, index) for index, value in enumerate(predictions[record_id])]
        matrix = np.zeros((len(targets), len(candidates)))
        for i, truth in enumerate(targets):
            for j, prediction in enumerate(candidates):
                matrix[i, j] = _iou(truth, prediction)
        values, assignments = assigned_overlap(matrix)
        for index, truth in enumerate(targets):
            rows.append(dict(recordId=record_id, instanceIndex=truth.instance_index,
                             scene=truth.scene_slice, geometrySource=truth.geometry_source,
                             humanCorners=human_corners(truth), sourceKind=truth.source_kind,
                             iou=values[index], prediction=assignments[index]))
    def summary(items):
        if not items:
            return None
        by_photo = defaultdict(list)
        for row in items:
            by_photo[row['recordId']].append(row['iou'])
        return {**distribution([row['iou'] for row in items]),
                'photos': len(by_photo),
                'photoBalancedMean': float(np.mean([np.mean(v) for v in by_photo.values()]))}
    return dict(assignment='Maximum-total-IoU one-to-one assignment before slicing, no cutoff, unassigned targets zero. Separate from the original benchmark matcher.',
                all=summary(rows), humanCorners=summary([r for r in rows if r['humanCorners']]),
                otherReferences=summary([r for r in rows if not r['humanCorners']]), rows=rows)


def evaluate_one(protocol_path, identifier, output):
    import torch
    protocol = read(protocol_path)
    source = Path(protocol['sourceRoot'])
    for relative, digest in protocol['sourceHashes'].items():
        if sha(source / relative) != digest:
            raise ValueError('Frozen source changed: ' + relative)
    model = protocol['checkpoints'][identifier]
    checkpoint = Path(model['path'])
    if sha(checkpoint) != model['sha256']:
        raise ValueError('Checkpoint hash mismatch')
    output.mkdir(parents=True, exist_ok=True)
    receipt = output / 'verification.json'
    if receipt.exists():
        result = read(receipt)
        if result['protocolSha256'] != sha(protocol_path):
            raise ValueError('Existing output has a different protocol')
        for relative, digest in result['files'].items():
            if sha(output / relative) != digest:
                raise ValueError('Completed output changed: ' + relative)
        return result
    own_protocol = output / 'protocol.json'
    declared = dict(protocolSha256=sha(protocol_path), checkpoint=model,
                    device='cpu', threads=protocol['threads'], resolution=640,
                    decoder=DECODER_CONFIG, colorContract=EVALUATION_CONTRACT, contextMargin=CONTEXT_MARGIN)
    if own_protocol.exists() and read(own_protocol) != declared:
        raise ValueError('Refusing to mix protocols in a partial evaluation')
    write(own_protocol, declared)
    torch.set_num_threads(protocol['threads'])
    predictor = Predictor('yolo11s-pose', checkpoint.parent, model['sha256'], 640,
                          device='cpu', checkpoint_path=checkpoint)
    predictor.model.to('cpu')
    started = time.monotonic()
    for name, spec in protocol['releases'].items():
        root = Path(spec['path'])
        if sha(root / 'manifest.json') != spec['manifestSha256']:
            raise ValueError('Release manifest changed')
        manifest, policy, truths = load_release(root)
        if manifest['corpusHash'] != spec['corpusHash']:
            raise ValueError('Release corpus changed')
        rows_path = output / (name + '.predictions.jsonl')
        rows = [json.loads(line) for line in rows_path.read_text().splitlines()] if rows_path.exists() else []
        expected = [e['recordId'] for e in manifest['records']]
        if [row['recordId'] for row in rows] != expected[:len(rows)] or any(row['localizerId'] != identifier for row in rows):
            raise ValueError('Invalid partial prediction prefix')
        with rows_path.open('a') as handle:
            for index, entry in enumerate(manifest['records']):
                if index < len(rows):
                    continue
                path = root / entry['path']
                if sha(path) != entry['sha256']:
                    raise ValueError('Record changed')
                record = read(path)
                image = root / record['source']['path']
                if sha(image) != record['source']['sha256']:
                    raise ValueError('Image changed')
                row = dict(recordId=entry['recordId'], localizerId=identifier, results=predictor(image))
                handle.write(json.dumps(row, separators=(',', ':')) + '\n'); handle.flush()
                if (index + 1) % 50 == 0:
                    progress = dict(checkpoint=identifier, release=name, processed=index+1,
                                    expected=len(expected), elapsedSeconds=time.monotonic()-started)
                    write(output / 'progress.json', progress)
                    print(json.dumps(progress), flush=True)
        report = benchmark(release_root=root, predictions_path=rows_path,
                           expected_corpus_hash=spec['corpusHash'], tooling_revision=protocol['sourceRevision'])
        write(output / (name + '.benchmark.json'), report)
        _, predictions = load_predictions(rows_path, set(expected))
        write(output / (name + '.overlap.json'), summarize_overlaps(truths, predictions))
    del predictor
    models_root = Path(protocol['recognitionModelsRoot'])
    for relative, digest in protocol['recognitionFileHashes'].items():
        if sha(models_root / relative) != digest:
            raise ValueError('Recognition asset changed')
    real_root = Path(protocol['releases']['real']['path'])
    if sha(real_root / 'recognition-replay.json') != protocol['recognitionReplaySha256']:
        raise ValueError('Recognition replay changed')
    recognition = evaluate_recognition_replay(
        release=real_root, predictions_path=output / 'real.predictions.jsonl',
        models_root=models_root, output=output / 'recognition-replay.json',
        orientation_policy=FOUR_WAY_POLICY)
    files = [p for p in output.iterdir() if p.is_file() and p.name not in ['verification.json', 'progress.json']]
    result = dict(passed=True, protocolSha256=sha(protocol_path), checkpointSha256=sha(checkpoint),
                  completedAt=datetime.now(timezone.utc).isoformat(), elapsedSeconds=time.monotonic()-started,
                  files={p.name: sha(p) for p in files}, recognition=recognition['counts'],
                  sourceLabelChanges=False, productionPromotion=False)
    write(receipt, result)
    print(json.dumps(result), flush=True)
    return result


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--protocol', type=Path, required=True)
    parser.add_argument('--checkpoint-id', required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    evaluate_one(args.protocol, args.checkpoint_id, args.output)
