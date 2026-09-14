#!/usr/bin/env python3
"""Score verified per-card identities after whole-photo geometry assignment."""
import argparse
from collections import Counter,defaultdict
import json
from pathlib import Path
import numpy as np
from PIL import Image

from corpus_release import load_json,sha256_file,write_json
from crop_parity import EncoderRuntime
from evaluate_geometry_candidate import _families_by_card,classify_replay_outcome
from recognition_orientation import recognize_quad,POLICY
from reference_geometry import quad_iou
from report_session_iou import assigned_overlap


def match_cards(cards,predictions):
    quads=[[[c['point']['x'],c['point']['y']] for c in p['corners']] for p in predictions]
    matrix=np.array([[quad_iou(c['quad'],q) for q in quads] for c in cards],dtype=float).reshape(len(cards),len(quads))
    values,indices=assigned_overlap(matrix)
    # The shared reporting helper returns one-based display indices.
    return {card['id']:{'iou':values[i],'prediction':indices[i]-1 if values[i]>=.5 else None}
            for i,card in enumerate(cards)}


def replay(queue_path,labels_path,predictions_path,models_root,output):
    queue=load_json(queue_path);labels=load_json(labels_path)
    if labels['queueSha256']!=sha256_file(queue_path) or labels.get('trainingUse') is not False:
        raise ValueError('Identity labels do not bind the frozen evaluation queue')
    by_id={c['id']:c for c in queue['cards']};verified={r['id']:r for r in labels['records']}
    if not verified or len(verified)!=len(labels['records']):raise ValueError('No verified identities or duplicate labels')
    for identifier,label in verified.items():
        card=by_id[identifier]
        if label['status']!='confirmed' or any(label[k]!=card[k] for k in ('geometrySha256','recordId','instanceId')) or label['imageSha256']!=card['source']['sha256']:
            raise ValueError('Verified identity/geometry binding mismatch')
    prediction_rows=[json.loads(s) for s in predictions_path.read_text().splitlines()]
    predictions={r['recordId']:r['results'] for r in prediction_rows}
    if len(predictions)!=len(prediction_rows):raise ValueError('Duplicate prediction frames')
    frames=defaultdict(list)
    for card in by_id.values():frames[card['recordId']].append(card)
    if not set(frames)<=set(predictions):raise ValueError('Predictions must cover every queue photo')
    output.mkdir(parents=True,exist_ok=False)
    write_json(output/'identity-labels.json',labels);write_json(output/'queue.json',queue)
    runtimes={};families={};pins={}
    for game in sorted({r['game'] for r in verified.values()}):
        root=models_root/game;policy=load_json(root/'policy.json')
        pins[game]={name:sha256_file(root/name) for name in ('policy.json','CardsIndexMetadata.json','CardsIndexVectors-arcface.bin','card-embeddings-arcface-fp32.onnx')}
        if any(r['catalogSha256']!=pins[game]['CardsIndexMetadata.json'] for r in verified.values() if r['game']==game):
            raise ValueError('Identity catalog revision differs from recognition index')
        families[game]=_families_by_card(json.loads((root/'CardsIndexMetadata.json').read_text()))
        runtimes[game]=EncoderRuntime.load(game,root/'card-embeddings-arcface-fp32.onnx',root,float(policy['strongThreshold']),policy['queryNormalization'])
    rows=[]
    for record_id,cards in frames.items():
        matching=match_cards(cards,predictions[record_id])  # Includes cards without known identity.
        selected=[c for c in cards if c['id'] in verified]
        if not selected:continue
        path=Path(cards[0]['source']['path'])
        if sha256_file(path)!=cards[0]['source']['sha256']:raise ValueError('Source image changed')
        with Image.open(path) as im:image=np.asarray(im.convert('RGB'))
        for card in selected:
            truth=verified[card['id']];game=truth['game'];expected=families[game].get(truth['cardId'],set())
            if not expected:raise ValueError('Verified identity has no recognition family')
            assignment=matching[card['id']];index=assignment['prediction'];versions={}
            quads={'labelCrop':card['quad'],'modelCrop':None if index is None else [[c['point']['x'],c['point']['y']] for c in predictions[record_id][index]['corners']]}
            for version,quad in quads.items():
                decision=recognize_quad(runtimes[game],image,quad) if quad is not None else None
                versions[version]={'recognition':decision,'outcome':classify_replay_outcome('identify',accepted=bool(decision and decision['accepted']),
                    family=decision['family'] if decision else None,expected_families=expected,forbidden_families=set())}
            rows.append(dict(id=card['id'],game=game,expectedCardId=truth['cardId'],geometry=assignment,versions=versions))
    report=dict(schema='tcger-instance-recognition-replay/v1',queueSha256=sha256_file(queue_path),
        labelsSha256=sha256_file(output/'identity-labels.json'),predictionsSha256=sha256_file(predictions_path),
        recognitionModels=pins,orientationPolicy=POLICY,matching='Maximum-total-IoU assignment across all photo cards before filtering verified identities; IoU >= .50',
        counts={v:dict(Counter(r['versions'][v]['outcome'] for r in rows)) for v in ('modelCrop','labelCrop')},
        verifiedCards=len(rows),verifiedPhotos=len({by_id[r['id']]['recordId'] for r in rows}),rows=rows,
        caveats=['Game is supplied by verified identity; this does not test game classification.',
                 'Family-level recognition; exact printing and physical-card independence are not established.',
                 'Extra detections remain a separate geometry guard, not verified identity errors.'],productionPromotion=False)
    write_json(output/'RESULTS.json',report);return report


if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__)
    for name in ('queue','labels','predictions','models-root','output'):p.add_argument('--'+name,type=Path,required=True)
    a=p.parse_args();r=replay(a.queue,a.labels,a.predictions,a.models_root,a.output);print(json.dumps({'verifiedCards':r['verifiedCards'],'counts':r['counts']}))
