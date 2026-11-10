import sys, json, collections, struct
from pathlib import Path
import numpy as np
from PIL import Image
S = Path(sys.argv[1]); sys.path.insert(0, sys.argv[2])
from crop_parity import EncoderRuntime, normalize_query_colors
from recognition_orientation import cyclic_crops, choose_family
props = json.loads((S/'out/identity-proposals-phone-20260909.json').read_text())['suggestions']
queue = json.loads((S/'drive/files/recog-queue.json').read_text())
M = S/'models/pokemon'
rt = EncoderRuntime.load('pokemon', M/'card-embeddings-arcface-fp32.onnx', M, 0.65, 'none')
fam = rt.families; fam_arr = np.array(fam)
def embed_variant(img, variant):
    if variant == 'none': return rt.embed(img)
    if variant == 'gwac':
        rt.query_normalization = 'grey-world-autocontrast'; e = rt.embed(img); rt.query_normalization = 'none'; return e
    if variant == 'avg':
        e = embed_variant(img, 'none') + embed_variant(img, 'gwac'); return e / np.linalg.norm(e)
def decide(image, quad, variant, threshold=0.65):
    phases = []; ranks = {}
    for phase, crop in cyclic_crops(image, quad):
        e = embed_variant(crop, variant); s = rt.vectors @ e; s = np.nan_to_num(s, nan=-9)
        order = np.argsort(-s); first = int(order[0])
        rival = next(int(i) for i in order[1:] if fam[int(i)] != fam[first])
        phases.append(dict(phase=phase, family=fam[first], topScore=float(s[first]), rivalMargin=float(s[first] - s[rival])))
        ranks[phase] = (s, order)
    return choose_family(phases, threshold), ranks
images = {}
out = {v: {} for v in ('none', 'gwac', 'avg')}
for c in queue['cards']:
    p = props[c['id']]
    path = c['source']['path']
    if path not in images: images[path] = np.asarray(Image.open(path).convert('RGB'))
    exp = 'pokemon:printing:' + p['cardId'] if p['cardId'] else None
    for v in out:
        d, ranks = decide(images[path], c['quad'], v)
        s, order = ranks[0]   # hand-drawn quads start at the printed top, so phase 0 is upright
        rank = int(np.where(fam_arr[order] == exp)[0][0]) + 1 if exp else None
        own = float(s[np.where(fam_arr == exp)[0][0]]) if exp else None
        out[v][c['id']] = dict(family=d['family'], top=d['topScore'], margin=d['rivalMargin'], rank=rank, own=own, exp=exp)
(S/'out/experiments.json').write_text(json.dumps(out))
ids = [c['id'] for c in queue['cards']]
for v, rows in out.items():
    print('##', v)
    for th in (0.65, 0.60, 0.55, 0.50):
        k = collections.Counter()
        for i in ids:
            r = rows[i]; acc = r['top'] >= th and r['margin'] >= 0.05
            k['correct' if acc and r['family'] == r['exp'] else 'wrong' if acc else 'abstain'] += 1
        print(f'  threshold {th:.2f}: correct {k["correct"]:3} abstain {k["abstain"]:3} wrong {k["wrong"]:2}')
    lab = [i for i in ids if rows[i]['exp']]
    rk = [rows[i]['rank'] for i in lab]
    print('  true card rank: top1', sum(r == 1 for r in rk), 'top5', sum(r <= 5 for r in rk), 'top10', sum(r <= 10 for r in rk), 'top50', sum(r <= 50 for r in rk), 'top200', sum(r <= 200 for r in rk), 'of', len(lab))
    print('  top1 right and score>=0.55:', sum(rows[i]['rank'] == 1 and rows[i]['own'] >= .55 for i in lab), '| top1 right any score:', sum(rows[i]['rank'] == 1 for i in lab))
    for cid in ('me05-077', 'me05-043'):
        sub = [rows[i] for i in lab if props[i]['cardId'] == cid]
        print('  ', cid, 'ranks', sorted(r['rank'] for r in sub), 'own-score median %.3f' % float(np.median([r['own'] for r in sub])))
