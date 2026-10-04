# Release verification and direct APK distribution

Android distribution currently uses a directly installed signed APK. Google Play
publishing is outside this workflow. The release check reports configuration,
actual signed artifacts, hosted links and device journeys separately; a build or
an association declaration alone is insufficient.

## Android APK

With JDK 17 and the Android SDK configured:

```sh
npm run release:apk
```

The first run creates a private RSA signing key and private configuration in
`~/.config/tcger/apk-signing` (directory 0700; key/configuration 0600). Subsequent
runs reuse that identity. Keep a secure backup of this folder: future updates
must use the same signing key. `TCGER_APK_SIGNING_DIRECTORY` selects another
private location. Existing keys are never overwritten or silently replaced.

Only the public certificate fingerprint is saved in
`frontend/src/lib/release-identities.json`. The APK is copied to
`mobile-parity/results/release/android/TCGer.apk`, an ignored local artifact.
Install it with `adb install -r <apk>` or transfer it to the device and approve
installation from that source. A previous Debug installation uses a different
certificate; Android will reject an update across those identities. Preserve or
export local data before removing an existing installation.

CI can supply `TCGER_RELEASE_STORE_FILE`, `TCGER_RELEASE_STORE_PASSWORD`,
`TCGER_RELEASE_KEY_ALIAS` and `TCGER_RELEASE_KEY_PASSWORD`; Gradle also accepts
corresponding `tcgerRelease*` properties. Missing release signing fails the build.
`-PtcgerAllowUnsignedRelease=true` permits an explicit compiler check only; it
cannot pass signed-artifact readiness.

## iOS distribution

`mobile-apps/ios/release/archive.sh` archives and exports a Release IPA with the
repository's existing team, bundle identifier and export settings. It requires
appropriate distribution certificates/profiles. It does not publish or upload.
The configured public application identifier is
`6347A46LMY.firstform.TCGer`; the checker must confirm that identifier in the
exported application's entitlements. A valid simulator signature cannot satisfy
this gate. Export output is under ignored `mobile-parity/results/release/ios`.

## Associations and hosted fallback

The normal Next.js app serves Android Digital Asset Links and Apple's association
JSON under `/.well-known/`. Public identity defaults come from the tracked JSON;
`TCGER_ANDROID_CERT_SHA256` and `TCGER_IOS_APP_ID` override them. Multiple Android
fingerprints are comma separated. Do not substitute Debug certificates.
Deploy the files to the configured `https://tcger.ahmadjalil.com` origin without
redirects, using `application/json`. Deploying changed JSON is necessary before
Android domain verification or iOS Universal Links can work.

Canonical `/search?q=...`, `/binder/:id` and `/wishlist/:id` links redirect to web
screens while preserving queries and target IDs. Search links run the query;
wishlist links select only the addressed record. Missing/inaccessible wishlists
produce an explicit unavailable state. Local routing tests do not prove OS domain association.

### Current canonical host: GitHub Pages

`tcger.ahmadjalil.com` currently serves the marketing site plus `/demo`, built by
`.github/workflows/pages.yml`. It is not the normal Next.js application server.
`tools/release/pages-app-links.mjs` writes both association files from the same
tracked identities after copying the static demo. The Pages upload explicitly
includes hidden files: upload-pages-artifact v5 otherwise excludes `.well-known`
([action implementation](https://github.com/actions/upload-pages-artifact/blob/v5/action.yml)).

Pages serves its custom 404 HTML for native link paths. The browser fallback
routes supported paths into `/demo/?next=...`; Enter Demo preserves the search or
target ID. Return destinations are restricted to known demo screens. Missing
binders/wishlists show an unavailable state rather than unrelated private data.
The demo uses sample/browser-local records; a native account's local records are
not made available by opening its URL in the browser. A fallback response can
remain HTTP 404 even when its browser navigation succeeds; it is not a server
307 redirect and does not satisfy the production redirect gate.

Verify deployed association HTTP headers as well as bytes. GitHub Pages does not
allow custom MIME types per file or repository
([GitHub documentation](https://docs.github.com/en/pages/getting-started-with-github-pages/creating-a-github-pages-site#mime-types-on-github-pages)).
An extensionless Apple association may require an HTTPS proxy/server on this
same host that can return `application/json`; a checked-in file cannot set that
header. Retain the pending association gate until verified. No additional domain
is required to make that change, but hosting/DNS credentials would be needed.

The static demo disables service-worker registration. Its manifest alone does
not prove an installable/offline production web application. The full release
checker intentionally continues to report missing production PWA/redirect
requirements on this hosting setup. Do not weaken those gates to claim readiness.

## Readiness evidence

Commit source, build the artifact and test that exact artifact. Copy
`mobile-parity/fixtures/release-device-evidence.example.json` into ignored results,
replace placeholders and record actual outcomes. Do not mark unexecuted checks
true. Device records bind the commit and APK/IPA SHA-256, physical device, OS and
execution time. They require successful/cancelled/unavailable authentication,
background privacy, cold/warm app links and camera checks. Browser records bind
the deployed commit, origin and browser and require real installation, offline
launch and service-worker update. Evidence expires after 30 days.

```sh
npm run release:test
npm run release:check -- --base-url https://tcger.ahmadjalil.com \
  --android-apk mobile-parity/results/release/android/TCGer.apk \
  --ios-ipa <exported-ipa> --device-evidence <recorded-evidence.json>
```

The checker verifies the APK using `apksigner`, including certificate identity;
it verifies the exported iOS app using `codesign` and checks distribution
entitlements. Hosted checks cover association content, PWA assets and canonical
redirects. `mobile-parity/results/release/readiness.json` retains each outcome.
Every check must pass for `ready: true`. `--allow-pending` writes a useful audit
without claiming readiness. UI/API parity reports remain separate evidence.

The OS authentication policies follow Apple's
[device-owner authentication](https://developer.apple.com/documentation/localauthentication/lapolicy/deviceownerauthentication)
and Android's [biometric authentication guidance](https://developer.android.com/identity/sign-in/biometric-auth).
Android 26–29 uses system device credentials; Android 30+ permits strong biometrics
or device credentials. Cancellation or unavailable authentication keeps the app
locked. Consult Android's [domain verification guidance](https://developer.android.com/training/app-links/verify-applinks)
when checking the installed APK after deploying its public association.
