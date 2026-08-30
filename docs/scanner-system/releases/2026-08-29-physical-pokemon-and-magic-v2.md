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

Native Magic remains unpublished while compatible client builds move through
TestFlight and Android distribution. Immutable native candidates are staged at
`ios/scan-assets-candidate-v2` and `android/scan-assets-candidate-v2`; production
Magic pointers still resolve to version 1.

The staged candidates passed real production-v1-to-candidate-v2 installation
tests on 2026-08-29. Both clients downloaded production v1, detected the staged
update, verified every content digest, decoded the 67,849-row index, activated
v2 atomically, and retained no inactive v1 directory. iOS also compiled the
downloaded Core ML package. The candidate manifests declare 118.0 MB on iOS and
125.1 MB on Android as the verified installed byte totals. Cloudflare compresses
the large JSON metadata in transit; these totals are deliberately not estimates
of wire transfer size.

The release-gate tests are opt-in and reproducible. Build iOS with
`TCGER_SCANNER_ASSET_BASE_URL` set to the iOS candidate base, or set
`TCGER_IOS_SCANNER_CANDIDATE_BASE_URL`. Run the Android test with
`TCGER_ANDROID_SCANNER_CANDIDATE_BASE_URL`; app builds can select a candidate
base with `-PtcgerScannerAssetBaseUrl=...`. Normal CI skips external candidate
downloads but keeps deterministic manifest, index, rollback, and inactive-version
cleanup coverage.

The final promotion gate is distribution compatibility: confirm the iOS and
Android builds containing family-manifest support are available to testers,
then publish the already-validated immutable objects under the production
prefixes and write each platform's Magic manifest last. Re-run the production
v1-to-v2 update test against the public pointers immediately after promotion.

## Publication invariant

Publish immutable objects first and the platform manifest last. Never expose a
manifest that references missing objects, mix candidate versions across
platforms, or promote Pokémon artifacts containing a Pocket row.
