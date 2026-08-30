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

Native Magic remains unpublished. The currently released iOS and Android apps
do not accept the family-aware manifest formats, and the expanded native
printing metadata still produces 118.0 MB and 125.1 MB candidate downloads.
Before a native promotion, ship compatible client builds, replay the reference
set on those builds, and decide whether to split printing metadata from the
family vector package.

## Publication invariant

Publish immutable objects first and the platform manifest last. Never expose a
manifest that references missing objects, mix candidate versions across
platforms, or promote Pokémon artifacts containing a Pocket row.
