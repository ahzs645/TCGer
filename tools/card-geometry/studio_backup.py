#!/usr/bin/env python3
"""Automatic, versioned backups of studio state to a configurable local folder.

The destination may be a Google Drive synced folder. A verified filesystem
write does not assert that the Drive provider has completed remote syncing.
Live databases and generated media/model caches are never copied as databases.
"""
import argparse
from datetime import datetime, timezone
import hashlib
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import tempfile
import threading
import time
import subprocess
import sys
import io
import tarfile
import gzip
from urllib.parse import urlparse

ROOT=Path(__file__).resolve().parents[2]
DEFAULT_CONFIG=Path.home()/'.config/tcger/studio-backup.json'
DEFAULT_STATE=Path.home()/'.local/share/TCGer/studio-backup'
TEXT_EXTENSIONS={'.json','.jsonl','.md','.txt','.yaml','.yml','.toml','.py','.js','.cjs','.html','.css'}
PRUNE={'tooling-worktree','tooling-src','node_modules','.git','__pycache__','yolo-dataset','dataset',
       'releases','download','source-releases','staging','dataset-staging','publication-staging',
       'trainer-validation-venv','trainer-environment','venv','.venv','images','inspection-sheets',
       'gallery','training','weights','cache','.cache','logs','source','selection-smoke',
       'records','combined-v3-simulation','compositor-assets','models','base-checkpoints','evaluation-tooling',
       'references','reference','platform','native-report-download','label-crops','sample-panels'}

def digest(data):return hashlib.sha256(data).hexdigest()
def json_bytes(data):return (json.dumps(data,sort_keys=True,ensure_ascii=False,allow_nan=False,indent=2)+'\n').encode()
def now():return datetime.now(timezone.utc).isoformat()

def atomic(path,data):
    path.parent.mkdir(parents=True,exist_ok=True)
    fd,temporary=tempfile.mkstemp(prefix='.'+path.name+'.',dir=path.parent)
    try:
        with os.fdopen(fd,'wb') as handle:
            handle.write(data);handle.flush();os.fsync(handle.fileno())
        os.replace(temporary,path)
        if digest(path.read_bytes())!=digest(data):raise OSError('Backup readback mismatch')
    finally:
        if os.path.exists(temporary):os.unlink(temporary)

def validate_content(path,data):
    if path.suffix=='.json':json.loads(data)
    elif path.suffix=='.jsonl':
        if data and not data.endswith(b'\n'):raise ValueError(f'Journal write still in progress: {path.name}')
        for line in data.splitlines():
            if line.strip():json.loads(line)

def stable_read(path):
    before=path.stat();data=path.read_bytes();after=path.stat()
    if (before.st_mtime_ns,before.st_size)!=(after.st_mtime_ns,after.st_size):
        raise OSError('Source changed during backup; retrying next cycle')
    validate_content(path,data)
    return data

def default_config(folder,state):
    return dict(schema='tcger-studio-backup-config/v1',folder=str(folder),fileIntervalSeconds=10,
        fiftyoneIntervalSeconds=120,
        fiftyoneDatabases=[dict(name='sessions',dbpath=str(Path.home()/'.fiftyone/var/lib/mongo'),
                              python=str(Path.home()/'.venvs/tcger-label/bin/python')),
                          dict(name='scanner-review',dbpath=str(ROOT/'tools/scanner-review/.fiftyone/db'),
                              python=str(ROOT/'tools/scanner-review/.venv/bin/python'))],
        sources=[dict(path=str(ROOT/'.artifacts/card-geometry'),namespace='card-geometry'),
                 dict(path=str(state/'fiftyone'),namespace='fiftyone'),
                 dict(path=str(state/'fiftyone-exports.json'),namespace='backup-receipts',optional=True),
                 dict(path=str(ROOT/'tools/card-geometry'),namespace='studio-code'),
                 dict(path=str(ROOT/'docs/scanner-system'),namespace='scanner-docs')])

def native_bundle(folder):
    """Deterministic native FiftyOne metadata export; no media or Mongo files."""
    raw=io.BytesIO()
    with tarfile.open(fileobj=raw,mode='w') as archive:
        for path in sorted(folder.rglob('*')):
            if not path.is_file():continue
            data=path.read_bytes()
            if path.suffix=='.json':
                document=json.loads(data)
                # Reading the dataset updates last_loaded_at, without editing labels.
                if path.name=='metadata.json' and isinstance(document,dict):
                    document.pop('last_loaded_at',None)
                data=json_bytes(document)
            info=tarfile.TarInfo(path.relative_to(folder).as_posix());info.size=len(data)
            archive.addfile(info,io.BytesIO(data))
    return gzip.compress(raw.getvalue(),mtime=0)

def live_database_uri(dbpath):
    """Find only a running mongod with this exact data directory; never start one."""
    import psutil
    wanted=Path(dbpath).resolve()
    for process in psutil.process_iter(['name']):
        try:
            if process.info['name']!='mongod':continue
            args=process.cmdline() or []
            if '--dbpath' not in args:continue
            if Path(args[args.index('--dbpath')+1]).resolve()!=wanted:continue
            output=subprocess.run(['/usr/sbin/lsof','-nP','-a','-p',str(process.pid),'-iTCP','-sTCP:LISTEN','-Fn'],
                                  capture_output=True,text=True,check=True).stdout
            ports={int(line.rsplit(':',1)[1]) for line in output.splitlines() if line.startswith('n')}
            if len(ports)!=1:raise ValueError('Expected one local MongoDB port')
            return f'mongodb://127.0.0.1:{ports.pop()}'
        except (psutil.AccessDenied,psutil.NoSuchProcess):continue
    return None

def export_native_datasets(state,namespace):
    import fiftyone as fo
    counts={}
    for name in fo.list_datasets():
        if not name.startswith('tcger'):continue
        dataset=fo.load_dataset(name)
        with tempfile.TemporaryDirectory(prefix='tcger-fiftyone-export-') as temp:
            directory=Path(temp)/'dataset'
            dataset.export(export_dir=str(directory),dataset_type=fo.types.FiftyOneDataset,
                           export_media=False,progress=False)
            encoded=native_bundle(directory)
        target=state/'fiftyone'/namespace/(hashlib.sha256(name.encode()).hexdigest()[:16]+'.tar.gz')
        if not target.exists() or digest(target.read_bytes())!=digest(encoded):atomic(target,encoded)
        counts[name]=len(dataset)
    return counts

class Backups:
    def __init__(self,config_path=DEFAULT_CONFIG,state=DEFAULT_STATE):
        self.config_path=Path(config_path);self.state=Path(state);self.lock=threading.RLock();self.snapshot_lock=threading.Lock()
        self.status=dict(state='starting',lastSuccess=None,error=None,providerSync='not measured')
        receipts=self.state/'fiftyone-exports.json'
        if receipts.exists():self.status['fiftyoneExports']=json.loads(receipts.read_text())
        self.cache={};self.last_manifest=None;self.destination=None;self.last_integrity=0;self.previous_entries={}

    def config(self):
        return json.loads(self.config_path.read_text()) if self.config_path.exists() else None

    def configure(self,folder):
        path=Path(folder).expanduser()
        if not path.is_absolute():raise ValueError('Choose an absolute folder path')
        # Explicit setup may create the final folder, but not missing ancestors
        # such as an unavailable mounted/synced drive.
        if not path.parent.is_dir():raise ValueError('The parent folder is unavailable')
        path.mkdir(exist_ok=True)
        path=path.resolve()
        current=self.config() or default_config(path,self.state)
        for source in current['sources']:
            source_root=Path(source['path']).resolve()
            if path==source_root or source_root in path.parents:raise ValueError('Keep the backup outside watched source folders')
        probe=path/('.tcger-write-check-'+str(time.time_ns()))
        atomic(probe,b'TCGer backup write check\n');probe.unlink()
        with self.snapshot_lock:
            current['folder']=str(path)
            atomic(self.config_path,json_bytes(current));self.cache={};self.last_manifest=None
            self.status.update(state='pending',error=None)
        return self.public_status()

    def public_status(self):
        with self.lock:
            config=self.config()
            return {**self.status,'folder':config['folder'] if config else None,
                    'fileIntervalSeconds':config.get('fileIntervalSeconds',10) if config else 10,
                    'fiftyoneIntervalSeconds':config.get('fiftyoneIntervalSeconds',120) if config else 120}

    def inventory(self,config):
        files={}
        for source in config['sources']:
            root=Path(source['path'])
            if root.is_file():
                if not root.is_symlink():files[source['namespace']+'/'+root.name]=root
                continue
            if not root.is_dir():
                if source['namespace']=='fiftyone' or source.get('optional'):continue
                raise OSError(f'Watched source unavailable: {root}')
            for directory,dirs,names in os.walk(root):
                dirs[:]=[d for d in dirs if d not in PRUNE and not d.endswith(('-venv','.xcresult','-hub-staging')) and not d.startswith(('hf-stage-','recognition-models-')) and not (Path(directory)/d).is_symlink()]
                for name in names:
                    path=Path(directory)/name;relative=path.relative_to(root)
                    if path.is_symlink() or name.startswith('.'):continue
                    if path.suffix not in TEXT_EXTENSIONS and 'uploads' not in relative.parts and source['namespace']!='fiftyone':continue
                    key=source['namespace']+'/'+relative.as_posix()
                    files[key]=path
        return files

    def snapshot(self,force=False):
        with self.snapshot_lock:
            config=self.config()
            if not config:
                self.status.update(state='unconfigured');return self.public_status()
            destination=Path(config['folder'])
            try:
                if not destination.is_dir():raise OSError('Backup folder unavailable; local studio saves are retained')
                if str(destination)!=self.destination:
                    self.cache={};self.last_manifest=None;self.destination=str(destination)
                    self.previous_entries={}
                    if (destination/'latest.json').exists():
                        previous=json.loads((destination/'latest.json').read_text())
                        if digest(json_bytes(dict(schema=previous['schema'],files=previous['files'])))!=previous['contentSha256']:
                            raise ValueError('Previous backup manifest failed checksum')
                        self.previous_entries=previous['files'];self.last_manifest=previous['contentSha256']
                if force or time.monotonic()-self.last_integrity>3600:
                    self.cache={};self.last_integrity=time.monotonic()
                self.status['state']='copying'
                entries={};failures=[]
                for key,path in self.inventory(config).items():
                    try:
                        stat=path.stat();signature=(str(path),stat.st_size,stat.st_mtime_ns)
                        cached=self.cache.get(key)
                        if cached and cached[0]==signature:
                            obj=destination/'objects'/cached[1]['sha256'][:2]/cached[1]['sha256']
                            if obj.exists():entries[key]=cached[1];continue
                        data=stable_read(path);sha=digest(data)
                        object_path=destination/'objects'/sha[:2]/sha
                        if not object_path.exists():atomic(object_path,data)
                        elif digest(object_path.read_bytes())!=sha:
                            # Repair only from the stable source with exactly this hash.
                            atomic(object_path,data)
                            self.status['lastIntegrityRepair']=now()
                        entry=dict(sha256=sha,bytes=len(data),sourcePath=str(path))
                        entries[key]=entry;self.cache[key]=(signature,entry)
                    except (OSError,ValueError) as error:
                        failures.append(f'{key}: {error}')
                        if key in self.cache:entries[key]=self.cache[key][1]
                        elif self.previous_entries.get(key,{}).get('sourcePath')==str(path):
                            entries[key]=self.previous_entries[key]
                payload=dict(schema='tcger-studio-backup-manifest/v1',files=entries)
                content_sha=digest(json_bytes(payload))
                if content_sha!=self.last_manifest:
                    manifest={**payload,'createdAt':now(),'contentSha256':content_sha}
                    stamp=datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S.%fZ')
                    snapshot=destination/'snapshots'/f'{stamp}-{content_sha[:12]}.json'
                    atomic(snapshot,json_bytes(manifest));atomic(destination/'latest.json',json_bytes(manifest))
                    self.last_manifest=content_sha
                self.previous_entries=entries
                self.status.update(state='error' if failures else 'saved',error='; '.join(failures[:5]) or None,
                    lastCheck=now(),files=len(entries),
                    bytes=sum(v['bytes'] for v in entries.values()),manifestSha256=content_sha)
                if not failures:self.status['lastSuccess']=now()
            except (OSError,ValueError,TypeError) as error:
                self.status.update(state='error',error=str(error))
            atomic(self.state/'status.json',json_bytes(self.public_status()))
            return self.public_status()

    def export_fiftyone(self):
        """Export through the supported dataset API, never copy live Mongo files."""
        config=self.config()
        if not config:return
        receipt_path=self.state/'fiftyone-exports.json'
        receipts=json.loads(receipt_path.read_text()) if receipt_path.exists() else {}
        errors=[]
        for database in config.get('fiftyoneDatabases',[]):
            name=database['name'];record=receipts.setdefault(name,{})
            try:
                uri=live_database_uri(database['dbpath'])
                if not uri:
                    record.update(state='offline',error=None);continue
                env={**os.environ,'FIFTYONE_DATABASE_URI':uri,'FIFTYONE_DATABASE_DIR':database['dbpath'],
                     'FIFTYONE_DATABASE_ADMIN': 'false', 'FIFTYONE_DO_NOT_TRACK':'1'}
                result=subprocess.run([database['python'],str(Path(__file__).resolve()),'--export-native',name,
                                       '--state',str(self.state)],env=env,capture_output=True,text=True,timeout=300,check=True)
                counts=json.loads(result.stdout.split('TCGER_EXPORT=')[-1])
                record.update(state='exported',lastExport=now(),datasets=counts,error=None)
            except Exception as error:
                message=str(error)
                if isinstance(error,subprocess.CalledProcessError):message+=' '+error.stderr[-1500:]
                record.update(state='error',error=message);errors.append(name+': '+message)
        atomic(receipt_path,json_bytes(receipts))
        with self.lock:self.status.update(fiftyoneExports=receipts,fiftyoneError='; '.join(errors) or None)

    def loop(self):
        while True:
            self.snapshot()
            time.sleep(max(2,(self.config() or {}).get('fileIntervalSeconds',10)))

    def fiftyone_loop(self):
        while True:
            try:self.export_fiftyone()
            except Exception as error:
                with self.lock:self.status.update(fiftyoneError=str(error))
            time.sleep(max(30,(self.config() or {}).get('fiftyoneIntervalSeconds',120)))


def restore_files(folder,output):
    manifest=json.loads((folder/'latest.json').read_text())
    if digest(json_bytes(dict(schema=manifest['schema'],files=manifest['files'])))!=manifest['contentSha256']:
        raise ValueError('Backup manifest hash mismatch')
    if output.exists():raise FileExistsError('Restore into a new directory')
    for relative,entry in manifest['files'].items():
        path=Path(relative);sha=entry['sha256']
        if path.is_absolute() or '..' in path.parts or len(sha)!=64 or any(c not in '0123456789abcdef' for c in sha):raise ValueError('Unsafe backup manifest')
        data=(folder/'objects'/sha[:2]/sha).read_bytes()
        if digest(data)!=sha:raise ValueError('Backup object hash mismatch')
        atomic(output/path,data)
    return len(manifest['files'])


def handler(manager):
    class Handler(BaseHTTPRequestHandler):
        def log_message(self,*args):pass
        def send(self,data,status=200,kind='application/json'):
            body=data if isinstance(data,bytes) else json_bytes(data)
            self.send_response(status);self.send_header('Content-Type',kind);self.send_header('Cache-Control','no-store')
            origin=self.headers.get('Origin','')
            parsed=urlparse(origin)
            if self.command=='GET' and parsed.scheme=='http' and parsed.hostname in {'localhost','127.0.0.1'}:
                self.send_header('Access-Control-Allow-Origin',origin);self.send_header('Vary','Origin')
            self.send_header('Content-Length',str(len(body)));self.end_headers();self.wfile.write(body)
        def do_GET(self):
            if self.headers.get('Host','') not in {f'127.0.0.1:{self.server.server_port}',f'localhost:{self.server.server_port}'}:
                return self.send({'error':'Loopback host required'},403)
            if urlparse(self.path).path=='/api/status':return self.send(manager.public_status())
            if urlparse(self.path).path=='/':return self.send(Path(__file__).with_name('studio-backup.html').read_bytes(),kind='text/html; charset=utf-8')
            return self.send({'error':'Not found'},404)
        def do_POST(self):
            host=self.headers.get('Host','');origin=self.headers.get('Origin')
            allowed={f'127.0.0.1:{self.server.server_port}',f'localhost:{self.server.server_port}'}
            if host not in allowed or (origin and origin!=f'http://{host}') or self.headers.get('Content-Type')!='application/json':
                return self.send({'error':'Same-origin JSON requests only'},403)
            try:
                length=int(self.headers.get('Content-Length','0'))
                if not 0<length<=12000:raise ValueError('Invalid request size')
                payload=json.loads(self.rfile.read(length))
                if self.path=='/api/config':result=manager.configure(payload['folder'])
                elif self.path=='/api/snapshot':result=manager.snapshot(force=True)
                else:return self.send({'error':'Not found'},404)
                return self.send(result)
            except (KeyError,ValueError,OSError,TypeError) as error:return self.send({'error':str(error)},400)
    return Handler


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--config',type=Path,default=DEFAULT_CONFIG)
    parser.add_argument('--state',type=Path,default=DEFAULT_STATE)
    parser.add_argument('--configure-folder')
    parser.add_argument('--once',action='store_true')
    parser.add_argument('--with-fiftyone',action='store_true')
    parser.add_argument('--port',type=int,default=8774)
    parser.add_argument('--restore-files',type=Path)
    parser.add_argument('--output',type=Path)
    parser.add_argument('--export-native',help=argparse.SUPPRESS)
    args=parser.parse_args()
    if args.export_native:
        print('TCGER_EXPORT='+json.dumps(export_native_datasets(args.state,args.export_native)));return
    if args.restore_files:
        if not args.output:parser.error('--restore-files requires --output')
        print(restore_files(args.restore_files,args.output));return
    manager=Backups(args.config,args.state)
    if args.configure_folder:manager.configure(args.configure_folder)
    if args.once:
        if args.with_fiftyone:manager.export_fiftyone()
        result=manager.snapshot();print(json.dumps(result,indent=2))
        if result['state']!='saved':raise SystemExit(1)
        return
    server=ThreadingHTTPServer(('127.0.0.1',args.port),handler(manager))
    threading.Thread(target=manager.loop,daemon=True).start()
    if args.with_fiftyone:threading.Thread(target=manager.fiftyone_loop,daemon=True).start()
    server.serve_forever()

if __name__=='__main__':main()
