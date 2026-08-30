# Runbook: republish Magic + Pokémon scanner manifests with `acceptancePolicy`

Date prepared: 2026-08-29 (after `c360def1`). Purpose: add the
`tcger-scanner-acceptance-policy-v1` block to the live iOS and Android
scanner manifests for Magic and Pokémon. **Manifest-only change** — every
referenced object already exists in R2 with identical bytes (verified below),
so the publisher will report `skip` for all objects and upload only the four
manifests. Versions stay at 2: installed clients keep running the built-in
profile (same values); fresh installs read the declared policy.

Yu-Gi-Oh! is deliberately **not** included: its live manifests are format 1
and its artifacts have not been re-exported to the v3 family metadata the
current publisher requires. Leave it on the built-in profile.

## Preconditions

Run from the TCGer repo root at commit `c360def1` or later (`git log --oneline -1`).

```sh
export CLOUDFLARE_ACCOUNT_ID=…   # R2 account
export R2_ACCESS_KEY_ID=…
export R2_SECRET_ACCESS_KEY=…
export R2_BUCKET=tcger-assets
```

The local artifacts must be the exact bytes that are live. They are under
`.artifacts/scanner-release/` on the release machine; verify before publishing:

```sh
A=.artifacts/scanner-release
M=$A/magic-visual-style-v2-5c27e506-r2;  ME=$M/exports/magic/full/visual-style-v2-5c27e506-r2
P=$A/pokemon-physical-v2-107fe33b;       PE=$P/exports/pokemon/full/physical-v2-107fe33b

shasum -a 256 $ME/CardsIndexVectors-arcface.bin $ME/CardsIndexMetadata.json \
  $M/android/card-embeddings-arcface-fp32.onnx \
  $M/runtime/CardEmbeddings-arcface.mlpackage/Data/com.apple.CoreML/weights/weight.bin \
  $PE/CardsIndexVectors-arcface.bin $P/release/CardsIndexMetadata.json \
  $P/hub-download/exports/pokemon/full/physical-v2-107fe33b/card-embeddings-arcface-fp32.onnx \
  $PE/runtime/CardEmbeddings-arcface.mlpackage/Data/com.apple.CoreML/weights/weight.bin
```

Expected prefixes (must match, otherwise STOP):

| File | SHA-256 prefix |
|---|---|
| Magic vectors | `acfbead865eb` |
| Magic metadata | `49e720b58258` |
| Magic Android ONNX | `9c1b7c94e3f1` |
| Magic iOS weight.bin | `e5d65cbce43c` |
| Pokémon vectors | `bafded058a23` |
| Pokémon metadata (**`release/`**, not `exports/`) | `6d7e2721c94b` |
| Pokémon Android ONNX | `cf29f497cd93` |
| Pokémon iOS weight.bin | `07a4cf98a112` |

## Step 1 — dry run (no credentials needed)

```sh
node tools/r2/publish-ios-scan-pack.mjs --game magic --version 2 \
  --model-package $M/runtime/CardEmbeddings-arcface.mlpackage \
  --vectors $ME/CardsIndexVectors-arcface.bin --metadata $ME/CardsIndexMetadata.json \
  --evaluation $ME/arcface-eval.json --provenance $ME/provenance.json --dry-run

node tools/r2/publish-android-scan-pack.mjs --game magic --version 2 \
  --model $M/android/card-embeddings-arcface-fp32.onnx \
  --vectors $ME/CardsIndexVectors-arcface.bin --metadata $ME/CardsIndexMetadata.json --dry-run

node tools/r2/publish-ios-scan-pack.mjs --game pokemon --version 2 \
  --model-package $PE/runtime/CardEmbeddings-arcface.mlpackage \
  --vectors $PE/CardsIndexVectors-arcface.bin --metadata $P/release/CardsIndexMetadata.json \
  --evaluation $PE/arcface-eval.json --provenance $PE/provenance.json --dry-run

node tools/r2/publish-android-scan-pack.mjs --game pokemon --version 2 \
  --model $P/hub-download/exports/pokemon/full/physical-v2-107fe33b/card-embeddings-arcface-fp32.onnx \
  --vectors $PE/CardsIndexVectors-arcface.bin --metadata $P/release/CardsIndexMetadata.json --dry-run
```

Expected `downloadBytes`: iOS Magic `118044412`, Android Magic `125091531`,
iOS Pokémon `24721047`, Android Pokémon `31768166` — identical to the live
manifests. Any other number means the artifacts differ: STOP.

## Step 2 — publish (same four commands without `--dry-run`)

Each run logs `{"action":"skip",…}` for every object (they already exist with
matching SHA-256 metadata) and then uploads the manifest last. If any object
logs `upload`, the local bytes differ from live — abort and investigate before
the manifest write happens (objects are uploaded before the manifest, so an
aborted run leaves the live manifest untouched).

## Step 3 — verify

```sh
for p in ios android; do for g in magic pokemon; do
  curl -s https://assets.tcger.ahmadjalil.com/$p/scan-assets/$g/manifest.json \
  | python3 -c "import json,sys; m=json.load(sys.stdin); print('$p/$g', m['version'], m['downloadBytes'], m['acceptancePolicy'])"
done; done
```

Expected: version `2`, the byte totals above, and for Magic
`{"schema":"tcger-scanner-acceptance-policy-v1","strongAcceptanceScore":0.7,"ambiguityMargin":0.05,"evidenceFloor":0.55,"titleGate":"binderPage","uniqueTitleRescue":true,"titleAgreementRescue":true,"collectorNumberScope":"family"}`;
Pokémon identical except `strongAcceptanceScore: 0.65` and `titleGate: "never"`.

Then on a device with the game already installed: Settings → scanner shows
**no update available** (same version). On a fresh install the downloaded
`manifest.json` in the version directory contains `acceptancePolicy`.

## Rollback

The previous manifests are content-identical minus the `acceptancePolicy`
block; the field is optional and ignored by older clients. To roll back,
re-run Step 2 from a checkout before `c360def1` (the publisher there does not
emit the field), or hand-edit the block out of the live manifest. Objects
never change.

## Not in scope

- Browser index (`scan-index/manifest.json`): its thresholds now derive from
  the policy at build time, which would move Magic web from 0.65 to 0.70 and
  change the index object hash. That is a separate, versioned release
  requiring the 22-frame browser replay first.
- Yu-Gi-Oh! (format-1 manifests; see above).
