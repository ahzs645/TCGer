#!/usr/bin/env python3
"""Audit four-way recognition as an offline printed-top proposal source.

Never changes source labels or releases. Identity confidence and orientation
confidence are separate gates; existing known tops provide a diagnostic check.
"""
import argparse
from collections import Counter
import hashlib
import json
from pathlib import Path
import struct

import numpy as np
from PIL import Image

from crop_parity import EncoderRuntime
from recognition_orientation import recognize_quad


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def choose_top(games, minimum_phase_margin=.05):
    """Abstain if identity is weak, phases tie, or confident encoders disagree."""
    candidates = []
    for game, result in games.items():
        if not result['accepted']:
            continue
        phases = sorted(result['phases'], key=lambda p: p['topScore'], reverse=True)
        if len(phases) != 4 or len({p['phase'] for p in phases}) != 4:
            raise ValueError('Four distinct cyclic phases are required')
        margin = phases[0]['topScore'] - phases[1]['topScore']
        candidates.append(dict(game=game, phase=phases[0]['phase'], phaseMargin=margin,
                               family=result['family'], topScore=result['topScore']))
    if not candidates:
        return dict(proposed=False, reason='identity-not-confident', phase=None)
    if len({c['phase'] for c in candidates}) != 1:
        return dict(proposed=False, reason='encoders-disagree-on-top', phase=None, candidates=candidates)
    if any(c['phaseMargin'] < minimum_phase_margin for c in candidates):
        return dict(proposed=False, reason='ambiguous-orientation', phase=None, candidates=candidates)
    return dict(proposed=True, reason='orientation-proposal', phase=candidates[0]['phase'], candidates=candidates)


def load_runtime(root, game, pins):
    import onnxruntime as ort
    folder = root / game
    for kind in ['onnx', 'metadata', 'vectors']:
        path = folder / Path(pins[kind]['path']).name
        if digest(path) != pins[kind]['sha256']:
            raise ValueError(f'Changed recognition input: {game}/{kind}')
    metadata = json.loads((folder / 'CardsIndexMetadata.json').read_text())
    raw = (folder / 'CardsIndexVectors-arcface.bin').read_bytes()
    count, dimension = struct.unpack('<II', raw[:8])
    vectors = np.frombuffer(raw[8:], dtype=np.int8).reshape(count, dimension).astype(np.float32)
    with np.errstate(invalid='ignore', divide='ignore'):
        vectors /= np.linalg.norm(vectors, axis=1, keepdims=True)
    if count != len(metadata):
        raise ValueError('Index/metadata count differs')
    options = ort.SessionOptions(); options.intra_op_num_threads = 2; options.inter_op_num_threads = 1
    session = ort.InferenceSession(str(folder / 'card-embeddings-arcface-fp32.onnx'), sess_options=options, providers=['CPUExecutionProvider'])
    return EncoderRuntime(game, pins['strongThreshold'], session, session.get_inputs()[0].name,
                          vectors, [r.get('recognitionFamilyId') or r['cardId'] for r in metadata], pins['queryNormalization'])


def run(args):
    library_bytes = args.library.read_bytes()
    library = json.loads(library_bytes)
    frames = {f['id']: f for f in library['frames']}
    cards = [c for c in library['cards'] if c['sourceKind'] == 'real' and c['quality'] == 'reviewed' and c['valid']]
    # The previously frozen 75-photo session is not used to validate a new gate.
    cards = [c for c in cards if not (c['orientationKnown'] and frames[c['photoId']].get('session') == 'scan-session-20260909-231206')]
    cards.sort(key=lambda c: (not c['orientationKnown'], c['photoId'], c['card']))
    spec = json.loads(args.model_config.read_text())['evaluations']['recognitionModels']
    args.output.mkdir(parents=True, exist_ok=True)
    protocol = dict(schema='tcger-printed-top-proposals/v1', librarySha256=hashlib.sha256(library_bytes).hexdigest(),
                    recognitionModels=spec, modelConfigSha256=digest(args.model_config),
                    codeSha256=digest(Path(__file__)), recognitionCodeSha256=digest(Path(__file__).with_name('recognition_orientation.py')),
                    cropCodeSha256=digest(Path(__file__).with_name('crop_parity.py')),
                    minimumPhaseMargin=.05, targetIds=[c['id'] for c in cards],
                    proposalOnly=True, frozenLabelsChanged=False, trainingReleaseChanged=False,
                    calibration='Existing explicitly known printed tops, excluding the frozen September 9 session. Fixed gate, not fitted to these labels; repeated cards/photos limit independence.',
                    knownExpectedPhase=0, orientationGate='Require accepted identity plus >=0.05 top-score difference between the two strongest phases within each accepting encoder. Accepting encoders must agree on phase. Never compare raw scores between different encoders.')
    protocol_path = args.output / 'protocol.json'
    if protocol_path.exists():
        if json.loads(protocol_path.read_text()) != protocol:
            raise ValueError('Existing audit uses different inputs or code; use a new output directory')
    else:
        protocol_path.write_text(json.dumps(protocol, indent=2) + '\n')
    rows_path = args.output / 'rows.jsonl'
    rows = [json.loads(line) for line in rows_path.read_text().splitlines()] if rows_path.exists() else []
    done = {r['id'] for r in rows}
    if len(done) != len(rows) or not done.issubset({c['id'] for c in cards}):
        raise ValueError('Invalid resume rows')
    runtimes = {g: load_runtime(args.models_root, g, p) for g, p in spec['games'].items()}
    image = None; photo_id = None
    with rows_path.open('a') as handle:
        for index, card in enumerate(cards):
            if card['id'] in done:
                continue
            frame = frames[card['photoId']]
            if photo_id != card['photoId']:
                source = Path(frame['imagePath'])
                if digest(source) != frame['imageSha256']:
                    raise ValueError('Library source image changed')
                with Image.open(source) as opened:
                    image = np.asarray(opened.convert('RGB'))
                photo_id = card['photoId']
            games = {g: recognize_quad(runtime, image, card['quad']) for g, runtime in runtimes.items()}
            selection = choose_top(games)
            row = dict(id=card['id'], reference=frame.get('reference'), recordId=frame['recordId'], card=card['card'],
                       photoId=card['photoId'], imageSha256=frame['imageSha256'], originalQuad=card['quad'],
                       originallyKnown=card['orientationKnown'], split=card['split'], memberships=frame.get('memberships', []),
                       games=games, selection=selection, humanApproved=False)
            if selection['proposed']:
                phase = selection['phase']
                row['proposedQuad'] = card['quad'][phase:] + card['quad'][:phase]
                if card['orientationKnown']:
                    row['agreesWithKnownTop'] = phase == 0
            handle.write(json.dumps(row, separators=(',', ':')) + '\n'); handle.flush(); rows.append(row)
            if (index + 1) % 25 == 0:
                print(f'Orientation audit {index+1}/{len(cards)}', flush=True)
    known = [r for r in rows if r['originallyKnown']]
    proposed_known = [r for r in known if r['selection']['proposed']]
    unknown = [r for r in rows if not r['originallyKnown']]
    summary = dict(protocolSha256=digest(protocol_path), rowsSha256=digest(rows_path), complete=len(rows)==len(cards),
                   known=dict(total=len(known), proposals=len(proposed_known), agreeing=sum(r['agreesWithKnownTop'] for r in proposed_known), disagreeing=sum(not r['agreesWithKnownTop'] for r in proposed_known)),
                   unknown=dict(total=len(unknown), proposals=sum(r['selection']['proposed'] for r in unknown),
                                reasons=dict(Counter(r['selection']['reason'] for r in unknown)),
                                proposedBySplit=dict(Counter(r['split'] for r in unknown if r['selection']['proposed']))),
                   labelChanges=0, releaseChanges=0,
                   caveat='Recognition agreement does not make a human label. Unknown-target accuracy remains unmeasured; no source or frozen labels have been changed.')
    (args.output / 'summary.json').write_text(json.dumps(summary, indent=2) + '\n')
    assert args.library.read_bytes() == library_bytes
    print(json.dumps(summary, indent=2), flush=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ['library', 'model-config', 'models-root', 'output']:
        parser.add_argument('--'+name, type=Path, required=True)
    run(parser.parse_args())
