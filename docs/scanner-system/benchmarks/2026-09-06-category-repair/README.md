# Canonical category import repair — 2026-09-06

Purpose: repair the importer boundary that trained round two on slabs and card subregions as whole cards, prove the boundary with fixtures and a preflight gate, recompute what the repair changes, and separate two questions the failure audit left open (YOLO11 input color and recognition quality). No corpus was frozen, published or trained here. The frozen round-two corpus, its benchmarks and the evaluation releases are untouched.

## What changed in the tooling

- **Importer** (`tools/card-geometry/build_real_smoke_release.py`). Every canonical annotation is classified through the category contract in `tools/card-segmentation-data/source-config.json` before any geometry is read. Only `primary` categories (`card`) become geometry targets. `auxiliary` regions (inner border, title, information, collection) and `context` objects (slab) are counted in the record's `source.annotationCategories` and never become instances. A slab that encloses a card sets that card's `container` to `slab`; nothing else infers containers. A missing box on a non-card annotation cannot drop an image; a missing box on a card still drops the whole image so no visible card becomes an unlabeled negative. Unknown or missing categories fail the build. Each instance records `sourceCategory`, `sourceAnnotationIndex` and `sourceProvenance`; instances are re-indexed over cards only.
- **Manifest declaration.** New optional `targetSemantics` block (`canonical-primary-card-targets-v1`) naming the primary, auxiliary and context categories and the SHA-256 of the contract file. The combiner propagates it and refuses disagreeing parts.
- **Preflight** `TARGET_SEMANTICS` (20 checks now). With a declaration, every real archive record (real source, no capture session) must carry primary-category provenance with unique annotation indices, and its primary-category count must equal its instance count. Provenance without a declaration fails. A legacy manifest without either is a `skip`, so the frozen releases still pass; policy `requireTargetSemantics` turns that skip into a failure. Fixtures `valid-target-semantics` and `invalid-target-semantics` (a slab claimed as the card) pin the behaviour.
- **Policy** `training-minimums-v4` (`tools/card-geometry/policies/training-minimums-v4.json`, SHA-256 `d1f38ac331ef3eef1e632f6f3874cd1f33967c073ca33dbbec26c8547a9080f6`, amended the same day before any use): identical split totals to v3 plus `requireTargetSemantics: true`, with the real archive slice minimums re-partitioned into single-card and multi-card layout slices (see the successor record). v3 is unchanged. The combiner accepts v4 under the v3 assembly contract. The successor corpus should bind v4.
- **Audit** `audit_canonical_target_categories.py` aligns through `sourceAnnotationIndex` when present and verifies both the instance category and the declared category counts against the canonical corpus; it keeps the positional mode only for legacy releases with equal counts.
- **Evaluator** `evaluate_geometry_candidate.py` now hands Ultralytics BGR arrays, matching its file loader; `EVALUATION_CONTRACT` version 2 is written into every evaluation summary. Version-1 reports stay as published. `audit_geometry_failures.py` reproduces the version-1 RGB path explicitly for its frozen variant. A test compares the PIL path, the numpy path and `cv2.imread` bytes.
- **New diagnostic** `replay_label_crop_recognition.py` runs the recognition replay on frozen human label crops instead of model quads, with the same crop contract, orientation rule and acceptance decision.

Tests: 257 card-geometry tests pass, including 8 new category-boundary tests, 2 new fixture releases, a combiner propagation test, the v4 pin test, the color-parity test and 2 label-crop replay tests. Ruff 0.15.8 passes on every changed file.

## What the repair changes on the round-two archives

The repaired importer was run on the same 13 archives, same whole-archive splits and same alias table as round two (`repaired-real-build-summary.json`, corpus hash `1dd3a9d86552c5c2d47fd54c0b37376bc3f89a2e45e9d9510f64375e841a5d7c`, smoke purpose, local only). `category-audit-repaired.json` aligned all 5,744 records through provenance with zero misclassified instances. Preflight passed all 20 checks including `TARGET_SEMANTICS` (`repaired-real-preflight.json`).

| Real portion | Records | Card targets | Trusted (maskFit) corners | Box-only | Multi-card records | Container = slab |
|---|---:|---:|---:|---:|---:|---:|
| Train, frozen round two | 4,465 | 7,030 | 2,402 | 4,628 | 537 | 0 |
| Train, repaired | 4,465 | 6,281 | 2,176 | 4,105 | 261 | 235 |
| Validation, frozen round two | 1,279 | 1,621 | 393 | 1,228 | 256 | 0 |
| Validation, repaired | 1,279 | 1,386 | 194 | 1,192 | 21 | 0 |

No image was lost: the 32 canonical records without any annotation were already excluded. Removed targets by archive (`coverage.json`): card-scanner-seg 235 slabs (218 with trusted corners), mtg-scanner-bughx 422 title/information regions, card-detector-wmbbb 92 title/collection regions, card-seg-j74w1 235 inner borders (199 with trusted corners). Real validation corner supervision therefore halves; 194 trusted real corner instances remain, all in a single archive component.

`sample-panels/` shows the first six records of every archive after repair: retained cards in green with numbered corners when known, dropped slab annotations dashed orange, dropped regions dashed magenta. Inspection confirms slabs enclose their card, inner borders sit inside their card, title and information regions are subregions, and the binder and tabletop archives (pokemon-card-outliner, pokefolio, mtg-scanner-bughx) carry box-only cards. maskFit corners are geometrically ordered from the top-left; rotated cards keep `orientationKnown: false`.

## Policy check on a repaired successor shape

A local, non-published combination of the repaired real candidate with the unchanged `synthetic-geometry-round-two-v1` under the v3 policy passed all 20 preflight checks with `readyFor: training` (`combined-v3-simulation-preflight.json`, hash `0d2e687f…`, 15,744 records, 39,185 train and 5,003 validation instances). No count minimum needs weakening. This simulation is an input-shape check only: it reuses the synthetic release, it is not a frozen experiment, and nothing here authorizes training.

## Recognition isolated from geometry

`label-crop-recognition-replay.json` crops all 57 replay frames with their frozen human label quads and runs the pinned encoders (revision `3e51bbba…`, hashes in `recognition-models-receipt.json`). Every frame had a trusted single-card human label.

| Frames | Correct | Abstain | Wrong |
|---|---:|---:|---:|
| 11 with verified identity, label crops | 4 | 6 | 1 |
| Same 11, YOLO11s model crops (round two) | 4 | 6 | 1 |
| Same 11, repaired YOLOX model crops | 2 | 9 | 0 |

Perfect geometry does not raise the ceiling: the label crops reproduce the YOLO11s outcome frame for frame, and the two frames YOLOX loses are geometry misses. The six abstains have top scores from 0.53 to 0.81 with rival margins under the 0.05 rule, and two of them rank a different family first. The wrong accept (record ending `18315867b636a816`, score 0.857, margin 0.088) is a wrong family from the human label crop itself. These are encoder, index or identity-label questions, not geometry, and they need their own follow-up. On the 42 unknown-identity frames the label crops accept 22, agreeing with YOLOX on 13; those outcomes are reported, not judged.

Incidental finding: the pinned Pokémon vector index contains 53 zero-norm rows that become NaN after normalization in `crop_parity.EncoderRuntime.load`. They cannot win the top-1 today because NaN sorts last, but the index export should be checked before any threshold work.

## Not done here

- No successor corpus was frozen or published, no archive assignment was recomputed, and no training was launched. The successor should recompute assignments, exact and perceptual leakage, background provenance and the near-duplicate audit against the current evaluation releases, bind `training-minimums-v4`, and be frozen with its configs before any result.
- Real binder, sleeve, multi-card and perspective corner supervision on TRAIN sources remains the open coverage gap; the repair only removes wrong targets. The unused-reference audit's additional archives still need eligibility, alias, licensing and leakage recomputation.
- No corrected-color held-out YOLO11 result was produced; that needs a declared re-evaluation experiment with evaluation contract version 2.
- No label, threshold or encoder was changed for the recognition findings.

## Reproduce

```sh
PY=.artifacts/card-geometry/trainer-validation-venv/bin/python
$PY -m unittest discover -s tools/card-geometry -p "test_*.py"
$PY tools/card-geometry/build_real_smoke_release.py --help
$PY tools/card-geometry/audit_canonical_target_categories.py --canonical <canonical corpus.jsonl> --release .artifacts/card-geometry/releases/real-geometry-category-repair-candidate-v1 --output <out.json>
$PY tools/card-geometry/render_category_repair_samples.py --release .artifacts/card-geometry/releases/real-geometry-category-repair-candidate-v1 --canonical <canonical corpus.jsonl> --output <dir>
$PY tools/card-geometry/replay_label_crop_recognition.py --release .artifacts/card-geometry/releases/real-geometry-evaluation-v6-full-aliases-v2 --models-root .artifacts/card-geometry/recognition-models-3e51bbba --output <out.json>
```

The repaired candidate was built with the thirteen `--archive-split` assignments listed in `repaired-real-build-summary.json` and the round-two alias table in `../2026-09-04-round-two-assembly/source-archive-aliases.json`. Recognition encoders were downloaded from `ahzs645/tcger-universal-arcface` at the pinned revision and hash-verified against the loss-repair experiment config; ONNX Runtime was added to the local validation venv for the CPU replay.
