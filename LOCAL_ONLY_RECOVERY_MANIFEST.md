# TCGer local-only recovery bundle

This bundle was reconstructed on 2026-08-27 after the transient workspace was
removed by automated maintenance.

## Recovery base

- GitHub pull request: `ahzs645/TCGer#39`
- Checked-out PR head: `51d2ef9866e181836759ef5d1dfba8ccc7d764da`

## Files that were local-only

- `docs/universal-scanner-project-handoff-2026-08-27.md`
- `docs/hugging-face-universal-scanner-setup.md`
- `mobile-apps/ios/scripts/run_universal_arcface_hf_job.py`
- `mobile-apps/ios/scripts/train_arcface_encoder.py`

The final three files contain the recovered paired production-Pokemon ArcFace
evaluation, pinned trainer override, production-baseline download, and fixed
batch-size-one ONNX handling.

## Portable restore artifact

Apply `tcger-local-only-recovery.patch` from the root of a checkout of PR #39:

```bash
git apply --check tcger-local-only-recovery.patch
git apply tcger-local-only-recovery.patch
```

Review the patch before committing it. No credentials, model binaries, catalog
images, or checkpoints are included.

## Important limitation

The original unpushed Git objects were lost with the transient checkout. This
bundle reconstructs their file-level changes from the recorded implementation
and the PR #39 base; it does not claim to preserve the original local commit
SHAs.
