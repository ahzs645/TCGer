# TCGer for Android

The Android client is a native Kotlin + Jetpack Compose application. The first
milestone ports the iOS app's offline-first shell and the collection-management
vertical slice:

- on-device and self-hosted server environments
- dashboard statistics and recent binders
- binder creation, detail, and card inventory
- local and remote card search
- CameraX card capture and photo-library import
- selectable server pHash/embedding and on-device ArcFace/OCR recognition
- scanner results that can be confirmed and added directly to a binder
- pack opening with shared pack-core, offline pack assets, pull review, Favorites,
  collection saves, and server-backed sealed-opening linkage
- gated scanner developer tools, diagnostics, recordings, and authenticated prices
- wishlists
- persisted appearance, currency, and game preferences
- Room persistence, DataStore preferences, and a Retrofit API boundary

Sets/Pokédex, the full sealed-inventory browser, automatic binder-page
detection/page-photo storage, analytics, and widgets remain tracked in
[`PORTING_PLAN.md`](PORTING_PLAN.md).

## Requirements

- Android Studio with JDK 17
- Android SDK 35

The checked-in Gradle wrapper downloads the required Gradle distribution.

## Build and test

From this directory:

```bash
./gradlew testDebugUnitTest
./gradlew assembleDebug
```

Open `mobile-apps/android` in Android Studio to run the `app` configuration on
an emulator or physical device. The app supports Android 8.0 (API 26) and newer.

The default launch mode is **On this device** and needs no account or backend.
Use **Settings > Data source** to configure a TCGer server.

The scanner works in both modes. A signed-in server session can use the shared
pHash or embedding scanner and authenticated price endpoint. On-device mode
uses an integrity-checked ArcFace ONNX model/index with ML Kit title OCR
fallback. A DINOv2 q8 bundle is also production-selectable and preserves iOS's
gate/threshold contract plus strict manual title/collector OCR rescue, verified
on API 34 arm64. Camera permission is requested only for the live preview;
choosing existing photos remains available.

Pokémon retains its bundled fallback. The current Pokémon, Magic, and Yu-Gi-Oh!
ArcFace runtimes are also independently downloadable under **Settings >
Offline scanner models**. Each R2 manifest, model, vectors, and metadata set is
checksum-validated as one version before app-private atomic activation. A
downloaded runtime is used only for its explicitly selected game; it is not
used for cross-game automatic classification. **Check for update** safely
replaces the active version only after the replacement validates, and
**Remove** deletes that game's downloaded runtime.

## Architecture

The app follows a small, feature-oriented MVVM structure:

- `data/local` — Room entities, DAOs, and database
- `data/remote` — Retrofit service and API DTOs matching `docs/openapi.yaml`
- `data/repository` — environment-aware local/remote repository
- `data/scanner` — on-device OCR and card-title extraction
- `domain` — UI-facing models and repository contract
- `ui` — Compose screens, navigation, theme, and view models

Remote credentials are exchanged for a session token. Passwords are never
persisted. The token is stored in private DataStore preferences for this first
milestone; moving it to Android Keystore-backed encrypted storage is required
before production release.
