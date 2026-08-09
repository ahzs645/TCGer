# Scanner asset packaging: bundled now, R2 later

Decision (2026-08-09): **all scanner assets ship inside the iOS app bundle,
and the iOS ScanIndex assets are tracked in git.** Remote (Cloudflare R2)
delivery is planned but deferred; when it lands, the artwork fingerprint
database is the first asset to move.

Why tracked in git: the app is built by **Xcode Cloud on push**, from a fresh
clone of the repository. There is no `ci_scripts/` post-clone hook, so a
gitignored asset can never reach a cloud build — the pre-build guard only
*warns* by default (`REQUIRE_IOS_ASSETS=YES` makes it fail), so every cloud
build silently shipped a scanner with no model/index. That was the root cause
of "scanning does nothing" on TestFlight installs. Tracking the assets makes
push → Xcode Cloud → TestFlight produce a working scanner with no extra
build-machine setup. When R2 delivery lands, a `ci_scripts/ci_post_clone.sh`
download can replace the in-repo copies and shrink the repo again.

Do NOT move these files to Git LFS: Xcode Cloud does not resolve LFS
pointers, which would silently reintroduce the missing-asset failure.

Caveat — offline catalogs: the catalog packs (`data/catalog`,
`frontend/public/catalog`, iOS `Resources/Catalogs`) remain gitignored, so
Xcode Cloud builds ship without them and the app uses its remote/on-device
fallbacks — degraded, not broken. Consequence: do NOT set
`REQUIRE_IOS_ASSETS=YES` in the Xcode Cloud workflow yet — the guard checks
catalogs too and would fail every cloud build. Set it only after catalogs are
either committed (check their size first) or fetched by a
`ci_scripts/ci_post_clone.sh`, or after the guard learns to require scanner
assets separately from catalogs.

## Current state (enforced)

Everything the scanner needs is in the app bundle, and
`bash scripts/ios-assets.sh check` (also run as the app target's pre-build
guard; hard-fails Release builds) validates the generated pieces:

| Asset | Size | Source of truth | Checked by ios-assets.sh |
|---|---|---|---|
| `CardDetector.mlmodel` | ~30 MB | trained from the reviewed Roboflow archive set, tracked in git | yes — file + minimum size |
| `CardEmbeddings.mlpackage` | ~40 MB | generated (convert-dinov2-coreml.py), tracked in git | yes — package + manifest |
| `CardsIndexVectors.bin` | ~8 MB | generated (build-ios-index.ts), tracked in git | yes — header, size, count |
| `CardsIndexMetadata.json` | ~4 MB | generated (build-ios-index.ts), tracked in git | yes — row/annIndex parity with bin |
| `CardFaceGate.json` | ~20 KB | tracked, mirrors backend fixture | yes — schema + fixture match |
| `artwork-fingerprints-pokemon-uint8.json` | ~53 MB | tracked in git | n/a (always present) |
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

1. **Artwork fingerprint databases (main candidate, first to move).**
   Fingerprint databases are per game — `artwork-fingerprints-<tcg>-uint8.json`
   (`<tcg>` = `TCGGame.rawValue`: pokemon, magic, yugioh, …), loaded lazily on
   first scan of that game; only Pokémon's exists today. Largest single asset
   (53 MB), belongs to the *fallback* strategy, and
   `ArtworkFingerprintScannerStrategy` already checks the Documents directory
   when a game's file is not in the bundle — the download path exists, and
   per-game files map 1:1 onto per-game R2 objects. Moving them cuts app size
   by more than everything else combined. The strategy degrades cleanly
   (reports the game unsupported) while a file is absent. The pre-per-game
   filename `artwork-fingerprints-uint8.json` is still honored as a fallback;
   the game it serves comes from its own `tcg` field.
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
