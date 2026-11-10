import sys, json, collections
from pathlib import Path
import numpy as np
from PIL import Image, ImageOps
S = Path(sys.argv[1]); sys.path.insert(0, sys.argv[2])
from crop_parity import EncoderRuntime
from recognition_orientation import cyclic_crops, choose_family
M = S/'models/pokemon'
rt = EncoderRuntime.load('pokemon', M/'card-embeddings-arcface-fp32.onnx', M, 0.65, 'none')
fam = rt.families; fam_arr = np.array(fam)
def emb(img, v):
    if v == 'none': return rt.embed(img)
    rt.query_normalization = 'grey-world-autocontrast'; g = rt.embed(img); rt.query_normalization = 'none'
    if v == 'gwac': return g
    e = rt.embed(img) + g; return e / np.linalg.norm(e)
labels = json.loads((S/'out/swift-labels.json').read_text())['cards']
res = {}
rows = {v: [] for v in ('none', 'gwac', 'avg')}; skipped = 0
for key, card in sorted(labels.items()):
    ses, frame = key.split('/')
    if ses not in res: res[ses] = {f['imageFile']: f for f in json.loads((S/'old'/ses/'results.json').read_text())['frames']}
    f = res[ses].get(frame)
    if not f or not f.get('quad'): skipped += 1; continue
    image = np.asarray(ImageOps.exif_transpose(Image.open(S/'old'/ses/frame)).convert('RGB'))
    quad = [[x, 1 - y] for x, y in f['quad']]
    exp = 'pokemon:printing:' + card
    for v in rows:
        phases = []; best_rank = None
        try: crops = cyclic_crops(image, quad)
        except ValueError: crops = cyclic_crops(image, quad[::-1])
        for phase, crop in crops:
            s = np.nan_to_num(rt.vectors @ emb(crop, v), nan=-9); order = np.argsort(-s); first = int(order[0])
            rival = next(int(i) for i in order[1:] if fam[int(i)] != fam[first])
            phases.append(dict(phase=phase, family=fam[first], topScore=float(s[first]), rivalMargin=float(s[first] - s[rival])))
            r = int(np.where(fam_arr[order] == exp)[0][0]) + 1
            best_rank = r if best_rank is None else min(best_rank, r)
        d = choose_family(phases, 0.65)
        rows[v].append(dict(key=key, exp=exp, family=d['family'], accepted=d['accepted'], top=d['topScore'], rank=best_rank,
                            phone='correct' if f.get('identified') and f.get('bestMatchCardId') == card else 'wrong' if f.get('identified') else 'abstain'))
print('labelled frames', len(labels), 'skipped (no device outline)', skipped)
print('phone at capture time:', dict(collections.Counter(r['phone'] for r in rows['none'])))
for v, rs in rows.items():
    k = collections.Counter('correct' if r['accepted'] and r['family'] == r['exp'] else 'wrong' if r['accepted'] else 'abstain' for r in rs)
    print(f"{v:5} correct {k['correct']:2} abstain {k['abstain']:2} wrong {k['wrong']:2} | true card top1 {sum(r['rank']==1 for r in rs)} top5 {sum(r['rank']<=5 for r in rs)} of {len(rs)} | by session",
          {s[-6:]: sum(1 for r in rs if r['key'].startswith(s) and r['accepted'] and r['family']==r['exp']) for s in sorted({r['key'].split('/')[0] for r in rs})})
    w = [(r['key'][-25:], r['exp'][-9:], r['family'][-9:], round(r['top'], 3)) for r in rs if r['accepted'] and r['family'] != r['exp']]
    if w: print('   wrong:', w)
base = {r['key']: r for r in rows['none']}
for v in ('gwac', 'avg'):
    lost = [r['key'][-25:] for r in rows[v] if not (r['accepted'] and r['family']==r['exp']) and base[r['key']]['accepted'] and base[r['key']]['family']==r['exp']]
    gained = [r['key'][-25:] for r in rows[v] if (r['accepted'] and r['family']==r['exp']) and not (base[r['key']]['accepted'] and base[r['key']]['family']==r['exp'])]
    print(v, 'gained', len(gained), 'lost', len(lost), lost)
