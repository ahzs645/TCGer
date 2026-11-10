import sys, json, collections
from pathlib import Path
import numpy as np
from PIL import Image
S = Path(sys.argv[1]); sys.path.insert(0, sys.argv[2])
from crop_parity import EncoderRuntime
from recognition_orientation import cyclic_crops, choose_family
from replay_instance_identities import match_cards
M = S/'models/pokemon'
rt = EncoderRuntime.load('pokemon', M/'card-embeddings-arcface-fp32.onnx', M, 0.65, 'none'); fam = rt.families
def emb(img, v):
    if v == 'none': return rt.embed(img)
    rt.query_normalization = 'grey-world-autocontrast'; g = rt.embed(img); rt.query_normalization = 'none'
    e = rt.embed(img) + g; return e / np.linalg.norm(e)
props = json.loads((S/'out/identity-proposals-phone-20260909.json').read_text())['suggestions']
queue = json.loads((S/'drive/files/recog-queue.json').read_text())
frames = collections.defaultdict(list)
for c in queue['cards']: frames[c['recordId']].append(c)
single = {r for r, cs in frames.items() if len(cs) == 1}
for name in ('sept8-baseline', 'control-20260906', 'rotation-20260906'):
    preds = {}
    for line in (S/'replay'/f'{name}.predictions.jsonl').read_text().splitlines():
        r = json.loads(line); preds[r['recordId']] = r['results']
    for v in ('none', 'avg'):
        k = collections.Counter(); k63 = collections.Counter(); percard = {}
        for rid, cs in frames.items():
            image = np.asarray(Image.open(cs[0]['source']['path']).convert('RGB')); m = match_cards(cs, preds[rid])
            for c in cs:
                exp = 'pokemon:printing:' + props[c['id']]['cardId'] if props[c['id']]['cardId'] else None
                a = m[c['id']]
                if a['prediction'] is None: o = 'missed'
                else:
                    quad = [[p['point']['x'], p['point']['y']] for p in preds[rid][a['prediction']]['corners']]
                    try:
                        phases = []
                        for phase, crop in cyclic_crops(image, quad):
                            s = np.nan_to_num(rt.vectors @ emb(crop, v), nan=-9); order = np.argsort(-s); first = int(order[0])
                            rival = next(int(i) for i in order[1:] if fam[int(i)] != fam[first])
                            phases.append(dict(phase=phase, family=fam[first], topScore=float(s[first]), rivalMargin=float(s[first] - s[rival])))
                        d = choose_family(phases, 0.65)
                        o = 'correct' if d['accepted'] and d['family'] == exp else 'wrong' if d['accepted'] else 'abstain'
                    except ValueError: o = 'abstain'
                k[o] += 1; percard[c['id']] = o
                if rid in single: k63[o] += 1
        print(f"{name:18} {v:5} all106: correct {k['correct']} abstain {k['abstain']} missed {k['missed']} wrong {k['wrong']} | 63 single-card: correct {k63['correct']} no-answer {k63['abstain']+k63['missed']} wrong {k63['wrong']}", flush=True)
        if name == 'sept8-baseline' and v == 'avg': (S/'out/e2e-avg-per-card.json').write_text(json.dumps(percard))
