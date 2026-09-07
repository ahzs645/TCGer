#!/bin/sh
set -eu
hf jobs run --detach --flavor l4x1 --timeout 12h --secrets HF_TOKEN --name geometry-successor-fastvit-t8-four-corner-train pytorch/pytorch@sha256:77f17f843507062875ce8be2a6f76aa6aa3df7f9ef1e31d9d7432f4b0f563dee bash -lc 'set -euo pipefail
export HF_HUB_DOWNLOAD_TIMEOUT=120
export HF_HUB_ETAG_TIMEOUT=30
python -m pip install --no-cache-dir huggingface_hub==1.28.0 jsonschema==4.23.0 Pillow==11.1.0 numpy==1.26.4
python -m pip install --no-cache-dir torchvision==0.21.0
python -m pip install --no-cache-dir timm==1.0.22 safetensors==0.6.2
python -m pip install --no-cache-dir onnxruntime==1.29.0 opencv-python-headless==4.10.0.84
python -m pip install --no-cache-dir numpy==1.26.4
python -c "import numpy; assert numpy.__version__ == '"'"'1.26.4'"'"'; print('"'"'NUMPY_RUNTIME_PIN_OK'"'"', numpy.__version__)"
python - <<'"'"'PY'"'"'
import hashlib, os, tarfile
from pathlib import Path
from huggingface_hub import hf_hub_download
repo = '"'"'ahzs645/tcger-universal-arcface'"'"'
revision = '"'"'10904992be84e6a3b8bbcee419cf5a04c1974477'"'"'
training_revision = '"'"'10904992be84e6a3b8bbcee419cf5a04c1974477'"'"'
token = os.environ['"'"'HF_TOKEN'"'"']
tooling = Path(hf_hub_download(repo_id=repo, filename='"'"'geometry/tooling/63fcb55fc506c1081acb926eeb1d9a7346f06f28/card-geometry-tooling.tar.gz'"'"', revision=revision, token=token))
config = Path(hf_hub_download(repo_id=repo, filename='"'"'geometry/bakeoffs/63fcb55fc506c1081acb926eeb1d9a7346f06f28/74f33bc2643a70b6f9137a23a7169af1f42fb44f495c9c64011a1bb27edf4adf/fastvit-t8-four-corner.json'"'"', revision=training_revision, token=token))
preflight = Path(hf_hub_download(repo_id=repo, filename='"'"'geometry/preflights/74f33bc2643a70b6f9137a23a7169af1f42fb44f495c9c64011a1bb27edf4adf/1ce88bc0c8dd429d0e6ef40b41f3aa8c22b7cf4940c1081df8a34001fb4f3f4c.json'"'"', revision=training_revision, token=token))
for path, expected in ((tooling, '"'"'03eaaad26a86604d079e28d9ae722a12bcd377d6fd3997fe519cbf3e7b2b28fb'"'"'), (config, '"'"'5b65059be64da2c17bc0c91439eb231a18b3f290a297cb4c5668d417c4c7dd23'"'"'), (preflight, '"'"'1ce88bc0c8dd429d0e6ef40b41f3aa8c22b7cf4940c1081df8a34001fb4f3f4c'"'"')):
    actual = hashlib.sha256(path.read_bytes()).hexdigest()
    if actual != expected:
        raise SystemExit(f'"'"'pinned input hash mismatch for {path.name}: {actual}'"'"')
source = Path('"'"'/work/src'"'"')
source.mkdir(parents=True, exist_ok=False)
with tarfile.open(tooling, '"'"'r:gz'"'"') as archive:
    archive.extractall(source)
Path('"'"'/work/experiment.json'"'"').write_bytes(config.read_bytes())
Path('"'"'/work/preflight-report.json'"'"').write_bytes(preflight.read_bytes())
PY
export TCGER_GEOMETRY_PREFLIGHT_REPORT=/work/preflight-report.json
cd /work/src
python tools/card-geometry/run_card_geometry_hf_job.py --config /work/experiment.json --action train --workdir /work/tcger-card-geometry-fastvit-t8-four-corner'
hf jobs run --detach --flavor l4x1 --timeout 12h --secrets HF_TOKEN --name geometry-successor-yolo11n-pose-train pytorch/pytorch@sha256:77f17f843507062875ce8be2a6f76aa6aa3df7f9ef1e31d9d7432f4b0f563dee bash -lc 'set -euo pipefail
export HF_HUB_DOWNLOAD_TIMEOUT=120
export HF_HUB_ETAG_TIMEOUT=30
python -m pip install --no-cache-dir huggingface_hub==1.28.0 jsonschema==4.23.0 Pillow==11.1.0 numpy==1.26.4
python -m pip install --no-cache-dir torchvision==0.21.0
python -m pip install --no-cache-dir ultralytics==8.4.138
python -m pip uninstall -y opencv-python
python -m pip install --no-cache-dir onnxruntime==1.29.0 opencv-python-headless==4.10.0.84
python -m pip install --no-cache-dir numpy==1.26.4
python -c "import numpy; assert numpy.__version__ == '"'"'1.26.4'"'"'; print('"'"'NUMPY_RUNTIME_PIN_OK'"'"', numpy.__version__)"
python - <<'"'"'PY'"'"'
import hashlib, os, tarfile
from pathlib import Path
from huggingface_hub import hf_hub_download
repo = '"'"'ahzs645/tcger-universal-arcface'"'"'
revision = '"'"'10904992be84e6a3b8bbcee419cf5a04c1974477'"'"'
training_revision = '"'"'10904992be84e6a3b8bbcee419cf5a04c1974477'"'"'
token = os.environ['"'"'HF_TOKEN'"'"']
tooling = Path(hf_hub_download(repo_id=repo, filename='"'"'geometry/tooling/63fcb55fc506c1081acb926eeb1d9a7346f06f28/card-geometry-tooling.tar.gz'"'"', revision=revision, token=token))
config = Path(hf_hub_download(repo_id=repo, filename='"'"'geometry/bakeoffs/63fcb55fc506c1081acb926eeb1d9a7346f06f28/74f33bc2643a70b6f9137a23a7169af1f42fb44f495c9c64011a1bb27edf4adf/yolo11n-pose.json'"'"', revision=training_revision, token=token))
preflight = Path(hf_hub_download(repo_id=repo, filename='"'"'geometry/preflights/74f33bc2643a70b6f9137a23a7169af1f42fb44f495c9c64011a1bb27edf4adf/1ce88bc0c8dd429d0e6ef40b41f3aa8c22b7cf4940c1081df8a34001fb4f3f4c.json'"'"', revision=training_revision, token=token))
for path, expected in ((tooling, '"'"'03eaaad26a86604d079e28d9ae722a12bcd377d6fd3997fe519cbf3e7b2b28fb'"'"'), (config, '"'"'9800936e97166064f1b2764e22266317044199d8f7e36c29f3454196fb4730d4'"'"'), (preflight, '"'"'1ce88bc0c8dd429d0e6ef40b41f3aa8c22b7cf4940c1081df8a34001fb4f3f4c'"'"')):
    actual = hashlib.sha256(path.read_bytes()).hexdigest()
    if actual != expected:
        raise SystemExit(f'"'"'pinned input hash mismatch for {path.name}: {actual}'"'"')
source = Path('"'"'/work/src'"'"')
source.mkdir(parents=True, exist_ok=False)
with tarfile.open(tooling, '"'"'r:gz'"'"') as archive:
    archive.extractall(source)
Path('"'"'/work/experiment.json'"'"').write_bytes(config.read_bytes())
Path('"'"'/work/preflight-report.json'"'"').write_bytes(preflight.read_bytes())
PY
export TCGER_GEOMETRY_PREFLIGHT_REPORT=/work/preflight-report.json
cd /work/src
python tools/card-geometry/run_card_geometry_hf_job.py --config /work/experiment.json --action train --workdir /work/tcger-card-geometry-yolo11n-pose'
hf jobs run --detach --flavor l4x1 --timeout 12h --secrets HF_TOKEN --name geometry-successor-yolo11s-pose-train pytorch/pytorch@sha256:77f17f843507062875ce8be2a6f76aa6aa3df7f9ef1e31d9d7432f4b0f563dee bash -lc 'set -euo pipefail
export HF_HUB_DOWNLOAD_TIMEOUT=120
export HF_HUB_ETAG_TIMEOUT=30
python -m pip install --no-cache-dir huggingface_hub==1.28.0 jsonschema==4.23.0 Pillow==11.1.0 numpy==1.26.4
python -m pip install --no-cache-dir torchvision==0.21.0
python -m pip install --no-cache-dir ultralytics==8.4.138
python -m pip uninstall -y opencv-python
python -m pip install --no-cache-dir onnxruntime==1.29.0 opencv-python-headless==4.10.0.84
python -m pip install --no-cache-dir numpy==1.26.4
python -c "import numpy; assert numpy.__version__ == '"'"'1.26.4'"'"'; print('"'"'NUMPY_RUNTIME_PIN_OK'"'"', numpy.__version__)"
python - <<'"'"'PY'"'"'
import hashlib, os, tarfile
from pathlib import Path
from huggingface_hub import hf_hub_download
repo = '"'"'ahzs645/tcger-universal-arcface'"'"'
revision = '"'"'10904992be84e6a3b8bbcee419cf5a04c1974477'"'"'
training_revision = '"'"'10904992be84e6a3b8bbcee419cf5a04c1974477'"'"'
token = os.environ['"'"'HF_TOKEN'"'"']
tooling = Path(hf_hub_download(repo_id=repo, filename='"'"'geometry/tooling/63fcb55fc506c1081acb926eeb1d9a7346f06f28/card-geometry-tooling.tar.gz'"'"', revision=revision, token=token))
config = Path(hf_hub_download(repo_id=repo, filename='"'"'geometry/bakeoffs/63fcb55fc506c1081acb926eeb1d9a7346f06f28/74f33bc2643a70b6f9137a23a7169af1f42fb44f495c9c64011a1bb27edf4adf/yolo11s-pose.json'"'"', revision=training_revision, token=token))
preflight = Path(hf_hub_download(repo_id=repo, filename='"'"'geometry/preflights/74f33bc2643a70b6f9137a23a7169af1f42fb44f495c9c64011a1bb27edf4adf/1ce88bc0c8dd429d0e6ef40b41f3aa8c22b7cf4940c1081df8a34001fb4f3f4c.json'"'"', revision=training_revision, token=token))
for path, expected in ((tooling, '"'"'03eaaad26a86604d079e28d9ae722a12bcd377d6fd3997fe519cbf3e7b2b28fb'"'"'), (config, '"'"'d89ad5632623f177c0331caf6123f98f2a30e4f040213e93f00eee4c11730241'"'"'), (preflight, '"'"'1ce88bc0c8dd429d0e6ef40b41f3aa8c22b7cf4940c1081df8a34001fb4f3f4c'"'"')):
    actual = hashlib.sha256(path.read_bytes()).hexdigest()
    if actual != expected:
        raise SystemExit(f'"'"'pinned input hash mismatch for {path.name}: {actual}'"'"')
source = Path('"'"'/work/src'"'"')
source.mkdir(parents=True, exist_ok=False)
with tarfile.open(tooling, '"'"'r:gz'"'"') as archive:
    archive.extractall(source)
Path('"'"'/work/experiment.json'"'"').write_bytes(config.read_bytes())
Path('"'"'/work/preflight-report.json'"'"').write_bytes(preflight.read_bytes())
PY
export TCGER_GEOMETRY_PREFLIGHT_REPORT=/work/preflight-report.json
cd /work/src
python tools/card-geometry/run_card_geometry_hf_job.py --config /work/experiment.json --action train --workdir /work/tcger-card-geometry-yolo11s-pose'
hf jobs run --detach --flavor l4x1 --timeout 12h --secrets HF_TOKEN --name geometry-successor-yolox-pose-train pytorch/pytorch@sha256:82e0d379a5dedd6303c89eda57bcc434c40be11f249ddfadfd5673b84351e806 bash -lc 'set -euo pipefail
export HF_HUB_DOWNLOAD_TIMEOUT=120
export HF_HUB_ETAG_TIMEOUT=30
python -m pip install --no-cache-dir huggingface_hub==1.28.0 jsonschema==4.23.0 Pillow==11.1.0 numpy==1.26.4
python -m pip install --no-cache-dir numpy==1.26.4 torchvision==0.15.2
python -m pip install --no-cache-dir '"'"'mmcv==2.0.1'"'"' -f https://download.openmmlab.com/mmcv/dist/cu117/torch2.0/index.html
python -m pip install --no-cache-dir '"'"'mmengine==0.10.7'"'"' '"'"'mmdet==3.3.0'"'"' '"'"'mmpose==1.3.2'"'"'
python -c '"'"'import hashlib
import tarfile
import urllib.request
from pathlib import Path

archive = Path('"'"'"'"'"'"'"'"'/work/mmyolo-source.tar.gz'"'"'"'"'"'"'"'"')
archive.parent.mkdir(parents=True, exist_ok=True)
urllib.request.urlretrieve('"'"'"'"'"'"'"'"'https://github.com/open-mmlab/mmyolo/archive/8c4d9dc503dc8e327bec8147e8dc97124052f693.tar.gz'"'"'"'"'"'"'"'"', archive)
actual = hashlib.sha256(archive.read_bytes()).hexdigest()
if actual != '"'"'"'"'"'"'"'"'6a1f2e65b0746353e94cf87d172503e00e98cc9b2529bb38718d278e6be63d9c'"'"'"'"'"'"'"'"':
    raise SystemExit(f'"'"'"'"'"'"'"'"'MMYOLO archive SHA-256 mismatch: {actual}'"'"'"'"'"'"'"'"')
with tarfile.open(archive, '"'"'"'"'"'"'"'"'r:gz'"'"'"'"'"'"'"'"') as bundle:
    bundle.extractall('"'"'"'"'"'"'"'"'/work'"'"'"'"'"'"'"'"')
Path('"'"'"'"'"'"'"'"'/work/mmyolo-8c4d9dc503dc8e327bec8147e8dc97124052f693'"'"'"'"'"'"'"'"').rename('"'"'"'"'"'"'"'"'/work/mmyolo'"'"'"'"'"'"'"'"')
archive.unlink()'"'"'
python -m pip install --no-cache-dir -e /work/mmyolo
python -m pip install --no-cache-dir numpy==1.26.4 onnxruntime==1.23.2 opencv-python-headless==4.10.0.84
python -m pip install --no-cache-dir numpy==1.26.4
python -c "import numpy; assert numpy.__version__ == '"'"'1.26.4'"'"'; print('"'"'NUMPY_RUNTIME_PIN_OK'"'"', numpy.__version__)"
python - <<'"'"'PY'"'"'
import hashlib, os, tarfile
from pathlib import Path
from huggingface_hub import hf_hub_download
repo = '"'"'ahzs645/tcger-universal-arcface'"'"'
revision = '"'"'10904992be84e6a3b8bbcee419cf5a04c1974477'"'"'
training_revision = '"'"'10904992be84e6a3b8bbcee419cf5a04c1974477'"'"'
token = os.environ['"'"'HF_TOKEN'"'"']
tooling = Path(hf_hub_download(repo_id=repo, filename='"'"'geometry/tooling/63fcb55fc506c1081acb926eeb1d9a7346f06f28/card-geometry-tooling.tar.gz'"'"', revision=revision, token=token))
config = Path(hf_hub_download(repo_id=repo, filename='"'"'geometry/bakeoffs/63fcb55fc506c1081acb926eeb1d9a7346f06f28/74f33bc2643a70b6f9137a23a7169af1f42fb44f495c9c64011a1bb27edf4adf/yolox-pose.json'"'"', revision=training_revision, token=token))
preflight = Path(hf_hub_download(repo_id=repo, filename='"'"'geometry/preflights/74f33bc2643a70b6f9137a23a7169af1f42fb44f495c9c64011a1bb27edf4adf/1ce88bc0c8dd429d0e6ef40b41f3aa8c22b7cf4940c1081df8a34001fb4f3f4c.json'"'"', revision=training_revision, token=token))
for path, expected in ((tooling, '"'"'03eaaad26a86604d079e28d9ae722a12bcd377d6fd3997fe519cbf3e7b2b28fb'"'"'), (config, '"'"'17db56b500122a1df160f7530b31b04a464b355bd4ade524d8dca5b0281d9dfd'"'"'), (preflight, '"'"'1ce88bc0c8dd429d0e6ef40b41f3aa8c22b7cf4940c1081df8a34001fb4f3f4c'"'"')):
    actual = hashlib.sha256(path.read_bytes()).hexdigest()
    if actual != expected:
        raise SystemExit(f'"'"'pinned input hash mismatch for {path.name}: {actual}'"'"')
source = Path('"'"'/work/src'"'"')
source.mkdir(parents=True, exist_ok=False)
with tarfile.open(tooling, '"'"'r:gz'"'"') as archive:
    archive.extractall(source)
Path('"'"'/work/experiment.json'"'"').write_bytes(config.read_bytes())
Path('"'"'/work/preflight-report.json'"'"').write_bytes(preflight.read_bytes())
PY
export TCGER_GEOMETRY_PREFLIGHT_REPORT=/work/preflight-report.json
cd /work/src
python tools/card-geometry/validate_yolox_runtime.py --mmyolo-root /work/mmyolo --output /work/yolox-runtime-validation --experiment-config /work/experiment.json
python tools/card-geometry/run_card_geometry_hf_job.py --config /work/experiment.json --action train --workdir /work/tcger-card-geometry-yolox-pose'
