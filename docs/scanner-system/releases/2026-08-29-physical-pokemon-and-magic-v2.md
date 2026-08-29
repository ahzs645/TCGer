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

The release metadata is upgraded deterministically to the visual-family contract
without changing vector row order. Every Pokémon family currently contains one
physical printing. Promotion remains gated on the full labeled reference-photo
replay and atomic iOS, Android, and browser publication.

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
tests pass. Magic remains unpublished until the browser image-level replay and
coordinated client/package compatibility checks are complete.

## Publication invariant

Publish immutable objects first and the platform manifest last. Never expose a
manifest that references missing objects, mix candidate versions across
platforms, or promote Pokémon artifacts containing a Pocket row.
