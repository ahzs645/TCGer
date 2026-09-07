---
title: Scanning
description: Attach compatible, game-trained scanner assets for web, iOS, and Android.
---

## Declare supported platforms

Set `definition.interfaces.scanner` to `true` and add root `scanner` entries for the platforms you actually supply. Each entry uses `runtime: "tcger-arcface-v1"` and a `manifest` asset with a URL, exact byte count, and SHA-256. Supported platform keys are `web`, `ios`, and `android`.

The flag enables discovery of a compatible asset contract. It does not train a recognizer or adapt an unrelated model. The model, reference vectors, metadata, and catalog must agree on the game's identities and encoder representation.

## Build the appropriate artifacts

| Platform | Referenced manifest and assets | Repository guide |
| --- | --- | --- |
| Web | `tcger-scanner-bundle-v1` with `gameId`, hashed `index`, and hashed `model` | `frontend/public/scan-index/README.md` |
| iOS | Native `ScannerAssetManifest`, including model package files, vectors, and metadata | `mobile-apps/ios/TCGer/TCGer/CardScanner/README.md` |
| Android | Native scanner manifest, including model, vectors, and metadata | `mobile-apps/android/app/src/main/java/com/ahmadjalil/tcger/data/scanner/model/README.md` |

Native manifests follow their platform exporters; they are not interchangeable with the web bundle. The web bundle's structural schema is `docs/scanner-system/schemas/game-scanner-bundle.v1.schema.json`.

Use these existing pipeline guides from the repository:

- `docs/scanner-system/training-and-data-pipeline.md`: catalog preparation, training, evaluation, and export.
- `docs/scanner-system/client-integration-and-distribution.md`: runtime contracts and platform delivery.
- `docs/scanner-system/game-acceptance-policy.md`: calibration and acceptance behavior.

For web, index game identity and catalog external IDs must agree, and entry counts, dimensions, and packed vector byte lengths must be consistent. Package loading verifies the declared model bytes; it does not trust alternate unverified model URLs embedded in downloaded metadata. Resolve nested asset paths relative to the manifest containing them.

## Install and verify

Download the scanner capability from the installed library. Native scanner assets have their own installation lifecycle alongside catalog storage. New game IDs can be discovered from installed compatible models.

Check installation, offline reload, and rejection of wrong hashes, mismatched games, and unknown card references. Then evaluate actual camera images from the new game, including difficult matches and cards that should be rejected. Successful asset installation is not evidence of recognition accuracy.

The Star Garden fixture deliberately has no model. Its package tests cover routing and data validation, not new-game camera accuracy. Finish with the [publishing checks](/adding-games/publishing/) for each supported platform.
