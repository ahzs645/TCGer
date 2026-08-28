# Scanner release inventory — 2026-08-27

This is a point-in-time inventory. Mutable manifests may advance after this
date; immutable object hashes and Hub commit SHAs remain valid historical
references.

## Hugging Face state

- Authenticated account: `ahzs645`
- Private model repository: `ahzs645/tcger-universal-arcface`
- Verified `main` revision: `43856181ad5e6ce78ad5dbb82275e923d9bee573`
- Last modified at verification: `2026-08-27T22:09:51Z`
- Catalog snapshot revision used by the full runs:
  `4ae187396e03383a7a9f33816acd1531a7f390dc`

The model repository name is historical. Its completed production-oriented
artifacts are scoped per game under `exports/{game}/full` and
`training/{game}/full` rather than representing one shared set of weights.

## Full training jobs

| Game | Hugging Face job | Hardware | GPU running time | Result |
|---|---|---|---:|---|
| Pokémon | `6a904f4f45686a1580c0e8fd` | L4 × 1 | 1,441 s (24m 1s) | Completed resumed run |
| Magic | `6a905e4845686a1580c0ec01` | L4 × 1 | 20,210 s (5h 36m 50s) | Completed |
| Yu-Gi-Oh | `6a905e3b45686a1580c0ebff` | L4 × 1 | 6,278 s (1h 44m 38s) | Completed |

The Pokémon run resumed from an earlier interrupted/canceled attempt. This is
why its final job's running time is much shorter than a fresh 12-epoch run.

Notable earlier jobs:

| Purpose | Job | Result |
|---|---|---|
| Three-game quick smoke test | `6a8f78a4984507d9db4e69da` | Completed |
| Corrected paired Pokémon A/B | `6a8fb8dd984507d9db4e6fc7` | Completed |
| Persistent Hub write preflight | `6a8fb5ed45686a1580c0c949` | Completed |
| First fixed-batch baseline attempt | `6a8f8fcf45686a1580c0c389` | Failed; passed a batch of 256 to fixed batch one ONNX |

## Synthetic retrieval metrics

All full runs used 12 epochs, FastViT-T8, 384 dimensions, three training views
per identity, and three evaluation queries per selected identity.

| Game | Catalog rows | Recall@1 | Recall@5 | Optimizer steps/epoch | Configured steps |
|---|---:|---:|---:|---:|---:|
| Pokémon | 21,828 | 98.2400% | 99.6267% | 255 | 3,060 |
| Magic | 111,131 | 91.2000% | 97.8800% | 1,302 | 15,624 |
| Yu-Gi-Oh | 14,683 | 99.4000% | 99.5467% | 172 | 2,064 |

These are synthetic/catalog retrieval metrics, not end-to-end phone accuracy.
The Pokémon metric is not physical-only: 2,321 catalog rows were Pocket cards,
and 263 of 2,500 sampled evaluation identities were Pocket. The clean physical
catalog must be rebuilt at 19,507 rows and reevaluated.

### Full Pokémon paired comparison

The full Pokémon evaluation used a gallery of 21,775 identities and 2,500
query identities with three queries each:

| Model | Recall@1 | Recall@5 |
|---|---:|---:|
| Full isolated Pokémon shard | 98.1867% | 99.6000% |
| Shipped production Pokémon baseline | 97.9733% | 99.5333% |
| Student delta | +0.2133 points | +0.0667 points |

This result differs from the earlier quick paired comparison, where the quick
mixed-game shard trailed the production model. It shows the isolated full
recipe recovered synthetic performance, but Pocket contamination prevents it
from being the final physical-card acceptance decision.

## Android ONNX export jobs

| Game | Job | Result |
|---|---|---|
| Pokémon | `6a90b518984507d9db4e8ff6` | Completed in 38 seconds |
| Magic | `6a90b51845686a1580c0fb2c` | Completed in 37 seconds |
| Yu-Gi-Oh | `6a9097a845686a1580c0f6cb` | Completed in 36 seconds |

Every ONNX is 14,305,580 bytes, opset 18, fixed batch one, and passed CPU
parity against its source checkpoint.

| Game | Checkpoint SHA-256 | ONNX SHA-256 | Max absolute parity difference |
|---|---|---|---:|
| Pokémon | `95368ed5cc490ddc2d92ee151398af8f0a719b135f073be61f7c7070510a9430` | `bd7367284130639345efbe967e5e80b4aadf0ab5d5bc922968d2b06e497eea44` | 0.00000243 |
| Magic | `97bc0f3fce031475228d7b6711f4978b95618c4ff82f87082ffe711ca7bb4672` | `ebc725476ec2866cd054cd16ef9bcda257bbfdc5aa05326a79335abc4fdc0d3e` | 0.00000053 |
| Yu-Gi-Oh | `32c775c447a64c5e2c32b06cc7b43474e652754b1a1a4ee8814fe627bb437260` | `b304bde2171d8ca4a824a4e0cab4bc22c3b31e425a8ba5e3ef91aab4ec6f9d58` | 0.00000189 |

## Local exported artifacts

The verified release exports are under `.artifacts/scanner-release/exports` and
are intentionally gitignored.

| Game | Core ML zip | Metadata | Vectors | Android ONNX |
|---|---:|---:|---:|---:|
| Pokémon | 6,627,819 B | 4,621,631 B | 8,381,960 B | 14,305,580 B |
| Magic | 6,626,024 B | 34,795,554 B | 42,674,312 B | 14,305,580 B |
| Yu-Gi-Oh | 6,627,957 B | 3,476,197 B | 5,638,280 B | 14,305,580 B |

The packed vector size is `8 + rows × 384` bytes. The first eight bytes are the
little-endian count and dimension header.

## Live browser scanner manifest

Verified from `https://assets.tcger.ahmadjalil.com/scan-index/manifest.json`:

- published at `2026-08-27T22:16:44.431Z`;
- preferred encoder: `arcface`;
- Pokémon DINOv2 remains an alternate rollback artifact.

| Game | Manifest version | Rows | Decoded index | Gzip transfer | ONNX | Total first-version transfer |
|---|---:|---:|---:|---:|---:|---:|
| Pokémon | 3 | 21,828 | 14,563,035 B | 7,016,337 B | 14,305,580 B | 21,321,917 B |
| Magic | 1 | 111,131 | 85,247,800 B | 39,991,618 B | 14,305,580 B | 54,297,198 B |
| Yu-Gi-Oh | 1 | 14,683 | 10,138,955 B | 4,897,277 B | 14,305,580 B | 19,202,857 B |

Browsers transparently decompress the HTTP response and store the parsed index
in IndexedDB. The manifest's byte count and object hash describe the decoded
JSON representation used for diagnostics.

## Live iOS scanner manifests

| Game | Version | Rows | Download bytes |
|---|---:|---:|---:|
| Pokémon | 1 | 21,828 | 20,262,052 B |
| Magic | 1 | 111,131 | 84,728,327 B |
| Yu-Gi-Oh | 2 | 14,683 | 16,372,938 B |

The iOS payload contains the Core ML package files, vectors, and metadata. The
app verifies hashes, compiles the model on-device, and activates the staged
version only after validation succeeds.

## Live Android scanner manifests

| Game | Version | Rows | Download bytes |
|---|---:|---:|---:|
| Pokémon | 1 | 21,828 | 27,309,171 B |
| Magic | 1 | 111,131 | 91,775,446 B |
| Yu-Gi-Oh | 2 | 14,683 | 23,420,057 B |

Android uses the fp32 ONNX, vectors, and metadata. It preserves the previously
installed version if an update fails.

## Live catalog manifest

Verified from `https://assets.tcger.ahmadjalil.com/catalogs/manifest.json`,
generated `2026-08-12T15:05:46.524Z`:

| Game | Version | Cards | Sets | Raw bytes | Compressed bytes | Sealed products |
|---|---:|---:|---:|---:|---:|---:|
| Pokémon | 11 | 25,498 | 234 | 7,730,806 | 550,030 | 2,725 |
| Magic | 3 | 107,338 | 986 | 45,105,192 | 7,625,915 | 2,263 |
| Yu-Gi-Oh | 3 | 44,941 | 658 | 16,982,003 | 1,623,546 | 1,095 |
| One Piece | 4 | 4,023 | 51 | 1,476,986 | 109,293 | 249 |
| Lorcana | 2 | 3,192 | 22 | 1,772,372 | 218,429 | 164 |

Catalog counts intentionally differ from scanner rows. Catalogs may include
digital formats, printing rows, and metadata useful to collection features;
scanner indexes contain visual identities eligible for a particular runtime.

## Verification completed locally

During integration the following passed:

- iOS simulator build;
- Android `testDebugUnitTest`;
- frontend TypeScript validation and 134 tests;
- scanner image-library tests;
- trainer ingestion/hardening tests;
- Python compilation and `git diff --check`.

These results validate code and packaging mechanics. They do not replace the
missing real-phone acceptance suites.
