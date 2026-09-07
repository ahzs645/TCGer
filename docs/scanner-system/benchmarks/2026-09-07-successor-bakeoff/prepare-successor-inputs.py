"""Freeze the successor bake-off inputs: configs, preflight pin, tooling tarball, freeze.json."""
import json, sys, subprocess
from pathlib import Path
sys.path.insert(0, str(Path('tools/card-geometry').resolve()))
from corpus_release import load_json, pretty_json, sha256_file
from launch_geometry_bakeoff import successor_config, checked_git_revision
from run_card_geometry_hf_job import descriptor
from preflight import Expectations, run_preflight

root = Path('docs/scanner-system/benchmarks/2026-09-07-successor-bakeoff')
root.mkdir(parents=True, exist_ok=True)
release = Path('.artifacts/card-geometry/releases/card-geometry-training-successor-candidate-v1')
manifest = load_json(release / 'manifest.json')
published = load_json(root / 'dataset-publication.json')
remote = 'geometry/releases/' + manifest['releaseId']
assert published['releases'][remote]['corpusHash'] == manifest['corpusHash']
revision = checked_git_revision()
policy_sha = manifest['readiness']['readinessPolicySha256']
assert sha256_file(Path('tools/card-geometry/policies/training-minimums-v4.json')) == policy_sha
# Re-run preflight at the pinned tooling revision so the report the job compares against
# carries the same identity; the job recomputes and compares corpus hash and policy binding.
report = run_preflight(release, expectations=Expectations(
    corpus_hash=manifest['corpusHash'], policy_id='training-minimums-v4',
    policy_sha256=policy_sha, purpose='training'), tooling_revision=revision)
assert report['readyFor'] == 'training' and not report['failedChecks'], report['failedChecks']
preflight = root / 'preflight-report.json'
preflight.write_text(pretty_json(report))
preflight_sha = sha256_file(preflight)
preflight_path = f"geometry/preflights/{manifest['corpusHash']}/{preflight_sha}.json"
corpus = {'datasetRepo': published['datasetRepo'], 'datasetRevision': published['datasetRevision'],
          'releasePath': remote, 'corpusHash': manifest['corpusHash'],
          'policyId': 'training-minimums-v4', 'policySha256': policy_sha,
          'preflightReport': {'path': preflight_path, 'sha256': preflight_sha}}
evaluations = {}
for name, release_id in [('real', 'real-geometry-evaluation-v6-full-aliases-v2'),
                         ('synthetic', 'synthetic-geometry-multigame-bakeoff-eval-v1-aliases-v2')]:
    m = load_json(release.parent / release_id / 'manifest.json')
    evaluations[name] = {'datasetRepo': published['datasetRepo'],
                         'datasetRevision': '3e03b753158b602b9f4ec3bdace2de05a5b2e5f2',
                         'releasePath': 'geometry/releases/' + release_id, 'corpusHash': m['corpusHash']}
configs = {}; desc = {}; files = {}
for candidate in ['yolo11n-pose', 'yolo11s-pose', 'yolox-pose', 'fastvit-t8-four-corner']:
    config = successor_config(candidate=candidate, corpus=corpus, tooling_revision=revision, epochs=50,
                              real_evaluation=evaluations['real'], synthetic_evaluation=evaluations['synthetic'])
    path = root / 'configs' / f'{candidate}.json'; path.parent.mkdir(exist_ok=True)
    path.write_text(pretty_json(config)); configs[candidate] = config; desc[candidate] = descriptor(config)
    files[candidate] = {'path': f"geometry/bakeoffs/{revision}/{manifest['corpusHash']}/{candidate}.json",
                        'sha256': sha256_file(path), 'localPath': str(path)}
archive = Path('.artifacts/card-geometry/successor-tooling.tar.gz')
subprocess.run(['git', 'archive', '--format=tar.gz', f'--output={archive}', revision,
                'tools/card-geometry', 'docs/scanner-system'], check=True)
freeze = {
    'schema': 'https://tcger.app/reports/card-geometry-successor-freeze/v1',
    'bakeoffId': 'shared-card-geometry-successor-v1',
    'toolingRevision': revision,
    'tooling': {'path': f'geometry/tooling/{revision}/card-geometry-tooling.tar.gz',
                'sha256': sha256_file(archive), 'localPath': str(archive)},
    'corpus': corpus, 'evaluations': evaluations, 'experiments': desc, 'configFiles': files,
    'preflight': {'path': preflight_path, 'sha256': preflight_sha, 'localPath': str(preflight)},
    'authorization': ('Four 50-epoch measurement jobs on the category-repaired successor corpus '
                      '(policy v4), followed by the pinned geometry benchmarks and recognition replay. '
                      'No asset-store publication, no promotion decision.'),
    'launchStatus': 'not-submitted',
}
(root / 'freeze.json').write_text(pretty_json(freeze))
print(pretty_json({'toolingRevision': revision, 'corpusHash': manifest['corpusHash'],
                   'experiments': {k: v['experimentHash'] for k, v in desc.items()},
                   'fairness': {k: v['fairnessHash'] for k, v in desc.items()}}))
