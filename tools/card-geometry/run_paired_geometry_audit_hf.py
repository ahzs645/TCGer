#!/usr/bin/env python3
"""Evaluate the four selected paired checkpoints through one common CPU path."""
import argparse
from concurrent.futures import ThreadPoolExecutor
import json
from pathlib import Path
import statistics
import subprocess
import sys

from huggingface_hub import HfApi,get_token,hf_hub_download
from corpus_release import load_json,sha256_file,write_json
from run_card_geometry_hf_job import _download_evaluation_release,_download_recognition_models


def summarize(output,models):
    rows={}
    for name in models:
        folder=output/name;receipt=load_json(folder/'verification.json')
        if not receipt['passed'] or receipt['protocolSha256']!=sha256_file(output/'protocol.json') or receipt['checkpointSha256']!=models[name]['sha256']:
            raise ValueError('Evaluation failed or model/protocol binding differs')
        for relative,digest in receipt['files'].items():
            if sha256_file(folder/relative)!=digest:raise ValueError('Evaluation receipt mismatch')
        datasets={}
        for dataset in ('real','synthetic'):
            report=load_json(folder/(dataset+'.benchmark.json'));overlap=load_json(folder/(dataset+'.overlap.json'))
            d=report['detection']['overall'];photos=sum(r['records'] for r in report['detection']['bySceneSlice'].values())
            datasets[dataset]=dict(targets=d['truthInstances'],photos=photos,found=d['matches'],
                foundRate=d['recall@0.5'],tight=round(d['recall@0.9']*d['truthInstances']),tightRate=d['recall@0.9'],
                extras=d['extra'],duplicates=d['duplicate'],extrasPerPhoto=(d['extra']+d['duplicate'])/photos,
                meanIoU=overlap['all']['mean'],humanCorners=overlap['humanCorners'],otherReferences=overlap['otherReferences'])
        rows[name]=dict(model=models[name],datasets=datasets,recognition=receipt['recognition'])
    arms={}
    for arm in ('control','rotation'):
        samples=[r for k,r in rows.items() if k.startswith(arm+'-')]
        if len(samples)!=2:raise ValueError('Two selected checkpoints per arm are required')
        arms[arm]={dataset:{metric:statistics.mean(r['datasets'][dataset][metric] for r in samples)
                    for metric in ('foundRate','tightRate','extrasPerPhoto','meanIoU')} for dataset in ('real','synthetic')}
    effects={dataset:{metric:arms['rotation'][dataset][metric]-arms['control'][dataset][metric]
                       for metric in arms['control'][dataset]} for dataset in arms['control']}
    real=effects['real'];clears=real['tightRate']>=.03-1e-9 and real['foundRate']>=-1e-9 and real['extrasPerPhoto']<=.02+1e-9
    return dict(complete=True,models=rows,armMeans=arms,effects=effects,clearsPredeclaredGeometryPilotThreshold=clears,
        threshold=dict(tightRateImprovement=.03,minimumFoundRateChange=0.,maximumExtrasPerPhotoIncrease=.02),
        productionPromotion=False,recognitionReleaseExpanded=False,
        interpretation='Two seeds per arm are a pilot, not a precise variance estimate. Geometry thresholds alone do not promote a model. Recognition still uses the sparse historical 57-frame replay; new per-card labels are evaluated separately.')


def run(config,output):
    output.mkdir(parents=True,exist_ok=False);api=HfApi(token=get_token())
    if not api.repo_info(config['repo']).private:raise ValueError('Private output required')
    try:
        releases={name:_download_evaluation_release(config['evaluationConfig']['evaluations'][key],get_token(),output,name)
                  for name,key in [('real','frozenReal'),('synthetic','syntheticMultigame')]}
        model_root=_download_recognition_models(config['evaluationConfig'],get_token(),output)
        models={}
        for name,spec in config['models'].items():
            path=Path(hf_hub_download(config['repo'],spec['path'],revision=spec['revision']))
            if sha256_file(path)!=spec['sha256']:raise ValueError('Selected checkpoint changed')
            models[name]=dict(path=str(path),sha256=spec['sha256'])
        source=Path(__file__).resolve().parents[2]
        protocol=dict(sourceRoot=str(source),sourceRevision=config['toolingRevision'],threads=2,checkpoints=models,
            sourceHashes={str(p.relative_to(source)):sha256_file(p) for p in (source/'tools/card-geometry').glob('*.py')},
            releases={name:dict(path=str(path),manifestSha256=sha256_file(path/'manifest.json'),corpusHash=load_json(path/'manifest.json')['corpusHash']) for name,path in releases.items()},
            recognitionModelsRoot=str(model_root),recognitionFileHashes={str(p.relative_to(model_root)):sha256_file(p) for p in model_root.glob('*/*') if p.is_file()},
            recognitionReplaySha256=sha256_file(releases['real']/'recognition-replay.json'))
        write_json(output/'protocol.json',protocol)
        def worker(name):
            with (output/(name+'.log')).open('w') as log:
                subprocess.run([sys.executable,'tools/card-geometry/evaluate_checkpoint_suite.py','--protocol',str(output/'protocol.json'),
                    '--checkpoint-id',name,'--output',str(output/name)],stdout=log,stderr=subprocess.STDOUT,check=True)
            print(json.dumps({'checkpoint':name,'complete':True}),flush=True)
        with ThreadPoolExecutor(max_workers=2) as pool:list(pool.map(worker,models))
        write_json(output/'RESULTS.json',summarize(output,config['models']))
    finally:
        api.upload_folder(repo_id=config['repo'],folder_path=str(output),path_in_repo=config['outputPrefix'],
            allow_patterns=['RESULTS.json','protocol.json','*.log','control-*/*.json','control-*/*.jsonl','rotation-*/*.json','rotation-*/*.jsonl'],
            commit_message='Retain common CPU paired rotation experiment evaluation')


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--config',type=Path,required=True);parser.add_argument('--output',type=Path,required=True)
    a=parser.parse_args();run(load_json(a.config),a.output)
