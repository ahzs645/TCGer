#!/usr/bin/env python3
"""Rerun frozen YOLOX benchmarks from verified, immutable training artifacts."""
import argparse
import json
import os
from pathlib import Path
import shutil

from corpus_release import load_json, pretty_json, sha256_file
from run_card_geometry_hf_job import (
    _download_evaluation_release, _download_recognition_models,
    _require_private_model_repo, _verify_local_artifacts, descriptor, resolve_config,
)
from yolox_validation_fix import repair_source


def verified_copy(source: Path, destination: Path, expected: str) -> None:
    if sha256_file(source) != expected:
        raise ValueError(f'evaluation input SHA-256 mismatch: {source.name}')
    destination.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(source, destination)


def run(args: argparse.Namespace) -> dict:
    from huggingface_hub import HfApi, hf_hub_download
    config = resolve_config(load_json(args.training_config))
    if config['candidate'] != 'yolox-pose':
        raise ValueError('evaluation restart currently supports only YOLOX')
    _verify_local_artifacts(config)
    original = descriptor(config)
    repo = config['execution']['checkpointRepo']
    prefix = original['checkpointPrefix']
    token = os.environ['HF_TOKEN']
    api = HfApi(token=token)
    _require_private_model_repo(api, repo)
    args.workdir.mkdir(parents=True, exist_ok=False)
    output = args.workdir / 'output'
    checkpoint_path = 'training/repeat-0/epoch_50.pth'
    if config['fairness']['budget'] != {'kind': 'epochs', 'value': 50}:
        raise ValueError('this restart requires a completed 50-epoch run')
    for relative, digest in ((checkpoint_path, args.checkpoint_sha256),
                             ('yolox-pose-card.py', args.model_config_sha256)):
        downloaded = Path(hf_hub_download(repo, f'{prefix}/training-output/{relative}',
                                         revision=args.source_revision, token=token))
        verified_copy(downloaded, output / relative, digest)
    repair = repair_source(args.mmyolo_root)
    evaluation_roots = {}
    for key, tag in (('frozenReal', 'REAL'), ('syntheticMultigame', 'SYNTHETIC')):
        release = config['evaluations'][key]
        root = _download_evaluation_release(release, token, args.workdir, key)
        evaluation_roots[key] = str(root)
        os.environ[f'TCGER_GEOMETRY_EVAL_{tag}_ROOT'] = str(root)
        os.environ[f'TCGER_GEOMETRY_EVAL_{tag}_HASH'] = release['corpusHash']
    models = _download_recognition_models(config, token, args.workdir)
    os.environ.update(TCGER_GEOMETRY_OUTPUT_DIR=str(output),
                      TCGER_GEOMETRY_INPUT_RESOLUTION=str(config['fairness']['inputResolution']),
                      TCGER_GEOMETRY_TOOLING_REVISION=args.tooling_revision,
                      TCGER_GEOMETRY_RECOGNITION_MODELS_ROOT=str(models))
    lineage = dict(trainingExperiment=original, sourceModelRevision=args.source_revision,
                   checkpointSha256=args.checkpoint_sha256,
                   modelConfigSha256=args.model_config_sha256,
                   evaluationToolingRevision=args.tooling_revision, sourceRepair=repair,
                   trainingPerformed=False, evaluationReleases=config['evaluations'])
    destination = f'{prefix}/evaluation-reruns/{args.tooling_revision}'
    api.upload_file(path_or_fileobj=pretty_json(lineage).encode(),
                    path_in_repo=f'{destination}/lineage.json', repo_id=repo,
                    commit_message='Pin YOLOX evaluation-only restart lineage')
    # Import after applying the digest-guarded MMYOLO repair.
    from evaluate_geometry_candidate import evaluate
    result = evaluate(config['candidate'])
    commit = api.upload_folder(folder_path=str(output / 'evaluation'),
                              path_in_repo=f'{destination}/evaluation', repo_id=repo,
                              commit_message='Publish YOLOX epoch-50 frozen evaluation results')
    receipt = dict(lineage=lineage, evaluation=result, artifactPrefix=destination,
                   resultCommit=str(commit.oid))
    (args.workdir / 'evaluation-restart-report.json').write_text(pretty_json(receipt))
    api.upload_file(path_or_fileobj=pretty_json(receipt).encode(),
                    path_in_repo=f'{destination}/evaluation-restart-report.json', repo_id=repo,
                    commit_message='Record completed YOLOX evaluation restart')
    return receipt


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--training-config', type=Path, required=True)
    parser.add_argument('--source-revision', required=True)
    parser.add_argument('--checkpoint-sha256', required=True)
    parser.add_argument('--model-config-sha256', required=True)
    parser.add_argument('--tooling-revision', required=True)
    parser.add_argument('--mmyolo-root', type=Path, required=True)
    parser.add_argument('--workdir', type=Path, required=True)
    print(json.dumps(run(parser.parse_args()), indent=2, sort_keys=True))


if __name__ == '__main__':
    main()
