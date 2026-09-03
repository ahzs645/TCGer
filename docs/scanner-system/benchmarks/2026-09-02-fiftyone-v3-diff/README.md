# FiftyOne versus pinned geometry v3 — 2026-09-02

The live `tcger-sessions` FiftyOne dataset was re-exported at
`2026-09-02T19:49:20-07:00`. The export contains 160 labeled samples and is
byte-identical to the backup it supersedes, `labels-20260830-131335.json`:
both have SHA-256
`308faca4d2e7ca1d2b4e60cd36e7ee70708f1b935c5b1552292f1243e5041f5c`.

The comparison uses the actual pinned v3 manifest and record files from
`ahzs645/tcger-scanner-images` revision
`65017ce8da9137fea491739bd06388ab513831a2`, release
`real-geometry-devmode-orientation-smoke-v3`, corpus hash
`97780e7e96cbd98da91173a00b37e6304514f758a9046f5bd98adf30c418820e`.

## Result

Across 604 image-backed FiftyOne frames in 41 sessions:

- manual-quad gains: 0;
- changed manual quads: 0;
- manual-quad losses: 0;
- unchanged manual quads: 57;
- frames without a manual quad: 547; and
- detector-derived quads, still excluded from metric truth: 28.

The current provenance mapping yields 57 human quads, 28 detector quads, and
zero quads with missing provenance. Metric-eligible truth therefore remains
228 human corners. Since no pinned record changed, v3 remains valid. No v4
release was created and the seven localizer reports were not duplicated.

The JSON report lists all categories and frame keys separately for every
session. Changed entries, when present in a future run, carry four `(dx, dy,
distance)` pixel deltas under the frozen image-edge coordinate convention.

## Coverage against the proposed training policy

The only available policy is still the unapproved
`training-minimums-draft-v1`; this report does not rename or approve it.

| Test requirement | Current | Minimum | Remaining |
|---|---:|---:|---:|
| records | 61 | 100 | 39 |
| card instances | 61 | 150 | 89 |
| real sessions | 7 | 3 | 0 |
| `single_handheld` instances | 57 | 50 | 0 |
| `steep_playmat` instances | 0 | 20 | 20 |
| `duel_field` instances | 0 | 30 | 30 |
| `binder_page` instances | 0 | 20 | 20 |

The human capture list can therefore drop ordinary single-handheld coverage.
It still needs at least 39 new test records and 89 card instances overall,
including 20 steep-playmat, 30 duel-field, and 20 binder-page instances. A
multi-card frame may satisfy several instance requirements but counts as only
one record. Yu-Gi-Oh remains a product-coverage need even though the draft
policy does not yet express a per-game minimum.

Train and validation remain zero in this evaluation-only projection; their
minimums are expected to come from the separately split shippable archives and
synthetic release, not from these frozen Dev Mode sessions.

## Artifacts

- `fiftyone-v3-diff.json` is the full deterministic per-session report.
- `tools/card-geometry/diff_fiftyone_release.py` regenerates it from a current
  label snapshot, the superseded snapshot, the pinned release, and the selected
  readiness policy.
