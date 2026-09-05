# Metadata-only evaluation successors — 2026-09-04

Both frozen evaluation releases now have v2 successors in the private
`ahzs645/tcger-scanner-images` dataset at revision
`3e03b753158b602b9f4ec3bdace2de05a5b2e5f2`.

| Evaluation | Predecessor corpus hash | Successor corpus hash | Records |
| --- | --- | --- | --- |
| Real v6-full | `7a75cc5ba2f0ac429136fa67f75b473e09c05f6edaee112bf0f5b1ba701a188a` | `631cc7f9ac24b19d5e7587f5c5aefa401f911cfcf4ed52ab6858ea29d3740dd7` | 600 |
| Synthetic multigame eval v1 | `bda45771be01d50bde130b6a68afe91ad509154df9aa26050f9cfdf30aad809a` | `fb3eca1aa55d99cbff03c1f0eb58600884be879af2d75b8b4becc3d94932ba05` | 1,000 |

The successor release paths and immutable pins are in
[evaluation-pins.json](evaluation-pins.json). They retain the experiment schema's
existing `frozenRealV3` and `syntheticDuelField` field names; those keys now select
the explicitly named v6-full and multigame successors when these pins are used.

## Identity evidence

The local predecessor manifests matched the bytes downloaded from Hub revision
`cd6ddd62c77d9597a3c94d168834e7a11d39cba4` before migration.
[Real verification](real-migration.json) and
[synthetic verification](synthetic-migration.json) confirm that every record and
image hash matches its actual file bytes in both releases. Entire manifest record
entries are unchanged, including hashes, ordering, splits, scene slices and leakage
keys. The readiness policy and all other evaluation payload fields are unchanged.
Both successors pass current preflight.

The only changed manifest fields are `schema`, `releaseId`, `supersedes`,
`sourceArchiveAliases`, and `corpusHash`. The first three are required migration
identity metadata; the alias tables are exact self-mappings. The v2 `$id` and
`schema` const live in the existing `card-geometry-release-manifest.v1.schema.json`
file. Each successor names its predecessor release and corpus hash in `supersedes`.
The original releases and historical results were not rewritten.

[Publication evidence](publication.json) records manifest SHA-256 verification
against the immutable uploaded revision. Remote payload identity is recorded in
[remote-verification.json](remote-verification.json).

## Tooling and use

[The migration tool](../../../../tools/card-geometry/migrate_evaluation_release.py)
creates a successor only with an explicit predecessor hash pin. Its `--verify-only`
mode repeats the actual byte checks with both release roots. It rejects changed
record hashes, image bytes, splits, scene slices, policies, or non-identity aliases.
`benchmark_geometry.py` reports the successor `corpusHash`,
`predecessorCorpusHash`, and `supersedes` identity.

Before starting training, `run_card_geometry_hf_job.py` downloads and preflights
every pinned evaluation release and enforces `CROSS_RELEASE_LEAKAGE_DISJOINT`.
It compares every record in the training release, including its validation/test
records, against every evaluation release. Shared canonical archive IDs, sessions,
source assets, or physical cards fail the gate. It merges alias knowledge across
releases and rejects conflicting mappings. The gate also runs when no
post-training evaluation command is configured. The deterministic fork fixture
pair passes each release's individual preflight but fails this gate; an execution
test confirms the training command is never called on overlap.

Validation: all 188 card-geometry tests and 10 compositor tests pass with the
repository-pinned image stack. Ruff and diff checks pass. No training or
incumbent scoring was run.

Execution order remains trainer repair and self-validation, incumbent comparisons
on the byte-identical real v6-full successor, then the revised corpus and
`training-minimums-v3` frozen before any round-two result.
