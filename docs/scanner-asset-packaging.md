# Scanner asset packaging: bundled now, R2 later

Decision (2026-08-09): **all scanner assets ship inside the iOS app bundle.**
Remote (Cloudflare R2) delivery is planned but deferred; when it lands, the
artwork fingerprint database is the first asset to move.

## Current state (enforced)

Everything the scanner needs is in the app bundle, and
`bash scripts/ios-assets.sh check` (also run as the app target's pre-build
guard; hard-fails Release builds) validates the generated pieces:

| Asset | Size | Source of truth | Checked by ios-assets.sh |
|---|---|---|---|
| `CardEmbeddings.mlpackage` | ~40 MB | generated (convert-dinov2-coreml.py) | yes — package + manifest |
| `CardsIndexVectors.bin` | ~8 MB | generated (build-ios-index.ts) | yes — header, size, count |
| `CardsIndexMetadata.json` | ~4 MB | generated (build-ios-index.ts) | yes — row/annIndex parity with bin |
| `CardFaceGate.json` | ~20 KB | tracked, mirrors backend fixture | yes — schema + fixture match |
| `artwork-fingerprints-uint8.json` | ~53 MB | tracked in git | n/a (always present) |
| `MagicCardHashes.json` | ~0.6 MB | tracked in git | n/a (always present) |
| Offline catalogs | varies | generated/synchronized | yes — manifest counts + SHA-256 |

Why bundled-first:

- **No version skew.** The index and rejection gate are only valid for the
  exact encoder that built them (loaders check model/dimension and disable
  themselves on mismatch). One atomic bundle can't drift.
- **Works offline from first launch.** No "scanner broken until a download
  finishes" state, which matters in phone-only mode.
- **The silent-failure class is closed.** Missing generated assets fail the
  Release build, and `ScannerAssetDiagnostics` (Scanner Debug → Scanner
  Assets pane) shows what an installed bundle actually contains.

Cost accepted for now: ~105 MB of scanner payload in the app, and shipping a
new Pokémon set's index requires an App Store release.

## Later: R2 delivery (planned, not started)

R2 infrastructure already exists in this repo (catalog + Yu-Gi-Oh image
delivery; see `cloudflare/`), and the web scanner already does versioned
index fetching against `scan-index/manifest.json`. The iOS migration should
reuse both patterns.

Move assets in this order:

1. **`artwork-fingerprints-uint8.json` (main candidate, first to move).**
   Largest single asset (53 MB), belongs to the *fallback* strategy, and
   `ArtworkFingerprintScannerStrategy` already knows how to load its database
   from the Documents directory instead of the bundle — the download path
   exists. Moving it cuts app size by more than everything else combined.
   The strategy already degrades cleanly (reports itself unsupported) while
   the file is absent.
2. **`CardsIndexVectors.bin` + `CardsIndexMetadata.json` (~13 MB).** The
   asset that actually goes stale — every new set needs a rebuild. Serve
   behind a manifest carrying `{version, model, dimension, count}`; the app
   keeps the build-time snapshot as the bundled fallback and only swaps in a
   downloaded index whose `model`/`dimension` match the bundled encoder.
   Refresh the gate alongside the index only if the encoder ever changes.
3. **`CardEmbeddings.mlpackage` — stays bundled indefinitely.** It rarely
   changes, everything else is version-locked to it, and remote-loading it
   would reintroduce the skew and first-run-failure classes for no practical
   size win once the fingerprints have moved.

Implementation notes for when this starts:

- Mirror `frontend/src/components/scan/use-video-scan-data.ts` semantics:
  fetch manifest, compare version, download to Application Support, verify
  (header/count/SHA-256 like ios-assets.sh does), then atomically swap.
- `ScannerAssetDiagnostics` should grow a per-asset "bundled / downloaded
  (version) / stale" state so the debug pane keeps telling the truth.
- Keep `ios-assets.sh check` authoritative for whatever remains bundled;
  downloaded assets get the same validations at install time instead.
