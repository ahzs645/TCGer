# Scanner release status: physical Pokémon and Magic visual-family v2

Date: 2026-08-29

## Pokémon physical-only v2

- Candidate: `physical-v2-107fe33b`
- Physical cards: 19,507
- Pokémon TCG Pocket rows: 0
- Held-out recall@1: 0.9784
- Held-out recall@5: 0.9968
- Android/browser ONNX export parity: cosine similarity 1.0; maximum absolute
  difference 0.00000198
- macOS Core ML compilation: passed
- Production-paired replay (52 labels): 31 correct, 0 wrong, 21 abstentions
- Current production replay (same labels): 28 correct, 1 wrong, 23 abstentions
- Full replay (76 labels): 47 correct, 0 wrong, 29 abstentions

The release metadata is upgraded deterministically to the visual-family contract
without changing vector row order. Every Pokémon family currently contains one
physical printing. The full replay found six previously accepted frames that now
abstain; five are outside the curated label table and one is a clear Regigigas
DP30. The paired comparison nevertheless gains five correct accepts, loses two
(one is a known Simulator divergence), and removes the production wrong accept.
No threshold was loosened.

Pokémon physical-only v2 was promoted atomically on 2026-08-29. Live iOS and
Android manifests are version 2 with 19,507 rows; the browser index is version 4
with 19,507 rows. Post-publication downloads reproduce the expected metadata and
browser-index SHA-256 digests and contain zero Pocket rows. Magic and Yu-Gi-Oh!
browser pointers were preserved unchanged during the browser manifest update.

## Magic visual-family v2

- Candidate: `visual-style-v2-5c27e506-r2`
- Visual families: 67,849
- Exact printings represented: 109,546
- Held-out recall@1: 0.9925
- Held-out recall@5: 0.9952
- Production iOS reference replay: 15/22 correct, 0 wrong, 7 abstentions
- Recorded v1 baseline: 7/22 correct, 5 wrong, 10 abstentions

The acceptance policy uses printed titles as bounded independent evidence. An
exact globally unique title can confirm a 0.55-or-higher visual neighbor. A
single-character OCR repair is allowed only from a 0.75-or-higher visual
shortlist and only when the result is unambiguous. Weak or conflicting evidence
abstains.

The native iOS reference gate passes, and equivalent Android and browser policy
tests pass. The Magic browser package was promoted atomically on 2026-08-29 as
version 2 for controlled online testing. Its CDN-retrieved index reproduces the
expected SHA-256 digest and contains 67,849 visual families representing all
109,546 printings. The public Pokémon and Yu-Gi-Oh! object pointers remained
unchanged during that manifest update.

The family-aware browser artifact is generated reproducibly with
`npm run scanner:build-browser-index`. It contains 67,849 vectors and expands
to all 109,546 printings as metadata. R2 gzip delivery is 31.9 MB for the index,
plus the 14.3 MB encoder; the previous v1 index was roughly 40.0 MB compressed.

Native Magic v2 was promoted on 2026-08-29 after the family-aware clients,
candidate packages, and production-v1-to-v2 upgrade paths passed their release
gates. The iOS production manifest is format 3/version 2 and the Android
production manifest is format 2/version 2. Both expose 67,849 visual families
representing 109,546 exact printings. The immutable candidates remain staged at
`ios/scan-assets-candidate-v2` and `android/scan-assets-candidate-v2` for release
diagnostics.

Before promotion, both clients downloaded production v1, detected the staged
update, verified every content digest, decoded the 67,849-row index, activated
v2 atomically, and retained no inactive v1 directory. iOS also compiled the
downloaded Core ML package. Publication then uploaded the content-addressed
production objects first and each platform manifest last.

Post-publication CDN downloads reproduce every declared SHA-256 digest and byte
count. iOS totals 118,044,412 installed bytes; Android totals 125,091,531 bytes.
The shared vectors digest is
`acfbead865eb1e7cc17bc8ff532e0e2bea20645e916f8122810f87b1be30878c`,
and the shared metadata digest is
`49e720b582587ebe8017b434b1bba6ec9cb8e4dafef3484658cf6d8139007c2f`.
The Android ONNX digest is
`9c1b7c94e3f1a83308d0a4706a4b855dbf8986e43c6a97e93a3e4b7c83cb4195`.
Cloudflare compresses the large JSON metadata in transit; the manifest totals
deliberately describe verified installed bytes rather than wire transfer size.

The release-gate tests are opt-in and reproducible. Build iOS with
`TCGER_SCANNER_ASSET_BASE_URL` set to the iOS candidate base, or set
`TCGER_IOS_SCANNER_CANDIDATE_BASE_URL`. Run the Android test with
`TCGER_ANDROID_SCANNER_CANDIDATE_BASE_URL`; app builds can select a candidate
base with `-PtcgerScannerAssetBaseUrl=...`. Normal CI skips external candidate
downloads but keeps deterministic manifest, index, rollback, and inactive-version
cleanup coverage.

The authoritative three-platform parity run for the promotion commits passed on
2026-08-29: contract, web, Android, iOS, and report jobs were all successful in
GitHub Actions run `33287148160`. The superseded v1 manifests are retained beside
this note as rollback pointers: [iOS](rollback/2026-08-29-magic-v1-ios-manifest.json)
and [Android](rollback/2026-08-29-magic-v1-android-manifest.json). Their referenced
immutable objects remain in R2 and were rechecked after promotion.

## Publication invariant

Publish immutable objects first and the platform manifest last. Never expose a
manifest that references missing objects, mix candidate versions across
platforms, or promote Pokémon artifacts containing a Pocket row.
