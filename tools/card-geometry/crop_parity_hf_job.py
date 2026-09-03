# /// script
# requires-python = ">=3.11,<3.14"
# dependencies = [
#   "huggingface-hub==1.28.0",
#   "numpy==2.1.3",
#   "Pillow==11.1.0",
#   "opencv-python-headless==4.10.0.84",
#   "onnxruntime==1.29.0",
# ]
# ///
"""Run the portable crop-parity encoder grid and persist its report."""

from __future__ import annotations

import argparse
import importlib.util
import json
import os
import shutil
import sys
import tarfile
import urllib.request
from pathlib import Path

from huggingface_hub import HfApi, hf_hub_download


def safe_extract(archive: Path, destination: Path) -> None:
    destination = destination.resolve()
    with tarfile.open(archive, "r:gz") as handle:
        for member in handle.getmembers():
            target = (destination / member.name).resolve()
            target.relative_to(destination)
        handle.extractall(destination, filter="data")


def load_crop_parity(url: str, destination: Path):
    urllib.request.urlretrieve(url, destination)
    spec = importlib.util.spec_from_file_location("crop_parity", destination)
    if spec is None or spec.loader is None:
        raise RuntimeError("could not load crop-parity module")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--model-repo", required=True)
    parser.add_argument("--model-revision", required=True)
    parser.add_argument("--input-bundle", required=True)
    parser.add_argument("--tooling-url", required=True)
    parser.add_argument("--tooling-revision", required=True)
    parser.add_argument("--report-path", required=True)
    args = parser.parse_args()

    token = os.environ["HF_TOKEN"]
    root = Path("/tmp/crop-parity")
    shutil.rmtree(root, ignore_errors=True)
    root.mkdir(parents=True)
    archive = Path(
        hf_hub_download(
            args.model_repo,
            args.input_bundle,
            revision=args.model_revision,
            token=token,
        )
    )
    bundle = root / "bundle"
    bundle.mkdir()
    safe_extract(archive, bundle)
    module = load_crop_parity(args.tooling_url, root / "crop_parity.py")

    model_root = root / "models"
    downloads = {
        "pokemon_onnx": "exports/pokemon/full/physical-v2-107fe33b/card-embeddings-arcface-fp32.onnx",
        "pokemon_metadata": "exports/pokemon/full/physical-v2-107fe33b/CardsIndexMetadata.json",
        "pokemon_vectors": "exports/pokemon/full/physical-v2-107fe33b/CardsIndexVectors-arcface.bin",
        "magic_metadata": "exports/magic/full/visual-style-v2-5c27e506-r2/CardsIndexMetadata.json",
        "magic_vectors": "exports/magic/full/visual-style-v2-5c27e506-r2/CardsIndexVectors-arcface.bin",
    }
    paths = {}
    for name, remote_path in downloads.items():
        paths[name] = Path(
            hf_hub_download(
                args.model_repo,
                remote_path,
                revision=args.model_revision,
                token=token,
                local_dir=model_root,
            )
        )

    os.chdir(bundle)
    references = root / "references"
    module.write_reference_grid(Path("cases.json"), references)
    encoders = [
        module.EncoderRuntime.load(
            "pokemon",
            paths["pokemon_onnx"],
            paths["pokemon_metadata"].parent,
            0.65,
            "none",
        ),
        module.EncoderRuntime.load(
            "magic",
            Path("models/magic-visual-style-v2-5c27e506-r2.onnx"),
            paths["magic_metadata"].parent,
            0.70,
            "grey-world-autocontrast",
        ),
    ]
    platforms = sorted(
        (path.name, path)
        for path in Path("platform").iterdir()
        if path.is_dir()
    )
    if not platforms:
        raise RuntimeError("input bundle contains no platform crop directories")
    report = module.analyze(
        Path("cases.json"),
        references,
        platforms,
        encoders,
    )
    report["toolingRevision"] = args.tooling_revision
    report["inputBundle"] = {
        "repo": args.model_repo,
        "revision": args.model_revision,
        "path": args.input_bundle,
    }
    report_file = root / "report.json"
    report_file.write_bytes(module.canonical_json(report))
    api = HfApi(token=token)
    commit = api.upload_file(
        path_or_fileobj=report_file,
        path_in_repo=args.report_path,
        repo_id=args.model_repo,
        commit_message="Add crop parity encoder-grid report",
        create_pr=True,
    )
    print(json.dumps({"reportPath": args.report_path, "commitOid": commit.oid}, sort_keys=True))


if __name__ == "__main__":
    main()
