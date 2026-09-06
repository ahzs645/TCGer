#!/usr/bin/env python3
"""Diagnose historical checkpoints on byte-verified training records.

This produces a diagnostic report, never a passing release benchmark or a
training authorization. It deliberately does not score any evaluation split.
"""

from __future__ import annotations

import argparse
import io
import json
from collections import defaultdict
from pathlib import Path

from PIL import Image

import evaluate_geometry_candidate as inference
from benchmark_geometry import Truth, _truth_geometry, _geometry_source, evaluate
from corpus_release import canonical_json, sha256_bytes, corpus_hash
from train_yolo_pose import load_json, sha256_file
from training_geometry import context_margins, context_policy_from_environment


def select_entries(manifest: dict, per_scene: int | None) -> list[dict]:
    groups = defaultdict(list)
    for entry in manifest['records']:
        if entry['split'] == 'train':
            groups[entry['sceneSlice']].append(entry)
    return [entry for scene in sorted(groups)
            for entry in sorted(groups[scene], key=lambda e: sha256_bytes(e['recordId'].encode()))[:per_scene]]


def run(release: Path, output: Path, candidate: str, checkpoint: Path,
        checkpoint_sha256: str, expected_corpus_hash: str, device: str,
        per_scene: int | None = 32, real_context_policy: dict | None = None,
        minimum_matches: int | None = None) -> dict:
    manifest = load_json(release/'manifest.json')
    if manifest['corpusHash'] != expected_corpus_hash or corpus_hash(manifest) != expected_corpus_hash:
        raise ValueError('historical corpus hash mismatch')
    if sha256_file(checkpoint) != checkpoint_sha256:
        raise ValueError('historical checkpoint hash mismatch')
    entries = select_entries(manifest,per_scene)
    if not entries:
        raise ValueError('no training records selected')
    policy_path = release/manifest['readiness']['readinessPolicyPath']
    if sha256_file(policy_path) != manifest['readiness']['readinessPolicySha256']:
        raise ValueError('historical policy hash mismatch')
    predictor = inference.Predictor(candidate,output,checkpoint_sha256,640,device=device)
    truths, predictions, identities = [], {}, []
    original_margin = inference.CONTEXT_MARGIN
    try:
        for entry in entries:
            record_path = release/entry['path']
            if sha256_file(record_path) != entry['sha256']:
                raise ValueError('training record hash mismatch')
            record=load_json(record_path)
            image_path=release/record['source']['path']
            if sha256_file(image_path) != record['source']['sha256']:
                raise ValueError('training image hash mismatch')
            margins=context_margins(record,real_context_policy)
            inference.CONTEXT_MARGIN=margins
            image,width,height=inference.padded_image(image_path)
            # Reproduce the exact JPEG materialization used by the trainers.
            encoded=io.BytesIO()
            image.save(encoded,format='JPEG',quality=95,optimize=False,progressive=False)
            encoded.seek(0)
            with Image.open(encoded) as opened:
                image=opened.convert('RGB')
            raw = (predictor.predict_fastvit(image,width,height) if candidate.startswith('fastvit')
                   else predictor.predict_yolox(image,width,height))
            predictions[entry['recordId']]=inference.process_candidates(
                raw,inference.DECODER_CONFIG,{'releaseVersion':1,'artifactSha256':checkpoint_sha256})
            for index,instance in enumerate(record['instances']):
                truths.append(Truth(entry['recordId'],index,entry['sceneSlice'],record['source']['kind'],
                                    width,height,instance,_truth_geometry(instance),_geometry_source(instance)))
            identities.append({'recordId':entry['recordId'],'recordSha256':entry['sha256'],
                               'imageSha256':record['source']['sha256'],'contextMargins':margins})
            if len(identities) % 250 == 0:
                print(f'TRAIN_SELF_EVALUATION_PROGRESS={len(identities)}/{len(entries)}',flush=True)
    finally:
        inference.CONTEXT_MARGIN=original_margin
    policy=load_json(policy_path)
    metrics=evaluate(manifest={**manifest,'records':entries},policy=policy,truths=truths,prediction_rows=predictions)
    report={'schema':'https://tcger.app/reports/historical-train-split-diagnostic/v1',
            'diagnosticOnly':True,'candidate':candidate,'sourceCorpusHash':expected_corpus_hash,
            'checkpointSha256':checkpoint_sha256,'device':device,
            'realContextMarginPolicy':real_context_policy,
            'selection':{'split':'train','perScene':per_scene,'ordering':'sha256(recordId)',
                         'allTrainingRecords':per_scene is None,
                         'records':len(entries),'sampleHash':sha256_bytes(canonical_json(identities))},
            'inputHashes':identities,'metrics':metrics}
    if minimum_matches is not None:
        report['gate'] = training_match_gate(metrics, minimum_matches)
    output.mkdir(parents=True,exist_ok=True)
    (output/'train-self-evaluation.json').write_text(json.dumps(report,indent=2,sort_keys=True)+'\n')
    with (output/'train-self-predictions.jsonl').open('w') as handle:
        for record_id,results in predictions.items():
            handle.write(json.dumps({'recordId':record_id,'localizerId':candidate,'results':results})+'\n')
    if report.get('gate', {}).get('failedChecks'):
        raise ValueError('TRAIN_SELF_EVALUATION failed: insufficient matched training instances')
    return report


def training_match_gate(metrics: dict, minimum_matches: int) -> dict:
    matches = metrics['detection']['overall']['matches']
    return {'minimumMatches':minimum_matches,'matches':matches,
            'failedChecks':[] if matches >= minimum_matches else ['TRAIN_SELF_EVALUATION'],
            'meaning':'Nonzero fitting sanity check; not a held-out quality or deployment gate'}


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--release',type=Path,required=True)
    parser.add_argument('--output',type=Path,required=True)
    parser.add_argument('--candidate',choices=['fastvit-t8-four-corner','yolox-pose'],required=True)
    parser.add_argument('--checkpoint',type=Path,required=True)
    parser.add_argument('--checkpoint-sha256',required=True)
    parser.add_argument('--corpus-hash',required=True)
    parser.add_argument('--device',default='cuda')
    parser.add_argument('--per-scene',type=int,default=32)
    parser.add_argument('--all-training-records',action='store_true')
    parser.add_argument('--minimum-matches',type=int)
    args=parser.parse_args()
    if args.per_scene < 1:
        parser.error('--per-scene must be positive')
    if args.minimum_matches is not None and args.minimum_matches < 1:
        parser.error('--minimum-matches must be positive')
    report=run(args.release,args.output,args.candidate,args.checkpoint,args.checkpoint_sha256,
               args.corpus_hash,args.device,None if args.all_training_records else args.per_scene,
               context_policy_from_environment(),args.minimum_matches)
    print(json.dumps({'selection':report['selection'],'detection':report['metrics']['detection']},sort_keys=True))


if __name__ == '__main__':
    main()
