# TCGer for iOS

The native SwiftUI app lives in `TCGer/` and includes the main app, widgets, and an XCTest unit-test target. The Xcode project is checked in; no project generator or CocoaPods step is required.

## Requirements

- Xcode 26 or newer
- iOS 26 simulator or device

The deployment target is intentionally iOS 26. The app uses iOS 26 SwiftUI APIs throughout the product, including Liquid Glass (`GlassEffectContainer`, `glassEffect`, and glass button styles), `safeAreaBar`, and `scrollEdgeEffectStyle`. Supporting an older OS therefore requires a product-wide availability and fallback pass; changing only `IPHONEOS_DEPLOYMENT_TARGET` will not produce a compatible build.

## Open and run

From the repository root:

```bash
open mobile-apps/ios/TCGer/TCGer.xcodeproj
```

Choose the `TCGer` scheme and an iOS 26 simulator, then Run. The Debug build uses the published catalog endpoint configured in the project and does not require a local backend for its bundled/offline catalog paths.

## On-device and server tab availability

The app has two operating modes:

- **On This iPhone** uses `LocalStore` and does not require a TCGer server or account.
- **Server mode** connects to a configured TCGer server and exposes features supported by that server.

Tabs backed only by server APIs are not shown in the bottom tab bar, its More list, or **Settings > Customize Tab Bar** while the app is in On This iPhone mode. Currently those tabs are **Decks**, **Trades**, and **Activity**. Connecting to a server makes them eligible to appear again, subject to the server's feature flags, authentication, and the user's saved tab visibility preference. Their position and visibility preferences remain stored while they are unavailable.

When an on-device implementation is added for one of these features, remove that case from `AppTab.requiresServerConnection`; tab availability is intentionally centralized there so navigation and customization stay consistent.

## Shared pack-opening catalog

The pack picker does not keep an iOS-specific list. Its embedded web experience
loads `pack/manifest.json` from the same R2 origin as the website, configured by
the `TCGER_PACK_ASSET_BASE_URL` build setting. The native URL-scheme handler
keeps a durable byte cache under `TCGerCache/PackOpeningAssets` and falls back
to the copy in `PackOpening.bundle` when the shared source is unavailable.
While online, the small pack manifest bypasses WebKit's HTTP cache so newly
published pack sets appear immediately; its last successful response remains
available offline. Content-addressed meshes, wrapper sheets, and encountered
card scans are reused without another request. Published wrapper images
themselves are R2-only; the embedded fallback contains the mesh and empty cover
registry, so a wrapper that has never been viewed uses generated artwork while
offline.
The Settings clear-cache action removes these files with TCGer's other caches.

After changing the shared pack renderer or its offline assets, rebuild that
bundle from the repository root:

```bash
node packages/pack-core/scripts/build-embed.mjs \
  --out mobile-apps/ios/TCGer/TCGer/Resources/PackOpening.bundle
```

New selectable packs are added by publishing their studio-generated
`manifest.entry.json`; no Swift or web pack-list edit is required.

## Build and test from the command line

```bash
xcodebuild \
  -project mobile-apps/ios/TCGer/TCGer.xcodeproj \
  -scheme TCGer \
  -destination 'generic/platform=iOS Simulator' \
  CODE_SIGNING_ALLOWED=NO \
  build

xcodebuild \
  -project mobile-apps/ios/TCGer/TCGer.xcodeproj \
  -scheme TCGer \
  -destination 'platform=iOS Simulator,name=iPhone 17 Pro' \
  test
```

Simulator names vary by installed runtime. Use `xcrun simctl list devices available` to choose one present on the machine.

Some scanner diagnostic tests are intentionally opt-in and report `XCTSkip` unless their documented fixture-directory environment variables are set. The deterministic unit tests run without those external recordings.

## App Store release automation

Xcode Cloud remains responsible for signing, archiving, and uploading every relevant `main` build to internal TestFlight. Production submission is deliberately separate: pushing a release tag selects one exact, already-uploaded TestFlight build, submits it to App Review, and asks App Store Connect to release it automatically after approval.

Before the first automated release, add these GitHub Actions repository secrets using an App Store Connect API key with App Manager access:

- `APP_STORE_CONNECT_ISSUER_ID`
- `APP_STORE_CONNECT_KEY_ID`
- `APP_STORE_CONNECT_PRIVATE_KEY_BASE64` — the downloaded `.p8` file encoded as a single base64 string

For each release:

1. Set `MARKETING_VERSION` for both the app and widget targets to the next three-part version, such as `1.0.1`.
2. Update `fastlane/metadata/en-US/release_notes.txt` with customer-facing release notes.
3. Merge the changes to `main` and wait for the Xcode Cloud `Release` workflow to upload and finish processing the build in TestFlight.
4. Push a tag containing both the version and the exact TestFlight build number:

```bash
git tag ios-v1.0.1-b208
git push origin ios-v1.0.1-b208
```

The `iOS App Store release` GitHub Actions workflow rejects tags that do not match the checked-in marketing version, waits for that exact build to be valid, and then submits it. It never builds or signs an app itself, and it never substitutes a merely "latest" build for the build named in the tag.

## Run on a physical device

Open the project in Xcode, select the `TCGer` app target, and choose a signing team under Signing & Capabilities. If the checked-in bundle identifier is not available to that team, use a unique app identifier and apply the same prefix change to the widget identifier and the shared App Group entitlement. Select the connected iOS 26 device and Run.

Camera scanning and biometric-lock behavior should be verified on hardware. The simulator remains appropriate for unit tests, navigation, offline catalog, import/export, and most accessibility checks.

## Universal links and App Shortcuts

Binder, wishlist, scanner, and search links are associated with `tcger.ahmadjalil.com`. The AASA source is checked in at `marketing-site/public/.well-known/apple-app-site-association`; the Pages workflow verifies that Vite copies it into the deployed artifact. App Shortcuts use these HTTPS links because `OpenURLIntent` requires a universal link rather than the app's custom URL scheme.

Changing the app's signing team or bundle identifier also requires updating the AASA `appIDs` entry and redeploying the marketing site. After deployment, confirm that `https://tcger.ahmadjalil.com/.well-known/apple-app-site-association` returns `200`, the JSON directly with no redirect, and a `Content-Type: application/json` response before testing links on a signed device build. GitHub Pages commonly serves extensionless files as `application/octet-stream`; if that remains true for this domain, configure the proxied domain (for example, with a Cloudflare response-header rule or Worker route) to serve this exact path as JSON.
