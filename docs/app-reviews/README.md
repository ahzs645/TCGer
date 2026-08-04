# Third-party app reviews

This directory records what TCGer learns from inspecting other scanner apps.
The goal is to preserve reproducible engineering observations, not to copy
proprietary code or depend on private services.

## Reviews

| App        | Version       | Platform | Review                                                       | Main result                                                         |
| ---------- | ------------- | -------- | ------------------------------------------------------------ | ------------------------------------------------------------------- |
| Collectr   | 2.5.5 (735)   | Android  | [collectr-android-2.5.5.md](collectr-android-2.5.5.md)       | Server-side card matching; local crop and barcode decode            |
| ManaBox    | 4.1.11 (2687) | Android  | [manabox-android-4.1.11.md](manabox-android-4.1.11.md)       | Local OpenCV/HOG matching over a downloaded index                   |
| Purplemana | 0.3.65        | Android  | [purplemana-android-0.3.65.md](purplemana-android-0.3.65.md) | Learned corners, local perspective warp/pHash, remote hash matching |

Use the
[cross-app scanner comparison and experiment plan](../scanner-app-comparison-and-experiment-plan.md)
to compare transferable ideas on shared fixtures. Per-app reviews preserve
evidence; the comparison plan defines the controlled TCGer tests.

Start every new review from [template.md](template.md). Name it
`<app>-<platform>-<version>.md` so findings from different releases are not
silently mixed.

## Evidence labels

Use one of these labels for every important claim:

- **Verified:** directly supported by a recovered call path, manifest entry,
  packaged asset, or controlled runtime observation.
- **Inferred:** strongly suggested by evidence, but the implementation or
  server side was not directly visible.
- **Unknown:** not established by the available artifact or test setup.

Record negative findings as "not found," not "does not exist." Obfuscation,
AOT compilation, dynamic delivery, and server-side implementation can all hide
components from static inspection.

## Review rules

1. Record the exact artifact version, package ID, byte size, and SHA-256.
2. Keep static evidence separate from runtime/network observations.
3. Map the entire user-to-result flow before focusing on individual symbols.
4. Distinguish local processing from remote processing and note what user data
   crosses the network boundary.
5. Document request shape without publishing live credentials, session tokens,
   device identifiers, signing secrets, or reusable bypass instructions.
6. Treat third-party endpoints as private unless their owner publishes an API
   contract permitting outside use. Public reachability is not authorization.
7. Turn observations into product decisions: adopt, adapt, retain, defer, or
   reject. Link any TCGer implementation that resulted.
8. List uncertainties and the next test that could resolve each one.
9. Do not copy recovered proprietary source into TCGer. Reimplement general
   ideas from first principles and validate them against TCGer's requirements.

## Suggested tool sequence

For an Android artifact, a useful sequence is:

1. Hash and inventory the untouched APK/APKS/XAPK.
2. Decode resources and the manifest with Apktool.
3. Recover JVM/Kotlin code with JADX.
4. Inventory native libraries and packaged model/data assets.
5. If the app is Flutter AOT, inspect `libapp.so` with a compatible Dart AOT
   analysis tool; JADX will mostly expose plugin glue.
6. Search endpoints, content types, model extensions, scanner dependencies,
   camera configuration, result models, limits, and error strings.
7. Trace calls from the scanner UI through preprocessing, transport, response
   parsing, and confirmation.
8. Perform only minimal, authorized runtime checks and record them separately.

Store large decompilation output outside the documentation tree or keep it
untracked. The review should contain stable file/symbol references so another
engineer can reproduce the conclusion when the raw artifact is available.
