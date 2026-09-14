#!/usr/bin/env python3
"""Select a saved epoch using only the declared training release's validation.

Keep framework best.pt unchanged. Independent evaluation must explicitly load
the hash-bound selection; no test release is accepted by this interface.
"""
import argparse
from collections import defaultdict
from dataclasses import replace
import json
from pathlib import Path
import statistics

from benchmark_geometry import evaluate, load_predictions, load_release
from corpus_release import load_json, sha256_file, write_json
from evaluate_geometry_candidate import Predictor, DECODER_CONFIG, EVALUATION_CONTRACT
from select_geometry_checkpoint import validation_coverage

POLICY='validation-geometry-balanced-v1'
SHORTLIST=['epoch9.pt','epoch19.pt','epoch29.pt','epoch39.pt','epoch49.pt','best.pt','last.pt']
REAL_FIRST_POLICY='validation-real-weighted-guarded-v2'
EPOCH_SHORTLIST=SHORTLIST[:5]
EXTRAS_MARGIN_PER_PHOTO=0.05
SYNTHETIC_SCORE_MARGIN=0.02


def source_metrics(metrics):
    groups=defaultdict(list)
    for name,row in metrics['detection']['bySceneSlice'].items():
        if row['truthInstances']:
            groups[name.split(':',1)[0]].append(row)
    if set(groups) != {'real','synthetic'}:
        raise ValueError('Selection requires real and synthetic validation')
    result={}
    for name,rows in groups.items():
        scores=[]
        for row in rows:
            n=row['truthInstances']; found=row['matches']
            f1=2*found/(n+found+row['extra']+row['duplicate'])
            tight=row['recall@0.9']
            scores.append(2*f1*tight/(f1+tight) if f1+tight else 0)
        photos=sum(r['records'] for r in rows)
        if photos <= 0:
            raise ValueError('Invalid validation photo denominator')
        result[name]=dict(score=statistics.mean(scores),photos=photos,
            targets=sum(r['truthInstances'] for r in rows),
            extrasPerPhoto=sum(r['extra']+r['duplicate'] for r in rows)/photos)
    return result


def choose_guarded(rows):
    if not rows or len({r['id'] for r in rows}) != len(rows):
        raise ValueError('Empty or duplicate checkpoint IDs')
    if any(r['id'] not in {Path(p).stem for p in EPOCH_SHORTLIST} for r in rows):
        raise ValueError('Guarded selection accepts only predeclared epoch snapshots')
    for kind in ('real','synthetic'):
        if len({(r['sources'][kind]['photos'],r['sources'][kind]['targets']) for r in rows}) != 1:
            raise ValueError('Validation denominators differ')
    extras_limit=statistics.median(r['sources']['real']['extrasPerPhoto'] for r in rows)+EXTRAS_MARGIN_PER_PHOTO
    synthetic_floor=statistics.median(r['sources']['synthetic']['score'] for r in rows)-SYNTHETIC_SCORE_MARGIN
    eligible=[r for r in rows if r['sources']['real']['extrasPerPhoto'] <= extras_limit
              and r['sources']['synthetic']['score'] >= synthetic_floor]
    if not eligible:
        raise ValueError('No checkpoint passes the declared validation guards')
    best=max(r['score'] for r in eligible)
    winner=max((r for r in eligible if best-r['score'] <= 1e-9),key=lambda r:int(r['id'][5:]))
    return winner,dict(realExtrasLimitPerPhoto=extras_limit,syntheticScoreFloor=synthetic_floor,
        eligibleIds=[r['id'] for r in eligible],excludedIds=[r['id'] for r in rows if r not in eligible])


def quality(metrics):
    """Balance source kinds, then scenes; penalize misses and extra detections."""
    groups=defaultdict(list)
    for name,row in metrics['detection']['bySceneSlice'].items():
        count=row['truthInstances']
        if not count:
            continue
        found=row['matches']
        predictions=found+row['extra']+row['duplicate']
        detection_f1=2*found/(count+predictions) if count+predictions else 0
        tight=row['recall@0.9']
        balanced=2*detection_f1*tight/(detection_f1+tight) if detection_f1+tight else 0
        groups[name.split(':',1)[0]].append(balanced)
    if set(groups) != {'real','synthetic'}:
        raise ValueError('Selection requires both real and synthetic validation')
    return statistics.mean(statistics.mean(v) for v in groups.values())


def choose(rows):
    if not rows or len({r['id'] for r in rows}) != len(rows):
        raise ValueError('Empty or duplicate checkpoint IDs')
    return sorted(rows,key=lambda r:(-r['score'],r['shortlistIndex']))[0]


def select(release,output,resolution=640,device='cuda',selection_policy=POLICY):
    if selection_policy not in (POLICY,REAL_FIRST_POLICY):
        raise ValueError('Unknown checkpoint selection policy')
    guarded=selection_policy == REAL_FIRST_POLICY
    manifest,policy,all_truths=load_release(release)
    if manifest['releasePurpose']!='training' or any(e['split'] not in ('train','validation') for e in manifest['records']):
        raise ValueError('Selection accepts a training/validation release, never a test release')
    coverage=validation_coverage(release)
    if not coverage['orientationSelectionReady']:
        raise ValueError('Real known-orientation and sideways validation coverage is required')
    truths_by_record=defaultdict(list)
    for t in all_truths:truths_by_record[t.record_id].append(t)
    entries=[e for e in manifest['records'] if e['split']=='validation' and truths_by_record[e['recordId']]
             and all(t.geometry_source=='quad' for t in truths_by_record[e['recordId']])]
    ids={e['recordId'] for e in entries}
    # An unannotated box-only card would otherwise become a misleading extra.
    selected_manifest={**manifest,'records':[{**e,'sceneSlice':e['leakageKeys']['sourceKind']+':'+e['sceneSlice']} for e in entries]}
    truths=[replace(t,scene_slice=t.source_kind+':'+t.scene_slice) for t in all_truths if t.record_id in ids]
    weights=output/'training/repeat-0/weights'
    destination=output/'validation-selection'
    destination.mkdir(exist_ok=False)
    candidates=[];seen=set()
    for index,name in enumerate(EPOCH_SHORTLIST if guarded else SHORTLIST):
        path=weights/name
        if not path.is_file():raise ValueError(f'Missing declared checkpoint: {name}')
        digest=sha256_file(path)
        if digest in seen:continue
        seen.add(digest)
        candidates.append(dict(id=path.stem,checkpoint=str(path.relative_to(output)),checkpointSha256=digest,shortlistIndex=index))
    protocol=dict(schema='tcger-training-validation-selection/v1',policy=selection_policy,
        corpusHash=manifest['corpusHash'],manifestSha256=sha256_file(release/'manifest.json'),
        validationCoverage=coverage,eligibleFrames=len(entries),excludedValidationFrames=sum(e['split']=='validation' for e in manifest['records'])-len(entries),
        eligibility='Validation frames with every target having four known corners, chosen before inference.',
        recordIds=sorted(ids),candidates=candidates,resolution=resolution,decoder=DECODER_CONFIG,evaluationContract=EVALUATION_CONTRACT,
        ranking='Per scene harmonic mean of detection F1 at IoU .50 and tight recall at IoU .90; average scenes within each source kind, then equally average real and synthetic. Ties prefer earlier declared shortlist entry.',
        testDataUsed=False,sourceSha256=sha256_file(Path(__file__)))
    if guarded:
        protocol['ranking']='Five epoch snapshots only; same scene-balanced harmonic detection F1/tight recall, real:synthetic weighted 2:1. Exclude real extras+duplicates/photo > shortlist median +0.05 or synthetic score < median -0.02. Score ties within 1e-9 prefer later epoch.'
    write_json(destination/'protocol.json',protocol)
    rows=[]
    for candidate in candidates:
        checkpoint=output/candidate['checkpoint']
        predictor=Predictor('yolo11s-pose',output,candidate['checkpointSha256'],resolution,device,checkpoint)
        predictor.model.to(device)
        prediction_path=destination/(candidate['id']+'.predictions.jsonl')
        with prediction_path.open('w') as handle:
            for entry in entries:
                record=load_json(release/entry['path'])
                row=dict(recordId=entry['recordId'],localizerId=candidate['id'],results=predictor(release/record['source']['path']))
                handle.write(json.dumps(row,separators=(',',':'))+'\n')
        _,predictions=load_predictions(prediction_path,ids)
        metrics=evaluate(manifest=selected_manifest,policy=policy,truths=truths,prediction_rows=predictions)
        metrics_path=destination/(candidate['id']+'.metrics.json')
        write_json(metrics_path,metrics)
        sources=source_metrics(metrics) if guarded else None
        score=(2*sources['real']['score']+sources['synthetic']['score'])/3 if guarded else quality(metrics)
        rows.append({**candidate,'score':score,'predictionsSha256':sha256_file(prediction_path),'metricsSha256':sha256_file(metrics_path),
                     **({'sources':sources} if guarded else {})})
        print(json.dumps(rows[-1]),flush=True)
        del predictor
    winner,guards=choose_guarded(rows) if guarded else (choose(rows),None)
    result=dict(schema='tcger-validation-selected-checkpoint/v1',policy=selection_policy,
        selected=winner,candidates=rows,protocolSha256=sha256_file(destination/'protocol.json'),
        productionPromotion=False,testDataUsed=False,**({'guards':guards} if guarded else {}))
    write_json(destination/'selection.json',result)
    return result


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--release',type=Path,required=True)
    parser.add_argument('--output',type=Path,required=True)
    parser.add_argument('--device',default='cuda')
    parser.add_argument('--policy',choices=(POLICY,REAL_FIRST_POLICY),default=POLICY)
    args=parser.parse_args()
    print(json.dumps(select(args.release,args.output,device=args.device,selection_policy=args.policy),indent=2))
