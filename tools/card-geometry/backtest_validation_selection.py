#!/usr/bin/env python3
"""Backtest a predeclared validation rule without selecting on test metrics."""
import argparse
from pathlib import Path
import json
import torch

from corpus_release import load_json, sha256_file, write_json
from select_training_validation import EPOCH_SHORTLIST, REAL_FIRST_POLICY, source_metrics, choose_guarded
from evaluate_geometry_candidate import Predictor, DECODER_CONFIG, EVALUATION_CONTRACT
from benchmark_geometry import benchmark


def backtest(training_output, release, output):
    output.mkdir(parents=True, exist_ok=True)
    original=load_json(training_output/'validation-selection/selection.json')
    selection_protocol=training_output/'validation-selection/protocol.json'
    if sha256_file(selection_protocol) != original['protocolSha256'] or original['testDataUsed']:
        raise ValueError('Original selection provenance failed')
    candidates=[]
    for row in original['candidates']:
        if row['id']+'.pt' not in EPOCH_SHORTLIST:
            continue
        metrics_path=training_output/'validation-selection'/(row['id']+'.metrics.json')
        if sha256_file(metrics_path) != row['metricsSha256'] or sha256_file(training_output/row['checkpoint']) != row['checkpointSha256']:
            raise ValueError('Saved shortlist hash mismatch')
        sources=source_metrics(load_json(metrics_path))
        candidates.append({**row,'sources':sources,'score':(2*sources['real']['score']+sources['synthetic']['score'])/3})
    if len(candidates) != 5:
        raise ValueError('The complete five-epoch shortlist is required')
    selected,guards=choose_guarded(candidates)
    declared=dict(policy=REAL_FIRST_POLICY,validationSelected=selected,guards=guards,candidates=candidates,
        selectionData='training validation only',testDataUsedForSelection=False,
        benchmarkManifestSha256=sha256_file(release/'manifest.json'),decoder=DECODER_CONFIG,evaluationContract=EVALUATION_CONTRACT,
        sourceSha256=sha256_file(Path(__file__)),selectorSha256=sha256_file(Path(__file__).with_name('select_training_validation.py')))
    declaration=output/'declaration.json'
    if declaration.exists() and load_json(declaration) != declared:
        raise ValueError('A different backtest already exists here')
    write_json(declaration,declared)  # Chosen before loading any test scores.
    manifest=load_json(release/'manifest.json'); torch.set_num_threads(2)
    results=[]
    for row in candidates:
        checkpoint=training_output/row['checkpoint']
        predictions=output/(row['id']+'.predictions.jsonl')
        prefix=[json.loads(s) for s in predictions.read_text().splitlines()] if predictions.exists() else []
        if [s['recordId'] for s in prefix] != [e['recordId'] for e in manifest['records'][:len(prefix)]]:
            raise ValueError('Invalid saved prediction prefix')
        predictor=Predictor('yolo11s-pose',output,row['checkpointSha256'],640,'cpu',checkpoint)
        predictor.model.to('cpu')
        with predictions.open('a') as f:
            for i,entry in enumerate(manifest['records']):
                if i<len(prefix):continue
                record=load_json(release/entry['path']);image=release/record['source']['path']
                if sha256_file(release/entry['path'])!=entry['sha256'] or sha256_file(image)!=record['source']['sha256']:
                    raise ValueError('Frozen benchmark input changed')
                f.write(json.dumps(dict(recordId=entry['recordId'],localizerId=row['id'],results=predictor(image)))+'\n'); f.flush()
                if (i+1)%100==0:
                    write_json(output/'progress.json',dict(checkpoint=row['id'],processed=i+1,expected=len(manifest['records'])))
        del predictor
        metrics=benchmark(release_root=release,predictions_path=predictions,expected_corpus_hash=manifest['corpusHash'],tooling_revision='validation-rule-backtest')
        write_json(output/(row['id']+'.benchmark.json'),metrics)
        results.append(dict(id=row['id'],checkpointSha256=row['checkpointSha256'],validationScore=row['score'],
                            real=metrics['detection']['overall'],predictionsSha256=sha256_file(predictions)))
    result=dict(complete=True,declarationSha256=sha256_file(declaration),validationSelected=selected['id'],
                candidates=results,testMetricsUsedToTuneRule=False,productionPromotion=False)
    write_json(output/'RESULTS.json',result)
    print(json.dumps(result),flush=True)


if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--training-output',type=Path,required=True)
    p.add_argument('--release',type=Path,required=True)
    p.add_argument('--output',type=Path,required=True)
    a=p.parse_args();backtest(a.training_output,a.release,a.output)
