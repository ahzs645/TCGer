"""Deterministic successor-vs-round-two comparison from the copied candidate reports."""
import json, sys
from pathlib import Path
root = Path(__file__).resolve().parent
old_root = Path(sys.argv[1]) if len(sys.argv) > 1 else Path('.artifacts/card-geometry/round-two-current-results')
old_yolox = Path('docs/scanner-system/benchmarks/2026-09-06-yolox-loss-repair/reports')
CANDIDATES = ['fastvit-t8-four-corner', 'yolo11n-pose', 'yolo11s-pose', 'yolox-pose']
SLICES = ['binder_page', 'duel_field', 'single_card_archive', 'single_handheld', 'steep_playmat']

def load(p): return json.load(open(p))
def overall(b):
    o = b['detection']['overall']; c = b['cornerError']['overall']['normalized']
    return {'recall@0.5': o['recall@0.5'], 'recall@0.75': o['recall@0.75'], 'recall@0.9': o['recall@0.9'],
            'extra': o['extra'], 'duplicate': o['duplicate'], 'miss': o['miss'], 'meanMatchedIoU': o['meanMatchedIoU'],
            'cornerP50': c['p50'], 'cornerP90': c['p90'], 'cornerCount': c['count']}
def slices(b):
    return {s: {k: v[k] for k in ('recall@0.5', 'recall@0.75', 'recall@0.9', 'extra', 'duplicate', 'matches', 'truthInstances')}
            for s, v in b['detection']['bySceneSlice'].items() if s in SLICES}
out = {'schema': 'https://tcger.app/reports/card-geometry-successor-comparison/v1',
       'roundTwoSource': {'localReports': str(old_root), 'yoloxLossRepairReports': str(old_yolox)},
       'candidates': {}}
for cand in CANDIDATES:
    new_dir = root / 'results' / cand
    if not (new_dir / 'real-v3.benchmark.json').exists():
        out['candidates'][cand] = {'status': 'pending'}; continue
    old_dir = old_yolox if cand == 'yolox-pose' else old_root / cand
    entry = {'status': 'complete'}
    for name, key in (('real-v3.benchmark.json', 'real'), ('synthetic-duel-field.benchmark.json', 'synthetic')):
        new_b, old_b = load(new_dir / name), load(old_dir / name)
        entry[key] = {'roundTwo': overall(old_b), 'successor': overall(new_b), 'corpusHash': new_b['corpusHash'],
                      'sameEvaluation': new_b['corpusHash'] == old_b['corpusHash']}
        if key == 'real':
            entry['realBySceneSlice'] = {'roundTwo': slices(old_b), 'successor': slices(new_b)}
    new_r, old_r = load(new_dir / 'recognition-replay.json'), load(old_dir / 'recognition-replay.json')
    entry['recognitionReplay'] = {'roundTwo': old_r['counts'], 'successor': new_r['counts']}
    out['candidates'][cand] = entry
(root / 'comparison.json').write_text(json.dumps(out, indent=2, sort_keys=True) + '\n')
for cand, e in out['candidates'].items():
    if e['status'] != 'complete': print(cand, 'pending'); continue
    a, b = e['real']['roundTwo'], e['real']['successor']
    print(f"{cand:24} real r50 {a['recall@0.5']:.3f}->{b['recall@0.5']:.3f} r75 {a['recall@0.75']:.3f}->{b['recall@0.75']:.3f} "
          f"r90 {a['recall@0.9']:.3f}->{b['recall@0.9']:.3f} extra {a['extra']}->{b['extra']} dup {a['duplicate']}->{b['duplicate']} "
          f"cornerP50 {a['cornerP50']:.3f}->{b['cornerP50']:.3f}")
