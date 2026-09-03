# Shared card-geometry contract tooling

This directory contains the model-independent executable evidence for
`docs/scanner-system/shared-card-geometry-plan-2026-09-02.md`: contract
fixtures, corpus-release fixtures, and the preflight that gates training.

## Contract fixtures

- `fixtures/validation-nms.v1.json` starts after a model-specific head has
  decoded candidates. It fixes validation, inclusive quad-NMS behavior,
  canonical rounding, partial containment, and stable output ordering.
- `fixtures/context-letterbox-roundtrip.v1.json` keeps exterior context
  padding separate from aspect-ratio letterboxing and proves their inverse
  coordinate chain. It intentionally uses continuous source pixels: the
  normalized pixel-center versus image-edge choice remains part of the crop
  parity experiment. Its numeric margin and letterbox values exercise the
  transform only; they are not production defaults.
- `reference_geometry.py` is a dependency-free reference implementation for
  checking the fixtures. Production Swift, Kotlin, and TypeScript decoders do
  not import it; each implementation must pass the same fixtures.

Raw-tensor fixtures are model-specific and belong to the later export step.

## Corpus releases and the preflight

A corpus release is a directory with `manifest.json`
(`card-geometry-release-manifest.v1`), the readiness policy it binds to
(`card-geometry-readiness-policy.v1`), record files
(`card-geometry-corpus-record.v1`), and images. Split, scene slice, and
leakage keys live in the manifest; the record schema is unchanged.

`preflight.py` validates a release and writes one JSON report with a
structured `checks` list. Check codes, in report order:

| Code | Fails when |
|---|---|
| `MANIFEST_LOAD` | `manifest.json` is missing or unparseable (exit 3) |
| `MANIFEST_SCHEMA` | the manifest violates its schema |
| `POLICY_LOAD` / `POLICY_SCHEMA` | the bound readiness policy is missing, outside the release, or invalid |
| `POLICY_HASH` | the policy file hash or id differs from the manifest, or from the caller's `--expected-policy-sha256` / `--expected-policy-id` |
| `CORPUS_HASH` | `corpusHash` differs from the canonical hash of the manifest without that member, or from the caller's `--expected-corpus-hash` |
| `RECORD_SCHEMA` / `RECORD_HASH` | a record violates its schema or differs from its manifest hash |
| `IMAGE_HASH` | an image is missing, differs from its manifest or record hash, or a PNG's IHDR size differs from the record |
| `MANIFEST_RECORD_CONSISTENCY` | manifest leakage keys or record ids disagree with record content |
| `LEAKAGE_KEYS_PRESENT` | a record lacks a leakage key its source kind requires under the policy |
| `LEAKAGE_DISJOINT` | a source archive, session, physical card, source asset, record hash, or image hash appears in more than one split |
| `EVAL_DENYLIST` | a frozen evaluation session appears outside the `test` split |
| `SPLIT_REAL_ONLY` | a synthetic record sits in a real-only split |
| `SHARED_FIXTURES` | the contract fixtures above do not reproduce in this environment |
| `CORNER_COUNTS` | never; it records `eligible / evaluated / skipped` corners per source kind, scene slice, and split, and divides the evaluated corners into `metricEligible` (known coordinate whose per-corner `cornerSource` is in the policy's `metricEligibleCornerSources`) and `metricExcluded` (`maskFit`, `detector`, or absent). `maskFit` and `detector` corners are reported but can never become corner-error ground truth |
| `READINESS_MINIMUMS` | the release does not meet its policy's minimums |
| `RELEASE_PURPOSE` | the release purpose differs from the caller's `--expected-purpose` |

`readyFor` is `training` only when every check passes and the release declares
`releasePurpose: training`; `tooling` when every check passes for a `fixture` or
`smoke` release; otherwise `none`. A tiny fixture release can therefore never
authorize training. The GPU wrapper passes `--expected-purpose training` and
`--expected-policy-sha256` so a release cannot lower its own bar.

Exit codes: 0 all checks pass, 2 at least one failed, 3 unreadable release.

```sh
python3 tools/card-geometry/preflight.py \
  --release-root tools/card-geometry/fixtures/releases/valid-fixture \
  --report /tmp/preflight.json
```

### Fixture releases

`fixtures/releases/` holds one valid `fixture`-purpose release, five
single-defect releases that each fail exactly one check, and an empty
`training`-purpose release that fails `READINESS_MINIMUMS`.
`build_fixture_releases.py` regenerates them deterministically, and
`test_preflight.py` requires the committed bytes to match the generator, so a
hand edit fails the suite until the generator produces it.

### Hugging Face CPU smoke

`hf_preflight_smoke.py` is a local orchestrator: it archives the tooling at a
clean HEAD, uploads it to the private model repo, submits a CPU Job that must
reject `invalid-leakage` with exactly `LEAKAGE_DISJOINT`, and only then submits
a Job that must accept `valid-fixture` with `readyFor: tooling`. Each Job
downloads the tooling at the captured Hub commit and verifies its hash before
running. The default CPU image is pinned by OCI digest; mutable image tags are
rejected. An authentication, download, or dependency failure surfaces as a
different exit code or a missing report and is never counted as a passing
rejection. `--dry-run` prints the Job scripts without submitting.

For a real release, pass `--dataset-repo`, an immutable 40-hex
`--dataset-revision`, `--release-path`, and the expected corpus hash, policy
hash/id, and purpose. The fail-first Job copies the pinned release and flips one
image byte; it must fail with exactly `IMAGE_HASH`. The pass-second Job uses the
untouched release and must report `readyFor: tooling` for a smoke-purpose
release. The orchestrator uploads both reports to
`geometry/preflight-reports/<corpus-hash>/<tooling-revision>/` in the private
model repo and records each upload's Hub commit oid in its summary.

### First real-source adapter

`build_real_smoke_release.py` converts the standardized segmentation corpus and
optional Dev Mode sessions into a smoke-purpose geometry release. Its trust
rules are intentionally conservative:

- `source-polygon` and `source-rle` annotations provide `visibleMask`;
- bbox-derived annotations never enter geometry v1;
- only a lossless four-vertex mask fit passing residual, convexity, aspect, and
  occlusion gates receives known `maskFit` corners (which policy excludes from
  corner-error ground truth);
- Dev Mode `fixedQuadSource: manual` becomes `human`; any other named source
  becomes `detector` and is metric-excluded, while missing provenance is
  skipped. Identity-only verdicts remain replay evidence;
- source archives are assigned wholesale to one split, known forks share a
  split, and TCGX defaults to `test` regardless of its inherited COCO split.

The optional `--max-records-per-archive` selects the first record ids after a
stable sort for a small tooling smoke; omitting it ingests the complete selected
archives. The builder refuses to replace a non-empty output directory. The
generated `build-summary.json` records inclusion, sampling, and fit-gate counts
but is not part of the hashed release contract.

When the local FiftyOne database is ahead of synchronized session
`results.json`, `--devmode-label-backup` accepts a read-only `labels-*.json`
snapshot from `backup_labels.py`; `--devmode-sessions-root` resolves its stable
`session/image` keys. This path deliberately ingests only `manual` quads and
does not rewrite the canonical session library.

`diff_fiftyone_release.py` compares a fresh `backup_labels.py` snapshot to an
immutable geometry release. It reports manual-quad gains, pixel deltas for
changed corners, losses, detector-derived quads, and frames still lacking
human geometry per session. It also projects the current release against a
specified readiness policy. A non-empty gain/change/loss set requires a new
release and corpus hash; the pinned release and its existing reports remain
immutable.

## Geometry benchmark

`benchmark_geometry.py` scores one localizer's portable predictions against a
preflighted release. The JSONL wrapper is
`card-geometry-predictions.v1`: exactly one row per release record, one
`localizerId` per file, and `results` containing the existing
`CardGeometryResult` objects. The scorer requires the expected corpus hash,
reruns preflight, performs deterministic greedy one-to-one quad matching, and
reports recall at 0.5/0.75/0.9, duplicate/extra/miss rates, pixel and normalized
corner-error percentiles, orientation accuracy, and reconciled corner counts.
Reports contain no timestamp.

The crop-parity experiment froze pixel error at image-edge mapping,
`x * width` and `y * height`. New reports record the frozen convention.
For orientation-unknown truth, cyclic prediction rolls are aligned by minimum
corner error and the pair is excluded from orientation accuracy.

```sh
python3 tools/card-geometry/benchmark_geometry.py \
  --release-root <pinned-release> \
  --predictions <localizer>.predictions.jsonl \
  --expected-corpus-hash <sha256> \
  --report <localizer>.benchmark.json
```

`tools/camera-corpus/bench_localizers.py --geometry-release-root ...
--export-predictions <directory>` emits one complete predictions JSONL per
configured localizer. `--device-sessions-root` reconstructs phone-recorded
quads from archived session `results.json` files and matches them to release
images by content hash; those quads remain predictions, never ground truth.

The [deterministic compositor](compositor/README.md) emits synthetic scenes as
ordinary smoke-purpose releases through these same contracts and checks.

## Candidate licensing bake-off

`run_card_geometry_hf_job.py` is the backend-neutral Hugging Face Job wrapper
for the four-candidate licensing bake-off. It validates a
`card-geometry-experiment-config.v1` document, applies defaults before hashing,
and scopes all private artifacts to:

```text
geometry/<candidate>/<corpus-hash>/<experiment-hash>/
```

The resolved config pins the training corpus and approved policy by hash,
freezes the 640-pixel fairness rules and evaluation inputs, records deviations,
and carries the complete measurement checklist. The wrapper re-runs preflight
with `releasePurpose: training` before a backend command executes and verifies
that the checkpoint repository is private.

`licenseRoute: evaluation-only` permits YOLO11n-pose and YOLO11s-pose training
and private Core ML/ONNX exports. An asset-store destination is rejected before
Hub access, workdir creation, or exporter execution. `enterprise` or `agpl`
unlocks that destination for Ultralytics candidates; YOLOX-Pose and the custom
FastViT head use the existing `permissive` route.

The checked-in `fixtures/experiment-config.evaluation-only.v1.json` is a
schema and guard fixture only: its training-release hashes and container digest
are placeholders. A real config cannot be prepared until the human approves
`training-minimums-v1`; the wrapper requires that exact policy id and its
committed SHA-256 and never generates a policy from corpus contents.

```sh
python3 tools/card-geometry/run_card_geometry_hf_job.py \
  --config <resolved-candidate-config.json> --action train --dry-run
```

## Running the checks

```sh
uv pip install -r tools/card-geometry/requirements.txt
uv pip install -r tools/card-geometry/compositor/requirements.txt
python3 -m unittest discover -s tools/card-geometry -p 'test_*.py'
```

`reference_geometry.py` and `build_fixture_releases.py` need only the standard
library. `preflight.py` needs the pinned `jsonschema`; the smoke needs the
pinned `huggingface_hub`.
