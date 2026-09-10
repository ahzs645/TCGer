#!/usr/bin/env python3
"""Reserve whole connected source groups from an existing training release.

This changes split assignments only, preserving label provenance and pixels.
Existing validation records never move back into training. It does not import
the repeatedly inspected evaluation sets or the newly reviewed phone session.
"""
import argparse
import copy
from collections import Counter, defaultdict
from pathlib import Path

from combine_geometry_releases import link_or_copy
from corpus_release import corpus_hash, load_json, sha256_file, write_json
from select_geometry_checkpoint import validation_coverage


def connected_groups(manifest):
    parents = list(range(len(manifest['records'])))
    seen = {}
    def find(i):
        while parents[i] != i:
            parents[i] = parents[parents[i]]
            i = parents[i]
        return i
    aliases = manifest['sourceArchiveAliases']
    for i, entry in enumerate(manifest['records']):
        keys = entry['leakageKeys']
        archive = aliases[keys['sourceArchiveId']]
        if aliases[archive] != archive:
            raise ValueError('Archive aliases must resolve directly')
        tokens = [('archive', archive)]
        for name in ['physicalCardIds', 'sourceAssetIds']:
            tokens += [(name, value) for value in keys.get(name, [])]
        if keys.get('sessionId'):
            tokens.append(('session', keys['sessionId']))
        tokens += [('image', image['sha256']) for image in entry['images']]
        for token in tokens:
            if token in seen:
                parents[find(i)] = find(seen[token])
            else:
                seen[token] = i
    groups = defaultdict(list)
    for i in range(len(parents)):
        groups[find(i)].append(i)
    return list(groups.values())


def prepare(source, output, archives, policy_path, reserved_sessions):
    if output.exists():
        raise FileExistsError('Preserve existing releases; choose a fresh output')
    manifest = load_json(source/'manifest.json')
    if corpus_hash(manifest) != manifest['corpusHash']:
        raise ValueError('Source corpus hash mismatch')
    present = {e['leakageKeys']['sourceArchiveId'] for e in manifest['records']}
    if not set(archives) <= present:
        raise ValueError('Requested archive is absent')
    if any(e['split'] not in ('train','validation') for e in manifest['records']):
        raise ValueError('This adapter accepts only an existing training pool')
    target = copy.deepcopy(manifest)
    moves = []
    for group in connected_groups(manifest):
        entries = [manifest['records'][i] for i in group]
        if len({e['split'] for e in entries}) != 1:
            raise ValueError('Input release already splits a connected group')
        reserve = any(e['leakageKeys']['sourceArchiveId'] in archives for e in entries)
        if reserve:
            for i in group:
                if target['records'][i]['split'] == 'train':
                    target['records'][i]['split'] = 'validation'
                    moves.append(target['records'][i]['recordId'])
    if not moves:
        raise ValueError('No training records were reserved')
    output.mkdir(parents=True)
    for original, entry in zip(manifest['records'], target['records'], strict=True):
        path = source/original['path']
        if sha256_file(path) != original['sha256']:
            raise ValueError('Source record hash mismatch')
        record = load_json(path)
        if record.get('grouping',{}).get('sessionId') in reserved_sessions:
            raise ValueError('Reserved evaluation session is in the training pool')
        # Splits belong to manifest entries, never to the immutable record schema.
        destination = output/entry['path']
        destination.parent.mkdir(parents=True, exist_ok=True)
        link_or_copy(path, destination)
        for image in entry['images']:
            destination = output/image['path']
            destination.parent.mkdir(parents=True, exist_ok=True)
            if not destination.exists():
                link_or_copy(source/image['path'], destination)
    policy = load_json(policy_path)
    write_json(output/'policy.json',policy)
    target.update(releaseId=output.name)
    target['readiness'].update(readinessPolicyId=policy['policyId'],readinessPolicySha256=sha256_file(output/'policy.json'))
    target['evaluationSessionDenylist'] = sorted(set(target['evaluationSessionDenylist']) | set(reserved_sessions))
    target['splitAssignment'].update(method='whole-connected-archive-validation-v1',
        archiveSplits={e['leakageKeys']['sourceArchiveId']:e['split'] for e in target['records']})
    target['corpusHash'] = corpus_hash(target)
    write_json(output/'manifest.json',target)
    coverage = validation_coverage(output)
    report = dict(schema='tcger-orientation-validation-preparation/v1',
        sourceCorpusHash=manifest['corpusHash'],sourceManifestSha256=sha256_file(source/'manifest.json'),
        corpusHash=target['corpusHash'],reservedArchives=archives,movedRecords=moves,
        splits=dict(Counter(e['split'] for e in target['records'])),coverage=coverage,
        labelsChanged=False,imagesChanged=False,
        caveats=['Reserved archives appeared in earlier models training; train this experiment from the generic pinned base, not their checkpoints.',
                 'Archive/source/known physical-card/exact-image groups are preserved; unrecorded cross-archive physical identity is not proven.',
                 'Real validation photos remain archive data; fresh phone photos are reserved for final evaluation.'])
    write_json(output/'validation-preparation.json',report)
    return report


if __name__ == '__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source',type=Path,required=True)
    parser.add_argument('--output',type=Path,required=True)
    parser.add_argument('--policy',type=Path,required=True)
    parser.add_argument('--reserve-archive',action='append',required=True)
    parser.add_argument('--reserved-session',action='append',default=[])
    args=parser.parse_args()
    result=prepare(args.source,args.output,args.reserve_archive,args.policy,args.reserved_session)
    print({k:result[k] for k in ('corpusHash','splits','coverage')})
