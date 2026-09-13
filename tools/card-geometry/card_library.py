#!/usr/bin/env python3
"""Read-only, refreshable inventory of saved card geometry across current sources."""
import argparse
from collections import Counter
from datetime import datetime, timezone
import hashlib
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import io
import json
import re
from pathlib import Path
import shutil
import subprocess
import tarfile
import tempfile
import threading
from urllib.parse import parse_qs, urlparse

from PIL import Image, ImageOps

ROOT = Path(__file__).resolve().parents[2]
HERE = Path(__file__).resolve().parent
STATE = ROOT / '.artifacts/card-geometry/coverage-library'
FACETS = ('sourceKind', 'collection', 'split', 'quality', 'rotationBin', 'borderAxis15', 'skewBin', 'location', 'sizeBin', 'edgeBin', 'overlapBin', 'scene', 'session')


def read(path):
    return json.loads(Path(path).read_text())


def sha(path):
    result = hashlib.sha256()
    with Path(path).open('rb') as stream:
        for chunk in iter(lambda: stream.read(1 << 20), b''):
            result.update(chunk)
    return result.hexdigest()


def atomic(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(dir=path.parent, delete=False) as stream:
        temporary = Path(stream.name)
        stream.write(json.dumps(value, ensure_ascii=False, allow_nan=False).encode())
    temporary.replace(path)


def default_config():
    artifacts = ROOT / '.artifacts/card-geometry'
    reference = Path.home() / 'Library/CloudStorage/GoogleDrive-ahzs645@gmail.com/My Drive/Projects/TCG/Reference'
    return dict(schema='tcger-card-library-config/v1', releases=[
        dict(path=str(artifacts / 'releases/card-geometry-orientation-validation-v2'), collection='training', priority=50),
        dict(path=str(artifacts / 'releases/real-geometry-evaluation-v6-full-aliases-v2'), collection='benchmark', priority=40),
        dict(path=str(artifacts / 'releases/synthetic-geometry-multigame-bakeoff-eval-v1-aliases-v2'), collection='benchmark', priority=40)],
        journals=[
            dict(queue=str(artifacts / 'successor-prep/archive-corner-label-queue-padding-fixed.json'), journal=str(artifacts / 'archive-corner-labels/journal-padding-fixed.jsonl'), studioPort=8768, collection='archive-review'),
            dict(queue=str(artifacts / 'reference-corner-review/queue-v1.json'), journal=str(artifacts / 'reference-corner-review/journal-v1.jsonl'), studioPort=8770, collection='reference-review')],
        sessionExportFolder=str(Path.home() / '.local/share/TCGer/studio-backup/fiftyone/sessions'),
        sessionJournal=str(reference / 'TCGer-Labeling/fiftyone-sessions/journal.jsonl'))


def latest_journal(path):
    result = {}
    for line in Path(path).read_text().splitlines():
        if line.strip():
            row = json.loads(line)
            result[row.get('recordId', row.get('key'))] = row
    return result


def instance(item, index):
    corners = item.get('corners') or []
    if len(corners) == 4 and isinstance(corners[0], dict):
        quad = [[c['point']['x'], c['point']['y']] for c in corners] if all(c.get('coordinateKnown') for c in corners) else None
        sources = sorted({c.get('cornerSource', 'unknown') for c in corners})
        visibility = [c.get('visibility', 'unlabeled') for c in corners]
    else:
        quad = corners if len(corners) == 4 else None
        sources = [item.get('cornerSource', 'human')]
        visibility = item.get('cornerVisibility', ['unlabeled'] * 4)
    quality = 'unmeasured' if not quad else 'reviewed' if sources == ['human'] else 'synthetic' if sources == ['synthetic'] else 'machine' if 'machine' in sources else 'imported'
    return dict(instanceId=str(item.get('instanceId', 'card-' + str(index))), quad=quad,
                orientationKnown=item.get('orientationKnown') is True, quality=quality,
                cornerSources=sources, cornerVisibility=visibility, side=item.get('side', 'unknown'),
                physicalCardId=item.get('physicalCardId'), annotationIndex=item.get('sourceAnnotationIndex', index))


def combine_frames(frames):
    """One photo per exact image hash; newer manual labels take precedence."""
    unique = {}
    for frame in frames:
        key = frame['imageSha256']
        old = unique.get(key)
        memberships = [dict(collection=frame['collection'], split=frame['split'], recordId=frame['recordId'])]
        aliases = [frame['recordId']]
        if old:
            memberships = old['memberships'] + memberships
            aliases = old['aliases'] + aliases
            if old['priority'] > frame['priority']:
                frame = old
        unique[key] = {**frame, 'id': key, 'memberships': memberships, 'aliases': sorted(set(aliases))}
    for frame in unique.values():
        splits = {m['split'] for m in frame['memberships']} & {'train', 'validation', 'test'}
        frame['split'] = next(iter(splits)) if len(splits) == 1 else 'mixed' if splits else 'library'
    return list(unique.values())


def build(config, state):
    frames = []; by_record = {}; pins = []; errors = []; unlabelled = []
    for source in config['releases']:
        root = Path(source['path']); manifest = read(root / 'manifest.json')
        pins.append(dict(kind='release', path=str(root / 'manifest.json'), sha256=sha(root / 'manifest.json'), records=len(manifest['records'])))
        for entry in manifest['records']:
            path = root / entry['path']
            if sha(path) != entry['sha256']:
                raise ValueError('Changed release record: ' + str(path))
            record = read(path); src = record['source']
            frame = dict(recordId=record['recordId'], reference=record['recordId'],
                imagePath=str(root / src['path']), imageSha256=src['sha256'], width=src['width'], height=src['height'],
                sourceKind=src['kind'], collection=source['collection'], split=entry['split'], scene=entry['sceneSlice'],
                archive=entry['leakageKeys'].get('sourceArchiveId', ''), session=entry['leakageKeys'].get('captureSessionId', ''),
                variantGroups=entry['leakageKeys'].get('sourceAssetIds', []), priority=source['priority'],
                instances=[instance(v, i) for i, v in enumerate(record['instances'])])
            by_record[frame['recordId']] = frame
            frames.append(frame)
    for source in config.get('journals', []):
        queue_path = Path(source['queue']); journal_path = Path(source['journal'])
        queue = read(queue_path); queue_sha = sha(queue_path); saved = latest_journal(journal_path)
        pins.extend([dict(kind='queue', path=str(queue_path), sha256=sha(queue_path)), dict(kind='journal', path=str(journal_path), sha256=sha(journal_path))])
        order = {'multi_card_grid_archive': 0, 'multi_card_scatter_archive': 1, 'multi_card_other_archive': 2}
        ordered = sorted(queue['frames'], key=lambda f: (order.get(f['sceneSlice'], 9), f['recordId']))
        for index, queued in enumerate(ordered, 1):
            row = saved.get(queued['recordId'])
            frame = by_record.get(queued['recordId'])
            if row is None or frame is None:
                continue
            if row['pins']['queueSha256'] != queue_sha or row['imageSha256'] != queued['imageSha256'] or frame['imageSha256'] != row['imageSha256']:
                raise ValueError('Journal/image binding differs: ' + queued['recordId'])
            frame = {**frame, 'instances': [dict(i) for i in frame['instances']],
                     'collection': source['collection'], 'priority': 90, 'reference': 'F' + str(index),
                     'studioUrl': f"http://127.0.0.1:{source['studioPort']}/?review={index}",
                     'reviewComplete': row['complete']}
            existing = {str(item['annotationIndex']): item for item in frame['instances']}
            for key, target in row['targets'].items():
                item = existing.get(key)
                if item is None:
                    continue
                if key in row.get('drafts', {}):
                    item.update(quad=None, quality='draft', orientationKnown=False)
                elif 'skip' in target:
                    item.update(quad=None, quality='skipped', orientationKnown=False)
                else:
                    updated = instance({**target, 'instanceId': item['instanceId'], 'sourceAnnotationIndex': int(key)}, int(key))
                    item.update(updated)
            frame['occlusionRelations'] = row.get('occlusionRelations', [])
            frames.append(frame)
    session_rows = []
    for bundle in sorted(Path(config['sessionExportFolder']).glob('*.tar.gz')):
        with tarfile.open(bundle) as archive:
            metadata = json.load(archive.extractfile('metadata.json'))
            if metadata.get('name') != 'tcger-sessions':
                continue
            session_rows.extend(json.load(archive.extractfile('samples.json'))['samples'])
            pins.append(dict(kind='native-session-export', path=str(bundle), sha256=sha(bundle)))
    journal = Path(config['sessionJournal'])
    current = latest_journal(journal) if journal.exists() else {}
    if journal.exists():
        pins.append(dict(kind='session-journal', path=str(journal), sha256=sha(journal)))
    for sample in session_rows:
        key = sample.get('key', str(sample['_id'])); sample = {**sample, **current.get(key, {})}
        path = Path(sample['filepath'])
        if not path.is_file():
            errors.append(dict(recordId=key, error='Session photo unavailable', path=str(path)));continue
        parsed = json.loads(sample.get('manual_instances_json') or 'null')
        if parsed is not None:
            items = [instance(v, i) for i, v in enumerate(parsed.get('instances', []))]
            if parsed.get('noLabelableCard'):
                items = []
        elif sample.get('fixed_quad_source') == 'manual' and sample.get('fixed_quad_json'):
            quad = json.loads(sample['fixed_quad_json']) if isinstance(sample['fixed_quad_json'], str) else sample['fixed_quad_json']
            if isinstance(quad, dict):
                quad = quad.get('points')
            items = [instance(dict(corners=quad or [], orientationKnown=False), 0)]
        else:
            items = []
        with Image.open(path) as image:
            width, height = image.size
            if image.getexif().get(274, 1) != 1:
                errors.append(dict(recordId=key, error='EXIF pixel mapping requires verification'));continue
        digest = sha(path)
        number = re.search(r'frame-(\d+)', Path(key).name)
        reference = 'F' + str(int(number[1]) + 1) if number else Path(key).name
        frame = dict(recordId=key, reference=reference, imagePath=str(path), imageSha256=digest,
            width=width, height=height, sourceKind='real', collection='sessions', split='library',
            scene=(parsed or {}).get('sceneSlice', 'session-unclassified'), session=sample.get('session', key.split('/')[0]),
            archive='', priority=100 if items else 0, instances=items,
            reviewComplete=bool(parsed), studioUrl='http://127.0.0.1:8772/?photo=' + key)
        if not items:
            unlabelled.append(key)
        frames.append(frame)
    source_count = len(frames)
    frames = combine_frames(frames)
    with tempfile.TemporaryDirectory() as directory:
        input_path = Path(directory) / 'input.json'; output_path = Path(directory) / 'output.json'
        input_path.write_text(json.dumps(frames))
        subprocess.run([shutil.which('node') or '/opt/homebrew/bin/node', str(HERE / 'card_library_geometry.cjs'), str(input_path), str(output_path)], check=True)
        measured = read(output_path)
    result = dict(schema='tcger-card-coverage-library/v1', builtAt=datetime.now(timezone.utc).isoformat(),
        inputPins=pins, sourceEntries=source_count, exactDuplicateEntriesCollapsed=source_count-len(frames),
        errors=errors, sessionPhotosWithoutSavedQuads=len(unlabelled),
        measurementSourceSha256=sha(HERE / 'card_library_geometry.cjs'), editorGeometrySha256=sha(HERE / 'corner-editor/geometry.js'),
        notes=['Rotation uses the printed TL to TR edge in source pixels. Unknown printed top stays unknown; border shape alone cannot distinguish upright from upside-down.',
               'Skew is the largest corner-angle deviation from 90 degrees, not calibrated 3D tilt. Position is within the image, not geographic location.',
               'Border-axis angle uses the longer projected pair of opposite edges, modulo 180 degrees. It is measurable without printed-top labels, but strong perspective can change which pair looks longer. It is not an upright/upside-down classifier.',
               'Overlap counts full outlines intersecting by more than 1% of the smaller outline. It does not infer front/back order.',
               'Counts are card appearances, not distinct physical cards. Exact image hashes collapse repeated exports; near-duplicates and color/grayscale variants remain distinct.',
               'This library combines current training/validation releases, frozen evaluations, saved archive/reference journals, and the session library. Derived model crops and older release copies are not additional photos.',
               'Real and synthetic examples have separate filters. Draft, skipped, and incomplete outlines are not treated as measured labels. Original labels, release splits and benchmarks are never changed.'], **measured)
    # Fail if a saved source changed during the build; keep the previous library.
    for pin in pins:
        if sha(pin['path']) != pin['sha256']:
            raise ValueError('Source changed during build; refresh again: ' + pin['path'])
    atomic(state / 'library.json', result)
    atomic(state / 'summary.json', summarize(result, {}))
    return result


def select_cards(data, filters):
    rows = data['cards']
    for key in FACETS:
        if filters.get(key):
            rows = [r for r in rows if r.get(key, 'unknown') == filters[key]]
    if filters.get('q'):
        query = filters['q'].lower()
        photos = {p['id'] for p in data['frames'] if query in (' '.join(p['aliases']) + ' ' + p.get('reference', '') + ' ' + p.get('archive', '') + ' ' + p.get('session', '')).lower()}
        rows = [r for r in rows if r['photoId'] in photos]
    return rows


def summarize(data, filters):
    rows = select_cards(data, filters)
    return dict(builtAt=data['builtAt'], totalPhotos=len(data['frames']), totalCards=len(data['cards']),
        photos=len({r['photoId'] for r in rows}), cards=len(rows), measured=sum(r['valid'] for r in rows),
        orientationKnown=sum(r['valid'] and r['orientationKnown'] for r in rows),
        photosWithoutOutlines=sum(f['cardCount'] == 0 for f in data['frames']),
        exactDuplicateEntriesCollapsed=data['exactDuplicateEntriesCollapsed'],
        facets={key: dict(Counter(str(r.get(key, 'unknown')) for r in rows)) for key in FACETS},
        rotation15=dict(Counter(r.get('rotation15', 'unknown') for r in rows)), notes=data['notes'], errors=data['errors'])


class Library:
    def __init__(self, config, state):
        self.config, self.state = config, state
        self.data = read(state / 'library.json') if (state / 'library.json').exists() else None
        self.lock = threading.Lock(); self.busy = False; self.error = None
        self.photos = {f['id']: f for f in self.data['frames']} if self.data else {}

    def rebuild(self):
        if not self.lock.acquire(blocking=False):
            return
        self.busy = True; self.error = None
        try:
            result = build(read(self.config), self.state)
            self.photos = {f['id']: f for f in result['frames']}; self.data = result
        except Exception as error:
            self.error = str(error)
        finally:
            self.busy = False; self.lock.release()


def handler(library):
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *args):
            pass

        def send(self, value, content_type='application/json', status=200):
            body = value if isinstance(value, bytes) else json.dumps(value, allow_nan=False).encode()
            self.send_response(status); self.send_header('Content-Type', content_type)
            self.send_header('Content-Length', str(len(body))); self.send_header('Cache-Control', 'no-store')
            self.send_header('X-Content-Type-Options', 'nosniff'); self.end_headers(); self.wfile.write(body)

        def do_GET(self):
            parsed = urlparse(self.path)
            if parsed.path == '/':
                return self.send((HERE / 'card-library.html').read_bytes(), 'text/html; charset=utf-8')
            if parsed.path == '/api/status':
                return self.send(dict(busy=library.busy, error=library.error, builtAt=library.data and library.data['builtAt'], config=str(library.config)))
            if library.data is None:
                return self.send(dict(error=library.error or 'Library is being built'), status=503)
            if parsed.path == '/api/coverage':
                filters = {k: v[0] for k, v in parse_qs(parsed.query).items()}
                summary = summarize(library.data, filters); rows = select_cards(library.data, filters)
                offset = max(0, int(filters.get('offset', 0)))
                page = rows[offset:offset+48]
                return self.send(dict(**summary, options={k: sorted({str(r.get(k, 'unknown')) for r in library.data['cards']}) for k in FACETS},
                    rows=[{**r, 'photo': {k: v for k, v in library.photos[r['photoId']].items() if k not in ('imagePath', 'priority')}} for r in page], offset=offset))
            if parsed.path == '/api/export':
                return self.send(library.data)
            if parsed.path.startswith('/image/'):
                key = parsed.path.rsplit('/', 1)[-1].removesuffix('.jpg')
                photo = library.photos.get(key)
                if not photo:
                    return self.send(dict(error='Unknown photo'), status=404)
                path = Path(photo['imagePath'])
                cache = library.state / 'cache' / (key + '.jpg')
                if not cache.exists():
                    if sha(path) != photo['imageSha256']:
                        return self.send(dict(error='Photo changed since indexing'), status=409)
                    with Image.open(path) as image:
                        image = ImageOps.exif_transpose(image).convert('RGB'); image.thumbnail((640, 640))
                        cache.parent.mkdir(exist_ok=True)
                        with tempfile.NamedTemporaryFile(dir=cache.parent, delete=False) as temporary:
                            image.save(temporary, format='JPEG', quality=86)
                            temporary_path = Path(temporary.name)
                        temporary_path.replace(cache)
                return self.send(cache.read_bytes(), 'image/jpeg')
            return self.send(dict(error='Not found'), status=404)

        def do_POST(self):
            if self.path != '/api/rebuild':
                return self.send(dict(error='Not found'), status=404)
            origin = self.headers.get('Origin')
            if origin not in (f'http://{self.headers.get("Host")}',):
                return self.send(dict(error='Use the local library page to refresh'), status=403)
            if not library.busy:
                threading.Thread(target=library.rebuild, daemon=True).start()
            self.send(dict(started=True))
    return Handler


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--config', type=Path, default=STATE / 'config.json')
    parser.add_argument('--state', type=Path, default=STATE)
    parser.add_argument('--port', type=int, default=8775)
    parser.add_argument('--build', action='store_true')
    args = parser.parse_args()
    if not args.config.exists():
        atomic(args.config, default_config())
    if args.build:
        result = build(read(args.config), args.state)
        print(json.dumps(summarize(result, {}), indent=2))
    else:
        library = Library(args.config, args.state)
        if library.data is None:
            threading.Thread(target=library.rebuild, daemon=True).start()
        print(f'Card coverage library: http://127.0.0.1:{args.port}/', flush=True)
        ThreadingHTTPServer(('127.0.0.1', args.port), handler(library)).serve_forever()
