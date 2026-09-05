# Round-two corpus assembly — 2026-09-04

Trainer repair and runtime/train-split self-validation are complete in the
[trainer evidence](../2026-09-04-trainer-repair/README.md). The seven incumbents
were then rerun on the unchanged v6-full successor; their
[predictions and reports](../2026-09-04-incumbents-v6-successor/README.md) were
committed before this assembly began. No round-two training has started.

## Real-data candidate

Local release: `.artifacts/card-geometry/releases/real-geometry-round-two-candidate-v3`.
Corpus hash: `d41b0881a30f03be56e9ec734ff3f8bb40ee90525a46cfde442b9188c57cabee`.
This is a **smoke-purpose assembly candidate**, not a frozen training release.

| Split | Images | Trusted polygon fits for training | Boxes without corner supervision |
|---|---:|---:|---:|
| Train | 4,465 | 2,402 | 4,628 |
| Validation | 1,279 | 393 | 1,228 |
| Total | 5,744 | 2,795 | 5,856 |

The candidate consumes 13 previously unused canonical archives. The 502-image
TCGX archive stays entirely in the pinned real evaluation. Of the other 5,776
canonical rows, 32 have no usable annotated geometry and are excluded. Polygon
fits retain `maskFit` provenance; they are training supervision, not human
ground truth for benchmark corner metrics. Aspect/residual-rejected fits and
box-only annotations retain their boxes without corner supervision.

`plan_real_archive_release.py` computes archive assignments from the inventory,
explicit fork aliases, shared source-family/image identities, and recorded
visual-review links. Largest connected components are assigned first toward
80/20 train/validation targets; whole components cannot be divided to hit an
exact ratio. The release manifest records the resulting canonical-archive
assignment and inventory hash. Preflight rejects any record that disagrees
with that assignment. Canonical source-family aliases are also retained as
independent `sourceAssetIds` leakage keys.

The first near-duplicate audit found 12 pairs connecting `labelyolo` with the
card-seg parent/fork family. Visual review showed shared card artwork or backs
with changed sizing/distortion. Grouping them changed the split boundary; a
second audit found 64 pairs connecting `pokefolio`, `pokemon-card-outliner`,
and `pk-detect`. Some were the same capture under altered encoding/reflection;
others were different cards in the same distinctive capture setup. The recorded
review conservatively keeps these archives together without asserting that
the entire archives are forks. Both intermediate audits and all review
decisions remain in this directory.

The final candidate passes ordinary preflight and cross-release disjointness
against **both** pinned evaluation successors. The final perceptual audit has
zero flagged pairs across train/validation or against either evaluation at
Hamming distance <= 4, using eight rotations/reflections. This bounded pHash
audit is a similarity screen, not proof that all possible near-duplicates or
shared card artwork have been identified.

The ingestion diagnostic checks every YOLO label: all 8,651 instances survive,
and all 5,856 unknown-corner instances emit four visibility-zero keypoints.
FastViT admits every record and materializes 16 representative records covering
each archive and available supervision kind; image and target tensors are
finite. This diagnostic reuses the runtime fixture's 0.125 context fraction;
it does not select or freeze the production fairness policy.

## Synthetic card assets

Local pack: `.artifacts/card-geometry/compositor-assets/multigame-round-two-candidate-v1`.
The 320 former validation face assets are all present in the pinned synthetic
evaluation and are excluded, along with any same-byte aliases. The remaining
3,400 faces are split deterministically by game and image-byte group into
3,060 training and 340 validation faces. All three game backs remain train-only.
Source provenance and verified bytes are preserved. The source/output manifest
hashes, pinned evaluation hashes, exclusions and counts are recorded in
`card-assets-assembly-evidence.json`.

## Background gap and remaining freeze

All 100 crops in `backgrounds-production-v1` originate in Dev Mode sessions.
`background-eligibility-audit.json` records every excluded crop hash/session and
the complete union of Dev Mode and v6-full evaluation session exclusions.
**None of those crops is eligible for round two.** A separate self-captured
background photo pool outside these sessions is needed; the existing compositor
plan targets 50–100 representative photos. Each selected crop then needs a
recorded source session, reviewer and exact crop hash before finalization.

Once that input is available, review/finalize its background manifest, generate
the synthetic component using the prepared card pack, combine it with the real
component, and rerun exact and perceptual leakage checks on the complete corpus.
Then freeze and publish the corpus, `training-minimums-v3`, and the experiment
fairness configuration (including the explicit real-margin policy) before any
round-two result. The v3 training policy must account for separately pinned
evaluations instead of copying their records into the training release.
The schema filename and stale experiment-key housekeeping remain for that
experiment-config commit.

Tooling revision and input hashes are in `input-pins.json`. Validation:
212 top-level geometry tests, 14 compositor tests, Ruff 0.15.8 and diff checks
passed. Raw candidate images and card assets remain local until the complete
training corpus can be frozen; this directory commits the assembly evidence.
