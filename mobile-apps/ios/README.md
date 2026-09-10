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

Release builds do not bundle game-specific scanner models or indexes. Opening
the scanner (or switching games) loads the small R2 manifest and prompts to
install that game's verified offline runtime. Successful installs activate in
the open scanner; later manifest versions use the same update prompt and atomic
rollback-safe installation path.

Some scanner diagnostic tests are intentionally opt-in and report `XCTSkip` unless their documented fixture-directory environment variables are set. The deterministic unit tests run without those external recordings.

## App Store release automation

Both stages run in Xcode Cloud. The existing **Release** workflow signs, archives, and uploads relevant `main` builds to internal TestFlight. The **Submit Release** workflow promotes one exact, already-uploaded TestFlight build to App Review and requests automatic release after approval. GitHub Actions is not involved in submission.

Configure **Submit Release** in App Store Connect → TCGer → Xcode Cloud → Manage Workflows:

- Name: exactly `Submit Release` (the scripts use this name as a guard).
- Repository/project: the same as **Release**.
- Start condition: **Tag Changes**, tags beginning with `ios-v`; no branch, pull-request, or schedule triggers. Leave auto-cancel off.
- Action: exactly one **Build – iOS**, scheme `TCGer`, using a current iOS simulator. Do not add Archive, Test, or distribution post-actions.
- Environment: latest stable Xcode/macOS. A clean build is optional.

Xcode Cloud requires an action, so this workflow compiles the tagged source before its post-build script submits the previously uploaded build. It never archives or uploads a replacement binary. The build number in the tag refers to the earlier TestFlight upload, **not** the new Submit Release workflow run number. This also avoids waiting for an upload that cannot finish until the current workflow ends.

Before the first submission, add these **workflow-specific secret environment variables** using an App Store Connect API key with App Manager access:

- `APP_STORE_CONNECT_ISSUER_ID`
- `APP_STORE_CONNECT_KEY_ID`
- `APP_STORE_CONNECT_PRIVATE_KEY_BASE64` — the downloaded `.p8` file encoded as a single base64 string

Keep the private key out of git and mark the values as Secret in Xcode Cloud. Put these credentials only on **Submit Release**, not the PR or routine TestFlight workflows. The submission hook installs Ruby 3.3 and the Fastlane dependencies pinned by `Gemfile.lock` in its own temporary environment.

For each release:

1. Set `MARKETING_VERSION` for both the app and widget targets to the next three-part version, such as `1.0.1`.
2. Update `fastlane/metadata/en-US/release_notes.txt` with customer-facing release notes.
3. Merge the changes to `main` and wait for the Xcode Cloud `Release` workflow to upload and finish processing the build in TestFlight.
4. Test that build, then tag the exact source commit used for its Xcode Cloud archive. The tagged commit must already contain the submission hooks, lockfile, and final release notes. Push a tag containing both the version and the exact TestFlight build number (the values below are examples):

```bash
git tag ios-v1.0.1-b241 <tested-build-commit>
git push origin ios-v1.0.1-b241
```

The pre-build hook validates the workflow, action, tag, app/widget marketing version, nonempty release notes, and presence of credentials before compiling. Only a successful Build action can run the submission hook. Fastlane waits for the named build to be valid and submits it with the checked-in release notes; it never substitutes a "latest" build. Existing screenshots and other unchanged product-page information are reused. The current release policy is immediate availability after approval, with phased release disabled.

Monitor the **Submit Release** build log for submission errors, then App Store Connect's App Review page for Apple's decision. A successful workflow means submission completed; Apple approval is separate. If a run fails after contacting Apple, check the current submission state before retrying the same tag. Do not create a new tag just to retry a failed submission: release tags also set the version guard's floor.

The `ci_scripts/app_store_release` symlinks make the Fastlane files, lockfile, release notes, and project version available to Xcode Cloud's later script phases, as described in Apple's [custom-script resource guidance](https://developer.apple.com/documentation/xcode/writing-custom-build-scripts). Keep these symlinks when reorganizing the iOS project.

Validate the submission guards locally without contacting Apple:

```bash
python3 -m unittest discover -s mobile-apps/ios/scripts -p 'test_xcode_cloud_release.py'
```

For an end-to-end Xcode Cloud verification without submitting to Apple, temporarily set `TCGER_RELEASE_MODE=verify` and `TCGER_RELEASE_TAG=ios-v<version>-b<existing-build>` on **Submit Release**, then manually start it from a branch containing these scripts and the matching project version. This runs the real simulator build, installs the locked dependencies, authenticates with Apple, and finds the processed TestFlight build. It stops before updating metadata or creating a review submission. Restore `TCGER_RELEASE_MODE=submit` after verification. `TCGER_RELEASE_TAG` is ignored in submit mode, which always requires a real Git tag from `CI_TAG`.

Xcode Cloud also runs `TCGer/ci_scripts/ci_pre_xcodebuild.sh` before every archive action. The guard rejects inconsistent app/widget versions, a version that is not newer than `APP_STORE_LIVE_VERSION` or the highest `ios-v…-b…` release tag, and any commit that decreases the marketing version from its parent. This prevents an archive from being uploaded to a closed App Store version train without interfering with pull-request test actions. Keep `APP_STORE_LIVE_VERSION` as the bootstrap version already on the store; release tags become the authoritative floor after subsequent submissions.

## Run on a physical device

Open the project in Xcode, select the `TCGer` app target, and choose a signing team under Signing & Capabilities. If the checked-in bundle identifier is not available to that team, use a unique app identifier and apply the same prefix change to the widget identifier and the shared App Group entitlement. Select the connected iOS 26 device and Run.

Camera scanning and biometric-lock behavior should be verified on hardware. The simulator remains appropriate for unit tests, navigation, offline catalog, import/export, and most accessibility checks.

In a binder, **Add Card to Binder** offers text search, **Scan card**, and
**Choose photo**. Camera and photo matches use the existing scanner review and
preselect that binder when saving, including in batch review. Choosing a photo
does not start the camera or request camera access; **Use camera** switches to
live capture. Scanning follows the selected supported game and its normal
scanner-package installation flow.

## Universal links and App Shortcuts

Binder, wishlist, scanner, and search links are associated with `tcger.ahmadjalil.com`. The AASA source is checked in at `marketing-site/public/.well-known/apple-app-site-association`; the Pages workflow verifies that Vite copies it into the deployed artifact. App Shortcuts use these HTTPS links because `OpenURLIntent` requires a universal link rather than the app's custom URL scheme.

Changing the app's signing team or bundle identifier also requires updating the AASA `appIDs` entry and redeploying the marketing site. After deployment, confirm that `https://tcger.ahmadjalil.com/.well-known/apple-app-site-association` returns `200`, the JSON directly with no redirect, and a `Content-Type: application/json` response before testing links on a signed device build. GitHub Pages commonly serves extensionless files as `application/octet-stream`; if that remains true for this domain, configure the proxied domain (for example, with a Cloudflare response-header rule or Worker route) to serve this exact path as JSON.
