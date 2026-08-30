# Scanner current state and direction

**Status date:** 2026-08-29

This is the concise source of truth for what is live, what the recent scanner
work established, and the architecture TCGer is moving toward. Detailed
release hashes and rollback pointers remain in
[the 2026-08-29 release record](releases/2026-08-29-physical-pokemon-and-magic-v2.md).

## Executive summary

TCGer now has downloadable per-game offline scanners for Pokémon, Magic: The
Gathering, and Yu-Gi-Oh! on iOS, Android, and web. The common architecture is:

1. A game catalog supplies exact-print records and images.
2. Closely matching printings may be grouped into recognition families.
3. One embedding vector is stored per recognition family.
4. The visual model proposes a family; title, collector number, set, and other
   bounded evidence may refine the exact printing.
5. Quick mode chooses the newest represented printing when the image cannot
   distinguish same-art reprints. Precise mode asks for, or verifies, the
   printing.
6. Low-confidence or contradictory evidence abstains instead of guessing.

The model is responsible for visual identity. OCR is supporting evidence, not
a substitute for recognition. The package format keeps family vectors separate
from lightweight printing alternatives, so adding reprints does not require a
new vector when their visible design is unchanged.

## Production state

| Game | Live recognition unit | Live scope | Current status |
|---|---:|---:|---|
| Pokémon | 19,507 singleton physical-card families | 19,507 physical printings | Physical-only v2 is live on iOS, Android, and web; zero Pocket rows |
| Magic | 67,849 visual families | 109,546 exact printings | Visual-family v2 is live on iOS, Android, and web |
| Yu-Gi-Oh! | Exact catalog identities in the existing release | Existing production catalog | Live and unchanged by the Pokémon and Magic promotions |

### Pokémon physical-only v2

- Release: `physical-v2-107fe33b`
- Architecture: FastViT-T8 ArcFace, 384-dimensional normalized embeddings
- Training identities: 17,502
- Held-out identities: 2,005
- Recall@1: 0.9784
- Recall@5: 0.9968
- Full real-reference replay: 47 correct, 0 wrong, 29 abstentions from 76
  labeled frames
- Paired production replay: 31 correct, 0 wrong, 21 abstentions, compared with
  28 correct, 1 wrong, and 23 abstentions for the previous production release
- Live native manifests: version 2, 19,507 rows
- Live browser index: version 4, 19,507 rows

Pokémon TCG Pocket cards are intentionally excluded from physical-scanner
ingestion, training metadata, evaluation, and all platform indexes. They may
remain available to collection/catalog features as a separate format, but a
physical scanner build has a zero-Pocket invariant.

The Pokémon metadata implements the family-aware runtime contract, but all
current families are singletons. TCGer does not yet have an authoritative
Pokémon equivalent of Scryfall's `illustration_id`, so it does not silently
collapse possible reprints. A reviewed same-art overlay can be added later
using the process in [Artwork-family matching](artwork-family-matching.md).

### Magic visual-family v2

- Release: `visual-style-v2-5c27e506-r2`
- Architecture: FastViT-T8 ArcFace, 384-dimensional normalized embeddings
- Recognition families: 67,849
- Exact printings represented: 109,546
- Recall@1: 0.9925
- Recall@5: 0.9952
- Earlier 22-frame reference gate: 15 correct, 0 wrong, 7 abstentions; the v1
  baseline was 7 correct, 5 wrong, 10 abstentions
- Live native manifests: iOS format 3/version 2 and Android format 2/version 2
- Live browser package: version 2
- Browser transfer: approximately 31.9 MB for the gzip-compressed index plus
  14.3 MB for the encoder

Magic uses one vector for each distinct visual family and keeps its represented
printings in metadata. This is why a scan of an older same-art printing can
return the newest printing by default without storing duplicate vectors. It
also preserves all exact printings for precise selection.

The most recent 27-frame phone session exposed two different kinds of work:

- resolver/evidence ordering prevented several correct visual-family results
  from being accepted or refined; this has now been corrected by the
  declarative visual-first acceptance policy; and
- the encoder genuinely failed on two cards under real camera conditions.

The resulting two-session Magic replay improved from 28/49 to 36/49 correct,
with zero wrong accepts and zero lost accepts. Those findings do not invalidate
the family data or packed index. They show that catalog/synthetic recall is not
sufficient as a release gate. See
[Real-camera recognition findings](real-camera-recognition-findings-2026-08-29.md).

## Declarative acceptance policy

Acceptance behavior is now a per-game data contract,
`tcger-scanner-acceptance-policy-v1`, rather than client code branching on the
game name. Its source of truth is `tools/scanner-acceptance-policies.json`.
Publishers embed a game's policy into iOS/Android manifests and browser index
thresholds.

Clients resolve environment replay overrides, then a valid installed-manifest
policy, then a built-in game profile, then the conservative default. An invalid
declared policy falls back to the built-in profile instead of activating bad
thresholds. A future game therefore works under `default` without client code
and can move to a calibrated operating point by republishing its manifest.

Magic now uses a 0.70 strong-accept score, no title gate for single-card
captures, OCR as bounded verifier, family-scoped collector-number matching, and
title/visual-agreement rescue. Pokémon's 76-label regression produced 51
correct and zero wrong accepts, versus the 47-correct release gate. Android's
policy implementation and unit coverage match the contract, but its newly
enabled manual OCR rescue for Pokémon and Yu-Gi-Oh! still needs real replay
validation.

The live R2 native manifests have not yet been republished with the optional
policy block. Current clients use built-in profiles with identical values, and
old clients ignore the field. The pending publication is manifest-only and is
documented in
[the republish runbook](releases/2026-08-29-acceptance-policy-manifest-republish.md).

## Runtime behavior we are converging on

### Quick mode

Quick mode answers the common collection workflow:

1. Retrieve the best visual family.
2. Use bounded OCR or set/collector evidence when it is reliable.
3. If several same-art printings remain, choose the newest eligible printing.
4. Keep every represented printing available through the result editor.
5. Abstain if the family itself is uncertain or evidence conflicts.

The newest-print rule is a presentation default, not a claim that the physical
card is that printing.

### Precise mode

Precise mode answers inventory workflows where set and collector identity
matter:

1. Retrieve the visual family.
2. Search all printing alternatives, not only the family's representative.
3. Resolve an exact printing only with independent evidence such as collector
   number, set code/symbol, treatment, or an unambiguous title where applicable.
4. If several printings remain visually indistinguishable, ask the user to
   select one.

### Automatic game selection

Installed games are data-driven scanner packages, not a hard-coded prompt for
one game. The scanner may run installed game encoders and merge calibrated
candidates. If the selected game's package is absent, the app prompts to
install that package at scan time. Unknown-game manifests may introduce
catalogs and declarative filters, but cannot introduce executable code; scanner
and pack runtimes require compatible, trusted adapters.

## What the recent investigation changed

The following conclusions now guide all games:

- One vector per actual visible design is the right storage unit. Same-art,
  same-layout reprints belong in metadata; different illustrations or layouts
  remain distinct families.
- Exact-print selection is a resolver problem after family retrieval. It should
  not inflate the embedding gallery with visually indistinguishable rows.
- OCR is most useful for rescuing a plausible visual shortlist or selecting a
  printing inside a family. It must not promote an unrelated weak candidate.
- Threshold changes cannot fix ranking failures. If the correct card is rank 8,
  rank 12, or thousands of positions down, lowering acceptance thresholds only
  increases false matches.
- Synthetic catalog evaluation measures catalog-domain generalization. It does
  not prove camera-domain robustness.
- Real captures used for final evaluation must remain frozen and out of
  training. Training needs a separate, consented, provenance-tracked camera
  corpus.
- Release gates must report correct accepts, wrong accepts, and abstentions—not
  recall alone.

## Next implementation priorities

1. Republish the iOS and Android Magic/Pokémon manifests with their policy
   blocks after verifying the eight artifact hashes and four dry-run byte
   totals. Do not rebuild or upload immutable objects.
2. Replay Android's policy-gated manual OCR rescue for Pokémon and Yu-Gi-Oh!.
3. Add the visual leader name/score to scan diagnostics so title-agreement
   decisions are auditable from exported evidence.
4. Build the cross-platform camera-corpus manifest and ingestion validator.
5. Collect a deliberately varied Magic training corpus on iOS and Android,
   while retaining existing reference sessions only for evaluation.
6. Train and compare catalog-only, camera-positive, hard-negative, and dual-
   region candidates.
7. Require full camera-session and open-set replay before another Magic model
   promotion.
8. Apply the same framework to Pokémon and Yu-Gi-Oh!, but replace the working
   Pokémon production model only if an A/B candidate improves camera coverage
   without increasing wrong accepts.

## Deliberate non-goals

- Do not lower thresholds to conceal a retrieval/ranking failure.
- Do not train on the session used to approve the release.
- Do not treat OCR as the primary card recognizer.
- Do not collapse Pokémon printings without a reviewed, reproducible family
  mapping.
- Do not download an entire public image catalog merely to determine whether a
  source changed. Check release metadata and catalog deltas first, then acquire
  only the images required for a pinned training release.
- Do not publish mutable manifests before their content-addressed objects.

## Source-of-truth order

When status differs between notes, use:

1. Immutable training/evaluation artifacts and their recorded hashes.
2. CDN-retrieved R2 artifacts plus the live mutable platform manifest.
3. The consuming code and its contract tests.
4. The dated release record.
5. This current-state document.
6. Older audits and project handoffs, which are historical snapshots.
