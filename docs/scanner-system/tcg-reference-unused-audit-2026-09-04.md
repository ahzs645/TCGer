# TCG Reference: unused-materials audit — 2026-09-04

Checked 2026-09-04 against the local TCGer checkout at 08313deb and its on-disk `combined-shippable-training-production-v1` release. This establishes use in that release, not whether an asset has ever been examined or used in another experiment. The pasted assessment cites a later commit, 3d1210a, which was not the local checkout inspected.

## Verified findings

- The release contains 10,800 synthetic training records, 200 synthetic validation records, and 600 real test records. No real images occur in train or validation.
- Comparing image SHA-256 values against `canonical-v1/corpus.jsonl`, only 502 of 6,278 canonical images occur in the release. All 502 come from TCGX. The remaining 5,776 canonical images do not occur in it.
- The canonical geometry audit reports 2,882 accepted four-corner polygon fits across all sources, of which 512 belong to TCGX. Thus 2,370 accepted fits belong to sources absent from this release: card-scanner-seg 2,137; card-seg-j74w1 94; its q8yst fork 100; card-detector-wmbbb 38; card-segmentation-gldmt 1. These are maskFit labels, not human corner truth. Training eligibility still requires source/fork grouping, provenance review and preservation of evaluation separation.
- Of 304 canonical images with multiple card annotations, 282 are absent from the release. They are candidates for real binder/duel-field labeling. Existing heuristic scene assignments are provisional, and many annotations are boxes rather than true card corners.
- Three Yu-Gi-Oh archives are present separately under `games/yugioh/raw`: yugioh-t7rhp v4 (121 exported images), yugioh-cards-ar4um v3 (63), and yugioh-project v1 (1,272). Total: 1,456 export images, not 1,456 independent photos. Their archive sources do not occur in the inspected geometry release. They provide box labels and, in two datasets, restricted named identity classes. Review geometry, deduplicate augmentation families, and map identities before use. The 63-image listing-style collection has 654 box annotations and is a concrete multi-card labeling candidate.
- Existing recognition work produced 1,541 Pokémon crops (149 footer-verified and 210 title-agreement positives) and 584 Magic crops (16 labeled ground-truth examples). These have already been used in recognition analysis, but are additional material for developing a broader reviewed recognition benchmark. Automated acceptance is not independent human truth, and their source images can overlap the canonical/frozen corpora.
- Magic also has three raw archives outside the canonical 14-source corpus. Prior analysis identified 67 real web/eBay photos in mtg-detection-light, 50 spread photos in mtg-6klau, and 16 steep-angle photos in magic-classification. Much of the nominal archive image count is renders or augmentation, so those headline counts must not be treated as independent camera photos.
- OmniCard provides 18 labeled flatbed scans of nine physical-card families, with nine catalog references. It is a possible separate MTG retrieval diagnostic, not camera-domain evidence. Keep paired resolutions together. Its local README records separate image-rights limitations.

## Corrections to the pasted assessment

Do not move the frozen 512 TCGX maskFit instances into training while continuing to score against the same evaluation release. Use separate sources for training and real validation instead.

The 129 binder frames are existing test-session captures, not automatically training-eligible data. The September 3 binder audit records three finalized pages (27 card instances) and 126 binder frames still lacking finalized geometry. It explicitly says these are existing test sessions. They can expand held-out evaluation after labeling; their remaining frames must not leak into training.

The seven baselines were rerun on the 64-image binder v4 release, so the pasted claim that they were only measured on the earlier 61-instance release is outdated. This does not establish a comparison on v6-full.

The lo-calvin segmentation model has already been benchmarked in the August 30 localizer work. The 10,000-image Pocket synthetic set has already been assessed and has unresolved licensing and camera-domain limitations. Neither is an overlooked replacement for real training data.

## Best next use

Prioritize the unused polygon sources for a source-separated real train/validation release; review and label unused multi-card archive scenes, including the Yu-Gi-Oh listings; then expand verified recognition identities using the existing crop review queues. Keep Dev Mode and frozen archive evaluation data held out.

## Evidence locations

Reference root: `/Users/ahmadjalil/Library/CloudStorage/GoogleDrive-ahzs645@gmail.com/My Drive/Projects/TCG/Reference`

- `TCGer-Scanner-Datasets/README.md` (14 archives; top-level Reference README still says five)
- `TCGer-Scanner-Datasets/derived/card-segmentation/canonical-v1/corpus.jsonl`
- `TCGer-Scanner-Datasets/games/yugioh/sources.json`
- `TCGer-Scanner-Datasets/games/{pokemon,magic}/derived/query-crops/camera-corpus-2026-08-29/report.json`
- `TCGer-Scanner-Datasets/games/magic/replay/omnicard-flatbed-v1/README.md`

Repository root: `/Users/ahmadjalil/github/TCGer`

- `.artifacts/card-geometry/releases/combined-shippable-training-production-v1/manifest.json`
- `docs/scanner-system/benchmarks/2026-09-02-canonical-geometry-audit.json`
- `docs/scanner-system/benchmarks/2026-09-03-binder-v4/README.md`
- `docs/scanner-system/camera-corpus-2026-08-29.md`

## Follow-up verification of the proposed relay

The diagnosis-first ordering stands. Four implementation details require corrections before this becomes an executable round-two plan:

1. The canonical audit's 6,473 / 882 / 873 instance counts do not represent whole-archive separation. `audit_canonical_geometry.py` groups the existing row-level `split` values. The card-scanner-seg archive alone supplies a counterexample: it has 2,200 / 296 / 241 images across train / validation / test. A fresh count of the local canonical JSONL at the inspected snapshot also finds all fourteen archive names in all three splits (including TCGX at 401 / 53 / 48). These are existing record assignments, not a computed whole-archive release assignment. A geometry release must compute and validate whole-archive/fork separation independently. The 2,306 accepted train fits cannot be adopted as the new eligible training count.
2. Both `train_fastvit_four_corner.py` (`make_dataset`) and `train_yolo_pose.py` (`materialize_yolo`) explicitly raise on non-synthetic train/validation records and read `contextMarginPixels` from the synthetic block. Real records have no such block. Real-data ingestion and a shared, declared margin policy must be implemented before even complete maskFit records can train.
3. FastViT skips unknown-corner instances without an ignore mask in its heatmap loss, confirming the missing-target problem. YOLO's `yolo_line` also skips them, but its materializer removes an image if no labeled instances remain. Thus wholly box-only images are currently dropped by YOLO; mixed known/unknown images retain the unlabeled cards and create the supervision problem. Emitting boxes with visibility-zero keypoints would require a materializer change and verification of the actual pose framework's loss behavior. Rejecting partial unknown-corner instances must not silently retain their visible card pixels as unannotated background in otherwise accepted images.
4. The background builder excludes sessions only via the supplied release's denylist and avoids expanded boxes of recorded detections. That is not proof that crops contain no cards: missed cards are not represented by those boxes. Scale only against the complete evaluation-session exclusion set and review resulting crops for missed cards before treating them as background.

Yu-Gi-Oh augmentation-family grouping remains useful, especially for forks and re-exports. Whole-archive separation already prevents two copies within the same archive from landing in different splits; family keys provide additional protection across archive boundaries.

No code, dataset releases, or training jobs were changed by this follow-up inspection.


## Accepted round-two tooling requirements

Status: requirements recorded for implementation and self-validation; this documentation commit does not establish that the tooling, release assignment, or training gates have been completed.

1. **Compute and record whole-archive and fork separation.** The new release must carry its computed canonical archive-to-split assignment and the mapping of forks and re-exports to canonical archive IDs. Treat a fork or re-export as the same archive for split purposes. Enforce canonical archive IDs and every `sourceAssetIds` value as independent leakage keys: `LEAKAGE_DISJOINT` must fail if either crosses splits. A compound pair alone is insufficient because changing the other member must not hide overlap. Preserve augmentation-family grouping across exports. Keep all of TCGX and the existing binder evaluation sessions held out; accepted-fit counts above are inventory, not final train/validation eligibility counts.
2. **Declare real-record context margins for both wrappers.** Derive real-record padding consistently for every candidate from a fixed fraction of the source image's long side. Record the policy, fraction, pixel rounding, and per-side application in the fairness configuration so its hash covers the resolved policy. Select and freeze the value before round-two results; this audit does not invent a value. Apply the same geometry transformation to boxes and known corners. Retain the existing declared synthetic margins for synthetic records.
3. **Preserve unknown-corner cards without corner supervision.** Retain each such instance as a box in the record. YOLO pose must emit that box with all four keypoints at visibility zero, with self-validation against the pinned Ultralytics loss confirming exclusion from keypoint coordinate loss. FastViT must transform the box into heatmap coordinates and apply an ignore mask that zeroes the negative focal term inside it while preserving positive supervision. Aspect- and residual-rejected polygon fits receive the same box-only treatment; they must not silently disappear from retained images. If an unknown-corner or rejected-fit instance has no usable box, drop the entire image. Cover mixed known/unknown images, wholly box-only images, rejected fits, missing boxes, and overlapping supervised/ignored regions in self-validation. Accepted `maskFit` corners remain metric-excluded.
4. **Record background review and complete exclusions.** Each crop in the background manifest must carry its source session, reviewer, and crop SHA-256. Review must be tied to the exact crop bytes; detection clearance alone is not a card-free review. The exclusion list must cover every source session in `real-geometry-evaluation-v6-full` and every Dev Mode session. Only reviewed crops from eligible sessions may enter the rebuilt background pool.

## Required execution order

1. Repair and self-validate the training pipelines: log FastViT checkpoint matched/missing keys, retain committed `history.json`, restore YOLOX validation by fixing the pinned head bug, confirm learning-rate scaling for batch 16, and run train-split self-evaluation for FastViT and YOLOX. Include the ingestion and unknown-corner behavior checks above before admitting real records.
2. Rerun the seven incumbent baselines on `real-geometry-evaluation-v6-full`.
3. Compute and validate the revised corpus, including canonical archive/fork separation and reviewed backgrounds, then freeze that corpus and `training-minimums-v3` before any round-two candidate result is seen.

## Code references for the follow-up

- [Canonical audit](../../tools/card-geometry/audit_canonical_geometry.py): summaries of existing record splits.
- [YOLO pose wrapper](../../tools/card-geometry/train_yolo_pose.py): `yolo_line` and `materialize_yolo`.
- [FastViT wrapper](../../tools/card-geometry/train_fastvit_four_corner.py): `build_targets`, `make_dataset`, and `focal_loss`.
- [Release preflight](../../tools/card-geometry/preflight.py): `LEAKAGE_DISJOINT` currently checks declared archive and asset keys; canonical fork mapping and the computed assignment must be recorded for the new release.
- [Background manifest builder](../../tools/card-geometry/compositor/build_session_background_manifest.py): existing crop hashes and source-session provenance; reviewer evidence and complete session exclusions are required for round two.
