"""Finite authorized batch: three training jobs, then one common CPU audit."""
from pathlib import Path
from datetime import datetime,timezone
import fcntl,json,hashlib,os,shutil,sys,time,subprocess
from huggingface_hub import HfApi,get_token,hf_hub_download,CommitOperationAdd
import argparse
parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('--workdir',type=Path,required=True)
parser.add_argument('--mirror-dir',type=Path)
args=parser.parse_args()
ROOT=args.workdir.resolve();REPO=Path(__file__).resolve().parents[2];MIRROR=args.mirror_dir
sys.path.insert(0,str(REPO/'tools/card-geometry'))
from launch_geometry_bakeoff import bootstrap_command,PYTORCH_26_IMAGE
HUB='ahzs645/tcger-universal-arcface'
def read(p):return json.loads(p.read_text())
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def write(p,x):
 t=p.with_name(p.name+'.tmp');t.write_text(json.dumps(x,indent=2)+'\n');t.replace(p)
def mirror():
 if MIRROR is None:return
 patterns=['*.json','index.html','pipeline.log','*/job-receipt.json','backtest-results/**/*.json','*/results/**/*.json','paired-results/**/*.json','paired-results/**/*.jsonl']
 for pattern in patterns:
  for source in ROOT.glob(pattern):
   target=MIRROR/source.relative_to(ROOT)
   if target.exists() and sha(source)==sha(target):continue
   target.parent.mkdir(parents=True,exist_ok=True);temporary=target.with_name(target.name+'.tmp');shutil.copy2(source,temporary);temporary.replace(target)
def status(stage,**kw):
 value=dict(stage=stage,updatedAt=datetime.now(timezone.utc).isoformat(),**kw);write(ROOT/'status.json',value)
 try:mirror()
 except OSError as error:write(ROOT/'status.json',{**value,'mirrorWarning':str(error)})
def fetch(api,remote,revision,target,digest=None):
 if target.exists() and digest and sha(target)==digest:return
 source=Path(hf_hub_download(HUB,remote,revision=revision))
 if digest and sha(source)!=digest:raise ValueError('Downloaded evidence changed: '+remote)
 target.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(source,target)
def submit(api,spec,path):
 if path.exists():return read(path)
 existing=[j for j in api.list_jobs() if (j.labels or {}).get('tcger-batch')==spec['labels']['tcger-batch'] and (j.labels or {}).get('tcger-phase')==spec['labels']['tcger-phase']]
 if len(existing)>1:raise ValueError('Multiple jobs already exist for '+spec['name'])
 if existing:j=existing[0]
 else:
  write(path.with_name(path.stem+'-intent.json'),dict(createdAt=datetime.now(timezone.utc).isoformat(),name=spec['name']))
  j=api.run_job(**spec,secrets={'HF_TOKEN':get_token()})
 result=dict(id=j.id,url=j.url,flavor=j.flavor,createdAt=j.created_at.isoformat(),status=str(j.status.stage))
 write(path,result);return result

def collect(api,name,revision):
 protocol=read(ROOT/'training-protocol.json');run=protocol['runs'][name];prefix=run['experiment']['checkpointPrefix']+'/training-output';dest=ROOT/name/'results';dest.mkdir(exist_ok=True)
 for rel in ('trainer-summary.json','validation-selection/selection.json','validation-selection/protocol.json','evaluation/evaluation-summary.json'):
  fetch(api,prefix+'/'+rel,revision,dest/rel)
 summary=read(dest/'trainer-summary.json');selection=read(dest/'validation-selection/selection.json');evidence=read(dest/'evaluation/evaluation-summary.json')
 assert summary['experimentHash']==run['experiment']['experimentHash'] and summary['training']['seed']==run['seed'] and summary['training']['epochs']==50
 assert selection['policy']==protocol['selectionPolicy'] and not selection['testDataUsed'] and not selection['productionPromotion']
 assert selection['protocolSha256']==sha(dest/'validation-selection/protocol.json')
 checkpoint=selection['selected'];assert evidence['checkpointSha256']==checkpoint['checkpointSha256']
 for key,outputs in evidence['evaluations'].items():
  if key=='recognitionReplay':fetch(api,prefix+'/evaluation/recognition-replay.json',revision,dest/'evaluation/recognition-replay.json',outputs['reportSha256']);continue
  for suffix,field in [('.benchmark.json','reportSha256'),('.predictions.jsonl','predictionsSha256')]:fetch(api,prefix+'/evaluation/'+key+suffix,revision,dest/'evaluation'/(key+suffix),outputs[field])
 fetch(api,prefix+'/'+checkpoint['checkpoint'],revision,dest/checkpoint['checkpoint'],checkpoint['checkpointSha256'])
 write(dest/'download-receipt.json',dict(revision=revision,prefix=prefix,selected=checkpoint,verified=True))
 return dict(path=prefix+'/'+checkpoint['checkpoint'],sha256=checkpoint['checkpointSha256'],revision=revision)

def prepare_cpu(api,models):
 file=ROOT/'paired-cpu-job-spec.json'
 if file.exists():return read(file)
 cfg=read(ROOT/'control-seed-20260906/config.json');plan=read(ROOT/'analysis-protocol.json');revision=plan['toolingRevision']
 archive=ROOT/'analysis-tooling.tar.gz'
 subprocess.run(['git','archive','--format=tar.gz','--output='+str(archive),revision,'tools/card-geometry','docs/scanner-system'],cwd=REPO,check=True)
 prefix='geometry/rotation-augmentation-20260913/paired-cpu';toolpath=prefix+'/'+revision+'/tooling.tar.gz'
 config=dict(repo=HUB,models=models,evaluationConfig=cfg,toolingRevision=revision,outputPrefix=prefix+'/results',analysisProtocolSha256=sha(ROOT/'analysis-protocol.json'))
 write(ROOT/'paired-cpu-config.json',config)
 commit=api.create_commit(repo_id=HUB,operations=[CommitOperationAdd(path_in_repo=toolpath,path_or_fileobj=str(archive)),CommitOperationAdd(path_in_repo=prefix+'/config.json',path_or_fileobj=str(ROOT/'paired-cpu-config.json')),CommitOperationAdd(path_in_repo=prefix+'/protocol.json',path_or_fileobj=str(ROOT/'analysis-protocol.json'))],commit_message='Freeze common CPU evaluation of the four selected paired checkpoints')
 pre=cfg['corpus']['preflightReport'];cmd=bootstrap_command(candidate='yolo11s-pose',checkpoint_repo=HUB,hub_revision=commit.oid,tooling_path=toolpath,tooling_sha=sha(archive),config_path=prefix+'/config.json',config_sha=sha(ROOT/'paired-cpu-config.json'),pipeline_smoke=False,preflight_path=pre['path'],preflight_sha=pre['sha256'])
 cmd[-1]=cmd[-1].rsplit('\n',1)[0]+'\npython -m pip install --no-cache-dir scipy==1.15.3\npython -c "import scipy.optimize"\nexport OMP_NUM_THREADS=2 OPENBLAS_NUM_THREADS=1\npython tools/card-geometry/run_paired_geometry_audit_hf.py --config /work/experiment.json --output /work/paired-audit\n'
 spec=dict(image=PYTORCH_26_IMAGE,command=cmd,flavor='cpu-upgrade',timeout='2h',name='tcger-paired-rotation-cpu-audit',labels={'tcger-batch':'rotation-augmentation-20260913','tcger-phase':'paired-cpu-audit'})
 write(file,spec);write(ROOT/'paired-cpu-publication.json',dict(revision=commit.oid,configSha256=sha(ROOT/'paired-cpu-config.json'),specSha256=sha(file),outputPrefix=config['outputPrefix']))
 return spec

def main():
 lock=(ROOT/'continuation.lock').open('a');fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
 approval=read(ROOT/'backtest-review.json');assert approval['allowThreeTrainingJobs'] and approval['backtestResultsSha256']==sha(ROOT/'backtest-results/RESULTS.json')
 protocol=read(ROOT/'training-protocol.json');publication=read(ROOT/'training-input-publication.json');assert publication['protocolSha256']==sha(ROOT/'training-protocol.json')
 assert len(protocol['runs'])==3 and read(ROOT/'analysis-protocol.json')['maximumAdditionalCpuJobs']==1
 api=HfApi(token=get_token());assert api.whoami()['name']=='ahzs645' and api.repo_info(HUB).private
 jobs={}
 for name,run in protocol['runs'].items():
  specpath=ROOT/name/'job-spec.json';assert sha(specpath)==publication['jobs'][name]['specSha256'];assert sha(ROOT/name/'config.json')==run['configSha256']
  spec=read(specpath);assert spec['flavor']=='l4x1' and spec['timeout']=='4h';jobs[name]=submit(api,spec,ROOT/name/'job-receipt.json');status('training-submitted',jobs=jobs)
 while True:
  for name,r in jobs.items():
   j=api.inspect_job(job_id=r['id'],namespace='ahzs645');r['status']=str(j.status.stage);r['message']=j.status.message
  status('training-and-validation',jobs=jobs)
  if any(r['status'] in ('ERROR','CANCELED','DELETED') for r in jobs.values()):raise RuntimeError('A training job failed; no automatic retry')
  if all(r['status']=='COMPLETED' for r in jobs.values()):break
  time.sleep(60)
 status('collecting-selected-models',jobs=jobs);revision=api.repo_info(HUB).sha;models={}
 for name in jobs:
  models[name.replace('seed-','')]=collect(api,name,revision)
 base=read(ROOT/'backtest-results/fixed/RESULTS.json');selected=next(r for r in base['candidates'] if r['id']==base['validationSelected'])
 old=read(REPO/'.artifacts/card-geometry/loss-split-ablation-20260913/fixed-new-split/publication.json')
 models['control-20260905']=dict(path=old['experiment']['checkpointPrefix']+'/training-output/training/repeat-0/weights/'+selected['id']+'.pt',revision=revision,sha256=selected['checkpointSha256'])
 cpu=submit(api,prepare_cpu(api,models),ROOT/'paired-cpu-job.json')
 while True:
  j=api.inspect_job(job_id=cpu['id'],namespace='ahzs645');cpu['status']=str(j.status.stage);cpu['message']=j.status.message;status('common-cpu-evaluation',jobs=jobs,cpu=cpu)
  if cpu['status']=='COMPLETED':break
  if cpu['status'] in ('ERROR','CANCELED','DELETED'):raise RuntimeError('CPU audit failed; retained output needs review')
  time.sleep(60)
 pub=read(ROOT/'paired-cpu-publication.json');revision=api.repo_info(HUB).sha
 fetch(api,pub['outputPrefix']+'/RESULTS.json',revision,ROOT/'RESULTS.json')
 result=read(ROOT/'RESULTS.json');assert result['complete'] and not result['productionPromotion']
 files={}
 for name in models:
  dest=ROOT/'paired-results'/name
  fetch(api,pub['outputPrefix']+'/'+name+'/verification.json',revision,dest/'verification.json')
  receipt=read(dest/'verification.json');assert receipt['passed'] and receipt['checkpointSha256']==models[name]['sha256']
  for relative,digest in receipt['files'].items():
   fetch(api,pub['outputPrefix']+'/'+name+'/'+relative,revision,dest/relative,digest)
  files[name]=sha(dest/'verification.json')
 write(ROOT/'paired-results/download-receipt.json',dict(revision=revision,outputPrefix=pub['outputPrefix'],verificationHashes=files))
 status('complete',jobs=jobs,cpu=cpu,results='RESULTS.json',clearsGeometryPilotThreshold=result['clearsPredeclaredGeometryPilotThreshold'])
 print('Paired training and common CPU evaluation complete.',flush=True)
if __name__=='__main__':
 try:main()
 except Exception as error:
  previous=read(ROOT/'status.json') if (ROOT/'status.json').exists() else {};status('needs-attention',**{k:v for k,v in previous.items() if k not in ('stage','updatedAt','error')},error=str(error));raise
