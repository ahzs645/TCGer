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
| `CORPUS_HASH` | `corpusHash` differs from the canonical hash of the manifest without that member |
| `RECORD_SCHEMA` / `RECORD_HASH` | a record violates its schema or differs from its manifest hash |
| `IMAGE_HASH` | an image is missing, differs from its manifest or record hash, or a PNG's IHDR size differs from the record |
| `MANIFEST_RECORD_CONSISTENCY` | manifest leakage keys or record ids disagree with record content |
| `LEAKAGE_KEYS_PRESENT` | a record lacks a leakage key its source kind requires under the policy |
| `LEAKAGE_DISJOINT` | a source archive, session, physical card, source asset, record hash, or image hash appears in more than one split |
| `EVAL_DENYLIST` | a frozen evaluation session appears outside the `test` split |
| `SPLIT_REAL_ONLY` | a synthetic record sits in a real-only split |
| `SHARED_FIXTURES` | the contract fixtures above do not reproduce in this environment |
| `CORNER_COUNTS` | never; it records `evaluated / eligible / skipped` corners per source kind, scene slice, and split |
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

## Running the checks

```sh
uv pip install -r tools/card-geometry/requirements.txt
cd tools/card-geometry && python3 -m unittest test_reference_geometry test_preflight
```

`reference_geometry.py` and `build_fixture_releases.py` need only the standard
library. `preflight.py` needs the pinned `jsonschema`; the smoke needs the
pinned `huggingface_hub`.
