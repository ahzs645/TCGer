# Offline catalog packs (generated — not committed)

This directory holds the per-game catalog packs used by the web app. Generated
`manifest.json` and `*.pack.json` files are large, reproducible, and gitignored.

## Regenerate

```bash
bunx tsx backend/src/scripts/build-catalog-packs.ts --sync
```

The canonical generated copies are written to `data/catalog/`; `--sync` refreshes
this directory and the iOS catalog resources together.
