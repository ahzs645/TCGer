#!/usr/bin/env python3
"""Per-card identity review with immutable geometry and an append-only journal."""
import argparse
import fcntl
from datetime import datetime, timezone
import hashlib
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import threading
from urllib.parse import urlparse, parse_qs

import numpy as np
from PIL import Image
from corpus_release import load_json, sha256_file, write_json
from crop_parity import warp_reference


def build(session_inputs, output):
    output.mkdir(parents=True,exist_ok=False)
    rows=[]
    for photo in load_json_array(session_inputs):
        if sha256_file(Path(photo['source']['path'])) != photo['source']['sha256']:
            raise ValueError('Source image changed')
        for index,instance in enumerate(photo['instances']):
            quad=[[c['point']['x'],c['point']['y']] for c in instance['corners']]
            rows.append(dict(id=f"{photo['reference']}-C{index+1}",reference=f"{photo['reference']} / C{index+1}",
                recordId=photo['recordId'],instanceId=instance['instanceId'],source=photo['source'],quad=quad,
                geometrySha256=hashlib.sha256(json.dumps(instance,sort_keys=True).encode()).hexdigest()))
    queue=dict(schema='tcger-per-card-identity-review/v1',sourceInputsSha256=sha256_file(session_inputs),
               photos=len({r['recordId'] for r in rows}),cards=rows,
               scope='Frozen phone session; identity labels only, excluded from training and selection')
    write_json(output/'queue.json',queue)
    return queue


def load_json_array(path):
    value=json.loads(Path(path).read_text())
    if not isinstance(value,list):raise ValueError('Expected frozen session record array')
    return value


class Review:
    def __init__(self,queue_path,models_root,storage,suggestions_path=None):
        self.queue=load_json(queue_path);self.queue_sha=sha256_file(queue_path)
        self.cards={r['id']:r for r in self.queue['cards']}
        if len(self.cards)!=len(self.queue['cards']):raise ValueError('Duplicate review card IDs')
        storage.mkdir(parents=True,exist_ok=True)
        self.storage_lock=(storage/'review.lock').open('a')
        fcntl.flock(self.storage_lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        queue_backup=storage/'queue.json'
        if queue_backup.exists() and sha256_file(queue_backup)!=self.queue_sha:
            raise ValueError('Review folder already belongs to a different queue')
        if not queue_backup.exists():queue_backup.write_bytes(queue_path.read_bytes())
        self.journal=storage/'identity-decisions.jsonl';self.export=storage/'verified-identities.json'
        self.lock=threading.RLock();self.latest={};self.previous=None;self.catalog={};self.pins={}
        for game in ('pokemon','magic','yugioh'):
            path=models_root/game/'CardsIndexMetadata.json';self.pins[game]=sha256_file(path)
            self.catalog[game]={str(r['cardId']):r for r in load_json_array(path)}
        self.suggestions={}
        if suggestions_path:
            suggestions=load_json(suggestions_path)
            if suggestions['queueSha256']!=self.queue_sha:raise ValueError('Suggestions belong to a different queue')
            for identifier,row in suggestions['suggestions'].items():
                catalog=self.catalog.get(row['game'],{}).get(row['cardId'])
                if identifier in self.cards and catalog:
                    self.suggestions[identifier]={**row,**{k:catalog.get(k) for k in ('name','setCode','imageURL')}}
        if self.journal.exists():
            for line in self.journal.read_text().splitlines():
                row=json.loads(line)
                if row['queueSha256']!=self.queue_sha or row['previousSha256']!=self.previous:
                    raise ValueError('Journal binding or chain mismatch')
                if row['status']=='confirmed' and row['catalogSha256']!=self.pins[row['game']]:
                    raise ValueError('Saved identity uses a different catalog revision')
                self.previous=hashlib.sha256(line.encode()).hexdigest();self.latest[row['id']]=row

    def save(self,payload):
        identifier=payload['id'];status=payload['status']
        if identifier not in self.cards or status not in ('confirmed','unreadable','pending'):
            raise ValueError('Unknown card or decision')
        game=payload.get('game');card_id=str(payload.get('cardId',''))
        if status=='confirmed' and (game not in self.catalog or card_id not in self.catalog[game]):
            raise ValueError('Choose an existing catalog card before confirming')
        with self.lock:
            source=self.cards[identifier]
            row=dict(id=identifier,status=status,game=game if status=='confirmed' else None,
                cardId=card_id if status=='confirmed' else None,
                cardName=self.catalog[game][card_id]['name'] if status=='confirmed' else None,
                recordId=source['recordId'],instanceId=source['instanceId'],geometrySha256=source['geometrySha256'],
                imageSha256=source['source']['sha256'],queueSha256=self.queue_sha,
                catalogSha256=self.pins[game] if status=='confirmed' else None,
                reviewedAt=datetime.now(timezone.utc).isoformat(),reviewer='human',previousSha256=self.previous)
            line=json.dumps(row,sort_keys=True,separators=(',',':'))
            with self.journal.open('a') as f:f.write(line+'\n');f.flush();os.fsync(f.fileno())
            self.previous=hashlib.sha256(line.encode()).hexdigest();self.latest[identifier]=row
            document=dict(schema='tcger-verified-instance-identities/v1',queueSha256=self.queue_sha,
                journalSha256=sha256_file(self.journal),records=[v for v in self.latest.values() if v['status']=='confirmed'],
                pending=sum(self.latest.get(k,{}).get('status','pending')=='pending' for k in self.cards),
                unreadable=sum(v['status']=='unreadable' for v in self.latest.values()),trainingUse=False)
            temporary=self.export.with_suffix('.tmp');write_json(temporary,document);temporary.replace(self.export)
            return row

    def catalog_search(self,game,query):
        if game not in self.catalog:raise ValueError('Choose a game')
        terms=query.casefold().split()
        if not terms:return []
        matches=[]
        for row in self.catalog[game].values():
            searchable=' '.join(str(row.get(k) or '') for k in ('name','cardId','setCode','setName')).casefold()
            if all(term in searchable for term in terms):
                matches.append({k:row.get(k) for k in ('cardId','name','setCode','setName','imageURL')})
                if len(matches)>=50:break
        return matches


def serve(queue,models_root,storage,port,suggestions=None):
    review=Review(queue,models_root,storage,suggestions)
    class Handler(BaseHTTPRequestHandler):
        def send(self,value,kind='application/json',status=200):
            data=value if isinstance(value,bytes) else json.dumps(value).encode()
            self.send_response(status);self.send_header('Content-Type',kind);self.send_header('Content-Length',str(len(data)))
            self.send_header('Cache-Control','no-store');self.end_headers();self.wfile.write(data)
        def do_GET(self):
            url=urlparse(self.path);args=parse_qs(url.query)
            try:
                if url.path=='/':return self.send(Path(__file__).with_suffix('.html').read_bytes(),'text/html; charset=utf-8')
                if url.path=='/api/queue':
                    return self.send(dict(queueSha256=review.queue_sha,cards=[{k:v for k,v in r.items() if k!='source'} for r in review.cards.values()],labels=review.latest,suggestions=review.suggestions,storage=str(storage)))
                if url.path=='/api/search':return self.send(review.catalog_search(args.get('game',[''])[0],args.get('q',[''])[0]))
                if url.path=='/api/export':return self.send(load_json(review.export) if review.export.exists() else {'records':[]})
                if url.path in ('/crop','/photo'):
                    card=review.cards[args['id'][0]];path=Path(card['source']['path'])
                    if sha256_file(path)!=card['source']['sha256']:raise ValueError('Source image changed')
                    if url.path=='/photo':return self.send(path.read_bytes(),'image/jpeg')
                    from io import BytesIO
                    with Image.open(path) as im:crop=warp_reference(np.asarray(im.convert('RGB')),card['quad'],mapping='imageEdge',kernel='bilinear',inset=0.,border='black')
                    data=BytesIO();Image.fromarray(crop).save(data,format='JPEG',quality=95)
                    return self.send(data.getvalue(),'image/jpeg')
                self.send({'error':'Not found'},status=404)
            except (ValueError,KeyError) as error:self.send({'error':str(error)},status=400)
        def do_POST(self):
            if self.path!='/api/save':return self.send({'error':'Not found'},status=404)
            if self.headers.get('Origin') not in (None,f'http://127.0.0.1:{port}',f'http://localhost:{port}'):
                return self.send({'error':'Unexpected origin'},status=403)
            try:
                size=int(self.headers.get('Content-Length',0))
                if not 0<size<16384:raise ValueError('Invalid request size')
                self.send(review.save(json.loads(self.rfile.read(size))))
            except (ValueError,KeyError) as error:self.send({'error':str(error)},status=400)
    print(f'Identity review: http://127.0.0.1:{port}/ | saves: {storage}',flush=True)
    ThreadingHTTPServer(('127.0.0.1',port),Handler).serve_forever()


if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);sub=p.add_subparsers(dest='action',required=True)
    b=sub.add_parser('build');b.add_argument('--session-inputs',type=Path,required=True);b.add_argument('--output',type=Path,required=True)
    s=sub.add_parser('serve');s.add_argument('--queue',type=Path,required=True);s.add_argument('--models-root',type=Path,required=True)
    s.add_argument('--storage',type=Path,required=True);s.add_argument('--port',type=int,default=8776)
    s.add_argument('--suggestions',type=Path)
    a=p.parse_args()
    if a.action=='build':print(len(build(a.session_inputs,a.output)['cards']))
    else:serve(a.queue,a.models_root,a.storage,a.port,a.suggestions)
