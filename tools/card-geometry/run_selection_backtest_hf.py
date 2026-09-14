#!/usr/bin/env python3
"""Run two pinned shortlist backtests and fixture validation on an HF CPU job."""
import argparse
from concurrent.futures import ThreadPoolExecutor
import json
from pathlib import Path
import shutil
import subprocess
import sys

from huggingface_hub import HfApi, get_token, hf_hub_download
from corpus_release import load_json, sha256_file, write_json
from run_card_geometry_hf_job import _download_evaluation_release


def run(config,output):
    output.mkdir(parents=True,exist_ok=False)
    api=HfApi(token=get_token())
    if not api.repo_info(config['repo']).private:
        raise ValueError('Backtest destination must remain private')
    try:
        for pattern in ('test_yolo_card_rotation.py','test_guarded_validation_selection.py',
                        'test_orientation_validation.py','test_train_yolo_pose.py',
                        'test_yolo_corner_order.py','test_evaluate_validation_selected.py'):
            subprocess.run([sys.executable,'-m','unittest','discover','-s','tools/card-geometry','-p',pattern],check=True)
        subprocess.run([sys.executable,'tools/card-geometry/validate_rotation_runtime.py',
                        '--output',str(output/'runtime-smoke')],check=True)
        release=_download_evaluation_release(config['real'],get_token(),output,'real')
        def worker(item):
            name,spec=item;training=output/(name+'-training');training.mkdir()
            for asset in spec['files']:
                cached=Path(hf_hub_download(config['repo'],asset['remote'],revision=asset.get('revision',config['revision'])))
                if sha256_file(cached)!=asset['sha256']:
                    raise ValueError('Shortlist download hash mismatch: '+asset['relative'])
                target=training/asset['relative'];target.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(cached,target)
            with (output/(name+'.log')).open('w') as log:
                subprocess.run([sys.executable,'tools/card-geometry/backtest_validation_selection.py',
                    '--training-output',str(training),'--release',str(release),'--output',str(output/name)],
                    stdout=log,stderr=subprocess.STDOUT,check=True)
            result=load_json(output/name/'RESULTS.json')
            print(json.dumps({'run':name,'selected':result['validationSelected'],'complete':True}),flush=True)
            return name,result
        with ThreadPoolExecutor(max_workers=2) as pool:
            results=dict(pool.map(worker,config['runs'].items()))
        write_json(output/'RESULTS.json',dict(complete=True,configSha256=config['configSha256'],
            runtimeSmoke=load_json(output/'runtime-smoke/verification.json'),runs=results,
            productionPromotion=False,testMetricsUsedToTuneRule=False))
    finally:
        api.upload_folder(repo_id=config['repo'],folder_path=str(output),path_in_repo=config['outputPrefix'],
            allow_patterns=['RESULTS.json','*.log','runtime-smoke/verification.json',
                            'cyclic/*.json','cyclic/*.jsonl','fixed/*.json','fixed/*.jsonl'],
            commit_message='Retain pinned CPU checkpoint backtest and runtime validation')


if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--config',type=Path,required=True)
    p.add_argument('--output',type=Path,required=True);a=p.parse_args()
    config=load_json(a.config);config['configSha256']=sha256_file(a.config);run(config,a.output)
