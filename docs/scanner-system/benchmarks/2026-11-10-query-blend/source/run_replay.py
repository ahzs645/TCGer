"""Run saved geometry checkpoints over the frozen phone session, then score recognition
with the live Pokemon pack against the proposed (unverified) identities.

Uses the repository's own Predictor, matcher and recognition replay unchanged.
"""
import collections, hashlib, json, shutil, sys, time
from pathlib import Path

S = Path(sys.argv[1]); REPO_TOOLS = Path(sys.argv[2])
sys.path.insert(0, str(REPO_TOOLS))
import numpy as np
import torch, ultralytics
from PIL import Image
from corpus_release import sha256_file
from evaluate_geometry_candidate import Predictor, DECODER_CONFIG
from recognition_orientation import recognize_quad
from replay_instance_identities import replay, match_cards
from crop_parity import EncoderRuntime

QUEUE = S / 'drive/files/recog-queue.json'
MODELS = S / 'models'
OUT = S / 'replay'
if OUT.exists(): shutil.rmtree(OUT)
OUT.mkdir()
torch.set_num_threads(4)

queue = json.loads(QUEUE.read_text())
props = json.loads((S / 'out/identity-proposals-phone-20260909.json').read_text())['suggestions']
cards = {c['id']: c for c in queue['cards']}
frames = collections.defaultdict(list)
for c in queue['cards']: frames[c['recordId']].append(c)

# Labels in the export shape the replay tool expects. They are proposals, not human-verified.
catalog_sha = sha256_file(MODELS / 'pokemon/CardsIndexMetadata.json')
records = [dict(id=i, status='confirmed', game='pokemon', cardId=p['cardId'], geometrySha256=cards[i]['geometrySha256'],
                recordId=cards[i]['recordId'], instanceId=cards[i]['instanceId'], imageSha256=cards[i]['source']['sha256'],
                catalogSha256=catalog_sha) for i, p in props.items() if p['cardId']]
labels_path = OUT / 'proposed-identities.json'
labels_path.write_text(json.dumps(dict(queueSha256=sha256_file(QUEUE), trainingUse=False,
    verification='UNVERIFIED proposals read from the photos; not a human-confirmed export', records=records), indent=1))

want = {}
for line in (S / 'archive/want.txt').read_text().splitlines():
    name, sha, _, _ = line.split()
    want[name] = S / 'archive/x/objects' / sha
CHECKPOINTS = ['sept8-baseline', 'sept10-selected', 'control-20260905', 'control-20260906', 'rotation-20260905', 'rotation-20260906']

def geometry(predictions):
    found = tight = 0; extras = 0; per = {}
    for record_id, cs in frames.items():
        m = match_cards(cs, predictions[record_id])
        used = set()
        for c in cs:
            a = m[c['id']]; per[c['id']] = a
            if a['prediction'] is not None:
                found += 1; used.add(a['prediction']); tight += a['iou'] >= .9
        extras += len(predictions[record_id]) - len(used)
    return dict(found=found, tight=int(tight), missed=len(cards) - found, extras=extras), per

summary = {}; per_card = {}
for name in CHECKPOINTS:
    path = want[name]; link = OUT / f'{name}.pt'
    shutil.copy2(path, link)
    predictor = Predictor('yolo11s-pose', link.parent, sha256_file(link), 640, device='cpu', checkpoint_path=link)
    predictor.model.to('cpu')
    pred_path = OUT / f'{name}.predictions.jsonl'; t0 = time.monotonic(); predictions = {}
    with pred_path.open('w') as h:
        for record_id, cs in frames.items():
            result = predictor(Path(cs[0]['source']['path']))
            predictions[record_id] = result
            h.write(json.dumps({'recordId': record_id, 'localizerId': name, 'results': result}, sort_keys=True) + '\n')
    seconds = time.monotonic() - t0
    geo, per_geo = geometry(predictions)
    report = replay(QUEUE, labels_path, pred_path, MODELS, OUT / f'{name}-recognition')
    rows = {r['id']: r for r in report['rows']}
    by = {v: collections.Counter() for v in ('modelCrop', 'labelCrop')}
    for i, r in rows.items():
        for v in by: by[v][(props[i]['language'], r['versions'][v]['outcome'])] += 1
    summary[name] = dict(geometry=geo, secondsPerPhoto=round(seconds / len(frames), 3),
        recognition={v: {f'{l}:{o}': n for (l, o), n in sorted(c.items())} for v, c in by.items()})
    per_card[name] = {i: dict(iou=round(per_geo[i]['iou'], 4), found=per_geo[i]['prediction'] is not None,
        model=r['versions']['modelCrop']['outcome'], label=r['versions']['labelCrop']['outcome'],
        modelDecision={k: r['versions']['modelCrop']['recognition'][k] for k in ('family', 'accepted', 'topScore', 'rivalMargin', 'reason')} if r['versions']['modelCrop']['recognition'] else None,
        labelDecision={k: r['versions']['labelCrop']['recognition'][k] for k in ('family', 'accepted', 'topScore', 'rivalMargin', 'reason')})
        for i, r in rows.items()}
    # The German energy card has no catalog row: any accept is a wrong accept.
    runtime = EncoderRuntime.load('pokemon', MODELS / 'pokemon/card-embeddings-arcface-fp32.onnx', MODELS / 'pokemon', 0.65, 'none')
    c = cards['F54-C1']
    with Image.open(c['source']['path']) as im: image = np.asarray(im.convert('RGB'))
    a = per_geo['F54-C1']; out = {'label': recognize_quad(runtime, image, c['quad'])}
    if a['prediction'] is not None:
        out['model'] = recognize_quad(runtime, image, [[k['point']['x'], k['point']['y']] for k in predictions[c['recordId']][a['prediction']]['corners']])
    summary[name]['energyCard'] = {k: {x: v[x] for x in ('family', 'accepted', 'topScore', 'reason')} for k, v in out.items()}
    per_card[name]['F54-C1'] = dict(iou=round(a['iou'], 4), found=a['prediction'] is not None, energy=summary[name]['energyCard'])
    print(name, json.dumps(summary[name]), flush=True)
    del predictor

# Does this runtime reproduce the baseline predictions saved on the Mac on September 10?
saved = {}
for line in want['saved-baseline-predictions'].read_text().splitlines():
    r = json.loads(line); saved[r['recordId']] = r['results']
mine = {}
for line in (OUT / 'sept8-baseline.predictions.jsonl').read_text().splitlines():
    r = json.loads(line); mine[r['recordId']] = r['results']
keys_saved = sorted(saved)[:3]
same_count = sum(len(saved.get(k, [])) == len(mine.get(k, [])) for k in mine) if set(saved) == set(mine) else None
summary['_reproduction'] = dict(savedRecordIdsSample=keys_saved, mineRecordIdsSample=sorted(mine)[:3], sameIds=set(saved) == set(mine), framesWithSameDetectionCount=same_count,
    savedGeometry=geometry(saved)[0] if set(saved) == set(mine) else None)
summary['_environment'] = dict(torch=torch.__version__, ultralytics=ultralytics.__version__, decoder=DECODER_CONFIG, threads=4,
    recognition=dict(onnx=sha256_file(MODELS / 'pokemon/card-embeddings-arcface-fp32.onnx'), vectors=sha256_file(MODELS / 'pokemon/CardsIndexVectors-arcface.bin'), metadata=catalog_sha, strongThreshold=0.65, margin=0.05))
(OUT / 'SUMMARY.json').write_text(json.dumps(summary, indent=1))
(OUT / 'PER-CARD.json').write_text(json.dumps(per_card, indent=1))
print('reproduction', json.dumps(summary['_reproduction']))
