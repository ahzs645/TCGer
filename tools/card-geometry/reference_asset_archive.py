#!/usr/bin/env python3
"""Create and verify a deduplicated, portable archive from an explicit file plan."""
import argparse
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import shutil
import tarfile
import tempfile


def digest(path):
    h=hashlib.sha256()
    with path.open('rb') as handle:
        for chunk in iter(lambda:handle.read(1024*1024),b''):h.update(chunk)
    return h.hexdigest()


def relative_path(value):
    path=PurePosixPath(value)
    if path.is_absolute() or '..' in path.parts or not path.parts or '\\' in value:
        raise ValueError('Unsafe archive path: '+value)
    return path


def create(root, plan_path, destination):
    destination.mkdir(parents=True,exist_ok=False)
    plan=json.loads(plan_path.read_text());objects={};rows=[];inode_cache={};logical=0
    temporary=destination/'objects.tar.gz.partial'
    with tarfile.open(temporary,'w:gz',compresslevel=1) as archive:
        for index,spec in enumerate(plan['files']):
            relative=relative_path(spec['path']);source=root/relative
            if not source.is_file():raise ValueError('Source missing: '+str(relative))
            before=source.stat();signature=(before.st_dev,before.st_ino,before.st_size,before.st_mtime_ns)
            sha=inode_cache.get(signature) or digest(source);inode_cache[signature]=sha
            if spec.get('expectedSha256') and spec['expectedSha256']!=sha:
                raise ValueError('Pinned source changed: '+str(relative))
            if sha not in objects:
                member=tarfile.TarInfo('objects/'+sha);member.size=before.st_size;member.mode=0o600
                with source.open('rb') as handle:archive.addfile(member,handle)
                objects[sha]=before.st_size
            after=source.stat()
            if signature!=(after.st_dev,after.st_ino,after.st_size,after.st_mtime_ns):
                raise ValueError('Source changed during snapshot: '+str(relative))
            rows.append(dict(path=str(relative),sha256=sha,bytes=before.st_size,category=spec['category']))
            logical+=before.st_size
            if (index+1)%2000==0:
                print(json.dumps(dict(processed=index+1,total=len(plan['files']),uniqueObjects=len(objects))),flush=True)
    temporary.rename(destination/'objects.tar.gz')
    manifest=dict(schema='tcger-reference-assets/v1',files=rows,objects=objects,planSha256=digest(plan_path),
                  archiveToolSha256=digest(Path(__file__)),
                  sourceCodeRevision=plan['sourceCodeRevision'],logicalBytes=logical,uniqueBytes=sum(objects.values()))
    (destination/'manifest.json').write_text(json.dumps(manifest,separators=(',',':'))+'\n')
    shutil.copy2(plan_path,destination/'source-plan.json')
    verify(destination)
    return manifest


def verify(destination):
    manifest=json.loads((destination/'manifest.json').read_text());expected=manifest['objects'];seen=set();paths=set()
    for row in manifest['files']:
        relative_path(row['path'])
        if row['path'] in paths or expected.get(row['sha256'])!=row['bytes']:raise ValueError('Invalid file binding')
        paths.add(row['path'])
    with tarfile.open(destination/'objects.tar.gz','r|gz') as archive:
        for member in archive:
            sha=member.name.removeprefix('objects/')
            if not member.isfile() or sha not in expected or sha in seen or member.name!='objects/'+sha:
                raise ValueError('Unexpected or duplicate archive object')
            h=hashlib.sha256();size=0
            with archive.extractfile(member) as handle:
                for chunk in iter(lambda:handle.read(1024*1024),b''):h.update(chunk);size+=len(chunk)
            if h.hexdigest()!=sha or size!=expected[sha]:raise ValueError('Archive object checksum mismatch')
            seen.add(sha)
    if seen!=set(expected):raise ValueError('Archive is incomplete')
    receipt=dict(verified=True,files=len(manifest['files']),uniqueObjects=len(expected),
        logicalBytes=manifest['logicalBytes'],uniqueBytes=manifest['uniqueBytes'],archiveBytes=(destination/'objects.tar.gz').stat().st_size,
        archiveSha256=digest(destination/'objects.tar.gz'),manifestSha256=digest(destination/'manifest.json'))
    (destination/'verification.json').write_text(json.dumps(receipt,indent=2)+'\n')
    return receipt


def restore(destination,output,prefix=''):
    receipt=json.loads((destination/'verification.json').read_text())
    if digest(destination/'manifest.json')!=receipt['manifestSha256'] or digest(destination/'objects.tar.gz')!=receipt['archiveSha256']:
        raise ValueError('Archive or manifest differs from verified receipt')
    if prefix:relative_path(prefix)
    manifest=json.loads((destination/'manifest.json').read_text());selected={}
    for row in manifest['files']:
        relative_path(row['path'])
        if row['path'].startswith(prefix):selected.setdefault(row['sha256'],[]).append(row)
    if not selected:raise ValueError('No matching files')
    output.mkdir(parents=True,exist_ok=False);restored=0
    with tempfile.TemporaryDirectory(dir=output) as scratch:
        with tarfile.open(destination/'objects.tar.gz','r|gz') as archive:
            for member in archive:
                sha=member.name.removeprefix('objects/')
                if sha not in selected:continue
                if not member.isfile() or member.name!='objects/'+sha:raise ValueError('Invalid object')
                temporary=Path(scratch)/sha
                with archive.extractfile(member) as source,temporary.open('wb') as target:shutil.copyfileobj(source,target)
                if digest(temporary)!=sha:raise ValueError('Restored object checksum mismatch')
                for row in selected.pop(sha):
                    target=output/relative_path(row['path']);target.parent.mkdir(parents=True,exist_ok=True)
                    shutil.copyfile(temporary,target);restored+=1
                temporary.unlink()
    if selected:raise ValueError('Restore incomplete')
    return dict(restoredFiles=restored,independentCopies=True,prefix=prefix)


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);sub=parser.add_subparsers(dest='action',required=True)
    c=sub.add_parser('create');c.add_argument('--root',type=Path,required=True);c.add_argument('--plan',type=Path,required=True);c.add_argument('--destination',type=Path,required=True)
    v=sub.add_parser('verify');v.add_argument('--destination',type=Path,required=True)
    r=sub.add_parser('restore');r.add_argument('--destination',type=Path,required=True);r.add_argument('--output',type=Path,required=True);r.add_argument('--prefix',default='')
    a=parser.parse_args()
    if a.action=='create':create(a.root,a.plan,a.destination)
    elif a.action=='verify':print(json.dumps(verify(a.destination)))
    else:print(json.dumps(restore(a.destination,a.output,a.prefix)))
