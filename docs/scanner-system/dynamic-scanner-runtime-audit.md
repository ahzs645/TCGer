# Dynamic scanner runtime audit

**Status:** design and safety gate, 2026-08-27

The existing `tcger-arcface-v1` models are data artifacts interpreted by code
already shipped in TCGer. They are not plug-in scripts, but ONNX and Core ML
files are still active, complex input to native inference runtimes. A matching
SHA-256 proves that bytes were not changed; it does not prove that a publisher
is trustworthy. Arbitrary direct-URL scanner activation therefore remains
disabled while verified catalog packages continue to work.

## Immediate built-in fixes

- Android Magic now dispatches to its installed ArcFace runtime instead of
  silently falling back to OCR.
- Browser automatic mode keeps all loaded per-game encoders and evaluates each
  distinct contract instead of retaining only the first one (Pokémon on a tie).
- Community scanners must initially use explicit-game mode. Automatic
  cross-game acceptance is a separate calibration/trust decision.

## Runtime contract required for activation

Add these fields to a scanner capability before enabling it:

- publisher namespace and signing/trust status;
- scanner manifest version and minimum compatible app/runtime version;
- exact platform, game ID, encoder family, model input/output names, shapes,
  element types, preprocessing contract, dimension, and maximum installed size;
- catalog identity revision and a metadata-to-catalog membership proof;
- model, metadata, vector, and optional gate assets with exact bytes/SHA-256;
- evaluated operating-point status and thresholds;
- dependencies and a coordinated removal policy.

Package thresholds may only make acceptance stricter. Clients apply
`max(packageMinimumSimilarity, applicationSafetyFloor)` and the corresponding
application floor for ambiguity margins. A package cannot weaken rejection.

## Activation transaction

1. Resolve only HTTPS URLs from a trusted capability manifest.
2. Stream each artifact into staging, hashing incrementally and aborting at its
   declared/hard byte limit.
3. Validate paths, media types, archive expansion, model contract, metadata,
   unique IDs, vector shape/count, and catalog membership.
4. Load the model in an isolated staging runtime and run a finite-output smoke
   inference with the declared input shape.
5. Preserve the current generation and atomically switch one active pointer.
6. On startup, revalidate the active generation; roll back if incomplete.
7. Removing or replacing the owning game package disables its runtime before
   deleting referenced artifacts.

## Platform work

### Web

Scanner-specific game IDs should become validated strings rather than the
product-wide hard-coded union. Build explicit choices from built-ins plus
trusted installed package scanners. Resolve the ONNX/index through the verified
capability, validate before IndexedDB activation, and skip built-in-only OCR or
layout refinements for games that do not declare them.

### Android

Android is already mostly string-keyed. Add `installFromPackage` to
`ScannerAssetStore`, remove the three-game restriction only for trusted
capabilities, discover installed generations, and merge compatible package
games into the explicit scanner selector. Keep the current staged runtime and
model-shape validation.

### iOS

iOS requires the largest refactor because `ScanMode`, metadata indexes, result
identity, and UI are enum-backed. Introduce a scanner-specific value type such
as `{id, name, accent, builtInGame?}`, query metadata by string game ID, and
preserve that ID through scan results and collection actions. Static Pokémon,
Magic, and Yu-Gi-Oh conveniences can remain while the coordinator enumerates
trusted installed runtimes dynamically.

## Required conformance/security tests

- Outer and nested byte/hash mismatches; wrong platform/runtime/game.
- Unsafe paths, URL credentials/fragments, redirect downgrade, and traversal.
- Manifest/model/index size ceilings and archive expansion limits.
- Duplicate/missing metadata rows, mixed games, missing catalog IDs, invalid
  dimensions, vector lengths, tensor names/shapes/types, zero/NaN outputs.
- Threshold-floor enforcement and explicit-game-only community routing.
- Failed-update rollback, same-version/different-bytes rejection, restart
  recovery, and coordinated package/scanner removal.
- A shared positive/negative fixture corpus exercised by TypeScript, Swift,
  and Kotlin.

## Recommended trust rollout

1. Official registry entries signed by TCGer.
2. Delegated publisher keys with expiry, rotation, and revocation.
3. Optional advanced trust-on-first-use for a user-owned publisher key, with a
   prominent model-execution warning and an explicit takeover prompt.
4. Unsigned direct URLs remain catalog/filter/declarative-pack only.
