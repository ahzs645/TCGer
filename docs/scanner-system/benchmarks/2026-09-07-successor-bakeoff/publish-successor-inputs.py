"""Publish frozen successor inputs to the private model repo and emit CLI job commands."""
import sys, json, shlex
from pathlib import Path
sys.path.insert(0, str(Path('tools/card-geometry').resolve()))
from corpus_release import load_json, pretty_json, sha256_file, sha256_bytes, canonical_json
from launch_geometry_bakeoff import bootstrap_command
from huggingface_hub import HfApi, get_token, CommitOperationAdd
root = Path('docs/scanner-system/benchmarks/2026-09-07-successor-bakeoff')
freeze = load_json(root / 'freeze.json')
repo = 'ahzs645/tcger-universal-arcface'
api = HfApi(token=get_token()); assert api.repo_info(repo).private
files = [freeze['tooling'], freeze['preflight'], *freeze['configFiles'].values()]
ops = []
for item in files:
    assert sha256_file(Path(item['localPath'])) == item['sha256'], item['path']
    ops.append(CommitOperationAdd(path_in_repo=item['path'], path_or_fileobj=item['localPath']))
commit = api.create_commit(repo_id=repo, operations=ops,
                           commit_message='Freeze successor geometry inputs ' + freeze['corpus']['corpusHash'][:12])
commands = {}
for candidate, item in freeze['configFiles'].items():
    config = load_json(Path(item['localPath']))
    command = bootstrap_command(candidate=candidate, checkpoint_repo=repo, hub_revision=str(commit.oid),
                                tooling_path=freeze['tooling']['path'], tooling_sha=freeze['tooling']['sha256'],
                                config_path=item['path'], config_sha=item['sha256'], pipeline_smoke=False,
                                preflight_path=freeze['preflight']['path'], preflight_sha=freeze['preflight']['sha256'])
    commands[candidate] = {'image': config['execution']['containerImage'], 'command': command,
                           'flavor': 'l4x1', 'timeout': '12h', 'name': f'geometry-successor-{candidate}-train'}
report = {'inputRepo': repo, 'inputCommit': str(commit.oid), 'corpusHash': freeze['corpus']['corpusHash'],
          'toolingRevision': freeze['toolingRevision'], 'experiments': freeze['experiments'],
          'files': [{k: v for k, v in item.items()} for item in files],
          'jobCommandsSha256': sha256_bytes(canonical_json(commands))}
(root / 'input-publication.json').write_text(pretty_json(report))
(root / 'job-commands.json').write_text(pretty_json(commands))
lines = ['#!/bin/sh', 'set -eu']
for candidate, spec in commands.items():
    script = spec['command'][2]
    lines.append(f"hf jobs run --detach --flavor {spec['flavor']} --timeout {spec['timeout']} --secrets HF_TOKEN "
                 f"--name {spec['name']} {shlex.quote(spec['image'])} -- bash -lc {shlex.quote(script)}")
(root / 'submit-jobs.sh').write_text('\n'.join(lines) + '\n')
print(pretty_json({k: v for k, v in report.items() if k != 'experiments'}))
