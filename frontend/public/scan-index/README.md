# Scan index artifacts (generated — not committed)

This directory holds the **client-side embedding index** the browser scanner
loads, plus the self-hosted encoder ONNX for the arcface variant. The
`*.json` / `*.bin` / `*.onnx` artifacts are **gitignored** — they are large,
reproducible build outputs, and are meant to be served as static, versioned,
CDN-cacheable assets (see `docs/client-side-scanner-options.md`, task 7).

Production serves them from R2 at
`https://assets.tcger.ahmadjalil.com/scan-index/`. The publisher rewrites the
model and index files to content-addressed `objects/<sha256>.*` keys, uploads
those immutable objects first, then updates `manifest.json` last. Consequently,
publishing a changed ONNX file gives it a new URL and the next scanner start
loads the matching new index/model bundle; old cached bundles remain valid for
offline clients.

## Encoder variants (see docs/scanner-convergence.md)

Two encoder generations are publishable per TCG; the manifest's per-TCG entry
decides which one clients run, so switching (or rolling back) is one
`update-scan-index-manifest.ts --prefer <encoder>` + republish, no client
change:

- `pokemon-embeddings-arcface.json` (**preferred**): the in-house
  ArcFace/FastViT-T8 encoder — the same model + vectors iOS ships as its
  default. Version-2 artifact: carries its calibrated `thresholds` and the
  encoder `modelUrl` (`card-embeddings-arcface.onnx`, fp16, ~8 MB) so model,
  index, and operating point travel as one unit. Built by
  `backend/src/scripts/build-arcface-web-index.ts` from the iOS index bin
  (Drive: `TCGer-encoder/CardsIndexVectors-arcface.bin`); ONNX exported by
  `mobile-apps/ios/scripts/export_arcface_onnx.py` from the Drive
  checkpoint. NOTE: int8 dynamic quantization DESTROYS this model (FastViT
  reparam convs) — ship fp16 or fp32, never q8.
- `pokemon-embeddings.json` (rollback): DINOv2-small via HF CDN, version-1
  artifact, code-default thresholds (0.72 DINOv2-scale).

## Regenerate

Requires the catalog image API reachable (e.g. the homelab `tcger-tcgdex`
service; port-forward it to `127.0.0.1:4040`).

```bash
cd backend
# Build the Pokémon index (DINOv2-small, int8). ~8–15 min over ~21.9k cards.
npx tsx src/scripts/build-embedding-index.ts \
  --tcg pokemon --api-url http://127.0.0.1:4040 \
  --model onnx-community/dinov2-small --encoder dinov2 \
  --out ../frontend/public/scan-index/pokemon-embeddings.json

# Build the ArcFace web index from the iOS bin (no image API needed).
npx tsx src/scripts/build-arcface-web-index.ts \
  --bin <path-to>/CardsIndexVectors-arcface.bin

# Refresh the versioned manifest the loader checks (arcface preferred by
# default; --prefer dinov2 to roll the fleet back).
npx tsx src/scripts/update-scan-index-manifest.ts

# Validate and preview the exact R2 upload plan (no credentials needed).
cd ../
npm run assets:r2:publish-scan-index -- --dry-run

# Publish with the current Cloudflare/Wrangler login. S3 credentials are also
# supported by omitting --wrangler; see cloudflare/README.md.
npm run assets:r2:publish-scan-index -- --wrangler
```

The loader (`use-video-scan-data.ts`) fetches `manifest.json` first and only
downloads an index when its version changed; bump `version` in the artifact to
invalidate caches. The R2 publisher also changes the manifest's artifact file
when the bytes change, which prevents an accidental same-version model/index
update from staying cached. Use `--image-base-url <public-host>` so the shipped index's
`imageUrl`s resolve outside the local port-forward.
