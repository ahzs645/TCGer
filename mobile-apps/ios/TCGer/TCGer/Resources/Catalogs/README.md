# iOS catalog resources (generated — not committed)

This directory holds the per-game offline catalog packs bundled by the iOS app.
Generated `manifest.json` and `*.pack.json` files are large, reproducible, and
gitignored.

## Regenerate

```bash
bunx tsx backend/src/scripts/build-catalog-packs.ts --sync
```

The canonical generated copies are written to `data/catalog/`; `--sync` refreshes
the web and iOS resources together.
