---
title: Publishing and validation
description: Validate, hash, sign, host, and update a future game's package.
---

## Validate the data contracts

Author new packages with manifest v2. The generated structural schemas are in `docs/scanner-system/schemas/`:

| Artifact | Schema file |
| --- | --- |
| New package manifest | `game-package-manifest.v2.schema.json` |
| Legacy package manifest | `game-package-manifest.v1.schema.json` |
| Prices | `game-price-snapshot.v1.schema.json` |
| Pack recipes | `game-pack-library.v1.schema.json` |
| Web scanner bundle | `game-scanner-bundle.v1.schema.json` |

Runtime contracts live in `packages/api-types/src/game-packages.ts` and `game-capabilities.ts`. JSON Schema validates structure; runtime installation also checks unique IDs, references, matching game IDs/counts, effective dates, hashes, bounds, and signature continuity. Passing structural validation alone is insufficient.

When changing the contracts themselves, regenerate the schemas from the repository root:

```sh
npx tsx tools/game-packages/build-schema.ts
```

## Hash final files

Every asset reference records `url`, `bytes`, and `sha256`. Compute these after final serialization, including whitespace and the trailing newline. Editing a referenced file invalidates its old hash and byte count.

For example, to inspect a local catalog's exact bytes:

```sh
node --input-type=module -e 'import {readFileSync} from "node:fs"; import {createHash} from "node:crypto"; const bytes = readFileSync(process.argv[1]); console.log(JSON.stringify({bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex")}, null, 2));' path/to/cards.json
```

Manifests are limited to 1 MiB and referenced artifacts to 512 MiB each. Capability schemas also impose their own count and size limits. Hash nested assets first, then their containing manifests, then the top-level manifest.

## Sign and host

Serve manifests and assets over HTTPS. Web hosts must allow the app's cross-origin requests through CORS. Loopback HTTP is available for web development. Relative URLs resolve from the manifest containing them; `update.manifestUrl` is an update channel, not an alternative installation base.

Public releases should declare an Ed25519 signing key and detached signature. The signing tool prepares those fields and signs the exact output manifest bytes:

```sh
node tools/game-packages/sign-manifest.mjs --manifest path/to/game-package.json --private-key /secure/path/publisher-ed25519.pem --key-id release-key
```

Keep the private key outside published artifacts and the repository. Verify the CLI's output paths before upload. A first installation pins the declared publisher key; the signature establishes continuity with that key, not independent verification of a publisher's name.

Upload immutable assets first, then the signature and package manifest. Official store publishing updates the global index last. Hosting a community package makes it available through **Install from URL**; it does not automatically add it to the official store index.

## Release an update

Keep `game.id`, `publisher.id`, `packageId`, and existing card identities stable. Increment `update.sequence` for every changed release, set `packageVersion` for display, and retain a stable `update.manifestUrl`.

A lower sequence is a downgrade; different content at the same sequence is a conflict. Legacy unsequenced packages use publication time, and mixing sequence policies in one package slot is rejected. A verified signed installation cannot downgrade to an unsigned release or silently switch keys.

Clients validate a replacement before activating it and retain the earlier installation on failure. Users choose when to update. Existing deck rules remain snapshotted; see [Deck rules](/adding-games/decks/).

## Test the authoring path

Install your actual hosted URL on each supported client, enable each optional download, then follow each capability page's checks. Test a catalog update with stable IDs and a failed update with a bad checksum. Verify that saved collection records and the prior working installation survive.

The repository's fictional fixture has regression coverage. These commands run existing suites; they do not automatically validate an arbitrary publisher's package:

```sh
node --test tools/game-packages/future-game-browser.test.mjs
npm --prefix frontend test
npm --prefix backend test -- --runInBand src/modules/decks src/modules/collections/future-game-storage.test.ts src/modules/collections/import.service.test.ts
npm --prefix convex-backend run test:once -- convex/decks.test.ts convex/collectionImport.test.ts
mobile-apps/android/gradlew -p mobile-apps/android :app:testDebugUnitTest --tests '*FutureGameTest'
```

For iOS, run `TCGerTests/FutureGameTests.swift` through the app's test target with an available simulator. The implementation record distinguishes build-for-testing from actual runtime execution. Any new scanner model also needs its own [camera evaluation](/adding-games/scanning/).

## Preview these docs

From the repository root:

```sh
npm --prefix docs run dev
npm --prefix docs run check
npm --prefix docs run build
```

Open the local Astro URL and select **Adding Games**. Building the documentation does not publish it or deploy the app, database migration, or Convex functions.
