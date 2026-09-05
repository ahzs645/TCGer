#!/usr/bin/env python3
"""Finalize reviewed capture backgrounds against frozen evaluation and Dev sessions."""

from __future__ import annotations

import argparse
import json
import shutil
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from corpus_release import canonical_json, pretty_json, sha256_bytes, sha256_file  # noqa: E402
from preflight import Expectations, run_preflight  # noqa: E402
from compositor.compositor import ASSET_MANIFEST_SCHEMA, CompositorError, _safe_relative  # noqa: E402


def excluded_sessions(evaluation_manifest: dict, devmode_root: Path) -> list[str]:
    if not devmode_root.is_dir():
        raise CompositorError('Dev Mode session directory is missing')
    sessions = set(evaluation_manifest.get('evaluationSessionDenylist', []))
    sessions.update(entry['leakageKeys']['sessionId'] for entry in evaluation_manifest.get('records', [])
                    if entry['leakageKeys'].get('sessionId'))
    sessions.update(path.name for path in devmode_root.iterdir() if path.is_dir())
    return sorted(sessions)


def validate_reviews(manifest: dict, reviews: dict, exclusions: list[str]) -> list[dict]:
    if manifest.get('role') != 'background' or manifest.get('schema') != ASSET_MANIFEST_SCHEMA:
        raise CompositorError('expected background candidate manifest')
    if reviews.get('schema') != 'https://tcger.app/reviews/card-geometry-background/v1':
        raise CompositorError('unsupported background review schema')
    by_asset = {}
    for review in reviews.get('reviews', []):
        if not isinstance(review, dict) or not review.get('assetId') or review['assetId'] in by_asset:
            raise CompositorError('invalid or duplicate background review')
        by_asset[review['assetId']] = review
    accepted = []
    for asset in manifest['assets']:
        session = asset.get('provenance', {}).get('sourceSessionId')
        if not session:
            raise CompositorError('capture background lacks source session')
        # Reject excluded sessions even if a reviewer accidentally approved them.
        if session in exclusions:
            raise CompositorError(f'background source session is excluded: {session}')
        review = by_asset.get(asset['assetId'])
        if (review is None or review.get('cropSha256') != asset['sha256']
                or review.get('sourceSessionId') != session
                or not isinstance(review.get('reviewer'), str) or not review['reviewer'].strip()
                or review.get('verdict') not in {'card-free', 'reject'}):
            raise CompositorError(f'missing or mismatched review: {asset["assetId"]}')
        if review['verdict'] == 'card-free':
            accepted.append({**asset, 'provenance': {**asset['provenance'], 'backgroundReview': {
                'reviewer': review['reviewer'], 'cropSha256': review['cropSha256'],
                'sourceSessionId': session, 'verdict': 'card-free',
                'sessionExclusionsSha256': sha256_bytes(canonical_json(exclusions))}}})
    return accepted


def finalize(*, candidates: Path, reviews: Path, evaluation_release: Path,
             evaluation_corpus_hash: str, devmode_root: Path, output: Path) -> dict:
    report = run_preflight(evaluation_release,
        expectations=Expectations(corpus_hash=evaluation_corpus_hash, purpose='evaluation'))
    if report['failedChecks']:
        raise CompositorError(f'evaluation preflight failed: {report["failedChecks"]}')
    evaluation = json.loads((evaluation_release/'manifest.json').read_text())
    exclusions = excluded_sessions(evaluation, devmode_root)
    manifest = json.loads(candidates.read_text())
    accepted = validate_reviews(manifest, json.loads(reviews.read_text()), exclusions)
    if not accepted:
        raise CompositorError('no reviewed eligible background crops')
    for asset in accepted:
        source = _safe_relative(candidates.parent, asset['path'])
        if sha256_file(source) != asset['sha256']:
            raise CompositorError(f'reviewed crop bytes changed: {asset["assetId"]}')
    if output.exists():
        raise CompositorError('refusing to replace background output')
    output.mkdir(parents=True)
    (output/'assets').mkdir()
    for asset in accepted:
        source = _safe_relative(candidates.parent, asset['path'])
        relative = f'assets/{asset["sha256"]}{source.suffix.lower()}'
        shutil.copyfile(source,output/relative)
        if sha256_file(output/relative) != asset['sha256']:
            raise CompositorError('crop changed while copying')
        asset['path'] = relative
    document = {'schema': ASSET_MANIFEST_SCHEMA, 'role': 'background', 'assets': accepted,
                'sessionExclusions': exclusions,
                'reviewEvidence': {'candidateManifestSha256': sha256_file(candidates),
                                   'reviewManifestSha256': sha256_file(reviews),
                                   'evaluationCorpusHash': evaluation_corpus_hash,
                                   'devModeSessionInventorySha256': sha256_bytes(canonical_json(
                                       sorted(p.name for p in devmode_root.iterdir() if p.is_dir())))}}
    (output/'background-assets.json').write_text(pretty_json(document))
    return document


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ('candidates','reviews','evaluation-release','devmode-root','output'):
        parser.add_argument('--'+name,type=Path,required=True)
    parser.add_argument('--evaluation-corpus-hash',required=True)
    args=parser.parse_args()
    document=finalize(**vars(args))
    print(pretty_json({'assets':len(document['assets']),'excludedSessions':len(document['sessionExclusions'])}))
