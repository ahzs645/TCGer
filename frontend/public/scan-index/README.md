# Scan index artifacts (generated — not committed)

This directory holds the **client-side embedding index** the browser scanner
loads (DINOv2-small, int8-quantized). The `*.json` / `*.bin` artifacts are
**gitignored** — they are large, reproducible build outputs, and are meant to be
served as static, versioned, CDN-cacheable assets (see
`docs/client-side-scanner-options.md`, task 7).

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

# Refresh the versioned manifest the loader checks.
npx tsx src/scripts/update-scan-index-manifest.ts
```

The loader (`use-video-scan-data.ts`) fetches `manifest.json` first and only
downloads an index when its version changed; bump `version` in the artifact to
invalidate caches. Use `--image-base-url <public-host>` so the shipped index's
`imageUrl`s resolve outside the local port-forward.
