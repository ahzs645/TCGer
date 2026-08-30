# Real-camera recognition findings

**Investigation date:** 2026-08-29

**Primary subject:** Magic visual-family v2

**Reference session:** `scan-session-20260829-200235`

This document records what was observed, how it was diagnosed, what is a model
failure versus a resolver failure, and what should be reproduced after each
change. It is intentionally separate from the production release record: a
release can be correctly packaged and still reveal new camera-domain limits.

## Session result

The session contains 27 frames:

- 13 were accepted by the app.
- 14 abstained.
- Manual review found all 13 accepted card names correct.
- There were no known wrong accepts.

The abstentions divide into three actionable groups.

| Group | Frames | Interpretation |
|---|---:|---|
| Correct title and visual-family candidate, blocked by printing ambiguity | 9 | Resolver ordering/metadata-expansion issue |
| Correct family on the shortlist, exact printing present in alternatives | 1 | Exact-print evidence searches only representative rows |
| Correct family poorly ranked or absent from practical shortlist | 4 | Genuine camera-domain embedding failure |

The nine `titlePrintingUnresolved` cases included Rage into the Valley, Nivix
Guildmage, Jwar Isle Refuge, Corpse Appraiser, two Racers' Ring frames, Broken
Wings, Jungle Hollow, and Riveteers Charm.

Forsaken Sanctuary was the tenth policy case. The correct visual family was
rank 8 with cosine similarity 0.55779. OCR read its title and footer collector
number `273`, and the family's alternatives include the matching `SOI #273`
printing. The runtime checked only the representative `C18 #247`, so it failed
to use evidence already present in the package.

The four model failures were two frames each of Bilbo's Deadly Slice and Stone
Quarry.

## What already worked

Family retrieval and newest-print behavior worked when the candidate reached
the resolver:

- A physical Commander Anthology II Darksteel Ingot resolved to the newer OTC
  same-art printing in quick mode.
- A Streets of New Capenna Riveteers Charm resolved to the newer M3C same-art
  printing.

That is the intended quick-mode behavior. The user can later change the exact
printing without paying the storage or ambiguity cost of duplicate vectors.

## Resolver defect found during diagnosis

The relevant iOS path is
`mobile-apps/ios/TCGer/TCGer/CardScanner/BoardCardEmbeddingScannerStrategy.swift`.
The flow at the time of diagnosis applied a title-printing ambiguity guard before
`CardPrintingResolver.resolve`.

The guard asked whether multiple rows in the ranked vector results shared a
family. That test made sense for an exact-print index. In the family index,
however, there is deliberately one ranked vector row per family. Its additional
printings are stored in `primary.printingAlternatives`, so the guard concludes
that a multi-print family has only one printing.

The second limitation was similar: collector-number matching inspected primary
candidate identities but did not expand their printing alternatives. It could
therefore read an exact collector number correctly and still miss the matching
printing in metadata.

### Resolver order derived from the diagnosis

1. Retrieve and calibrate visual families.
2. Expand the leading family's represented printings.
3. Match title, collector number, set, and treatment evidence across those
   printings.
4. In quick mode, permit strong title plus a plausible visual family to proceed,
   then choose the newest remaining printing.
5. In precise mode, return an exact printing only when evidence distinguishes
   it; otherwise present the family alternatives to the user.
6. Abstain on weak visual evidence, conflicting evidence, or an unresolved
   family—not merely because several same-art printings exist.

This order needed consistent iOS, Android, and web behavior and shared fixtures.

It was subsequently implemented as the platform-neutral
[`tcger-scanner-acceptance-policy-v1`](game-acceptance-policy.md) contract.
Family-scoped footer matching and title/visual-agreement rescue are no longer
Magic-only branches. The measured result is recorded below and in the
[Magic visual-first replay record](mtg-visual-first-policy-2026-08-29.md).

## Model investigation

### Artifacts used

The analysis used the release candidate's Android/browser ONNX encoder and the
same packed int8 family index used by the runtime:

- `.artifacts/scanner-release/magic-visual-style-v2-5c27e506-r2/android/card-embeddings-arcface-fp32.onnx`
- `.artifacts/scanner-release/magic-visual-style-v2-5c27e506-r2/runtime-test/CardsIndexVectors-arcface.bin`
- the corresponding runtime-test metadata in that candidate directory

These `.artifacts` paths are local release evidence and are not source files.
The immutable release hashes in the release record are the durable identity of
the tested artifacts.

### Rectification

Each phone frame's detected card quadrilateral was read from `evidence.json`.
Vision coordinates use a bottom-left normalized origin, so the points were
converted to image coordinates and used for a perspective transform into a
720-by-1000 card crop.

This reconstruction may not be byte-identical to the app's Core Image path, but
it is visually consistent with the detected card and its conclusions agree
with the on-device candidate evidence.

### Encoder preprocessing

The replay mirrored training/export preprocessing:

1. Resize the shortest edge to 256 pixels, preserving aspect ratio and rounding
   the other edge upward.
2. Bicubic resample.
3. Center-crop 224 by 224.
4. Convert RGB values to `[0, 1]` in channel-first order.
5. Let the ONNX graph perform its embedded ImageNet normalization.
6. L2-normalize the resulting 384-dimensional embedding.

The replay was run with `onnxruntime-node` and `sharp`, avoiding a second model
implementation.

### Packed-index replay

The binary header supplies row count and dimension. Each int8 row was decoded,
normalized with its stored row norm, and compared to the query with cosine
similarity across all 67,849 family vectors. Row positions were joined to the
metadata without reordering.

Catalog-image self-retrieval was tested first. This separates a broken index or
family mapping from a camera-generalization problem.

| Query | Correct-family rank | Cosine similarity | Meaning |
|---|---:|---:|---|
| Bilbo catalog representative | 1 | 0.99899 | Family/index alignment is correct |
| Stone Quarry CMR representative | 1 | 0.99902 | Family/index alignment is correct |
| Stone Quarry C19 canonical image | 1, same CMR family | 0.88941 | Same-art family mapping works across reprint |
| Forsaken Sanctuary SOI canonical image | 1, same C18 family | 0.88134 | Same-art family mapping works across reprint |
| Bilbo phone frame 3 | 12 | 0.48039 | Weakly present, below evidence threshold and sometimes shortlist size |
| Bilbo phone frame 4 | 8 | 0.48413 | Weakly present, below evidence threshold |
| Stone Quarry phone frame 8 | 36,494 | -0.00764 | Catastrophic camera-domain embedding failure |
| Stone Quarry phone frame 9 | 15,714 | 0.07285 | Catastrophic camera-domain embedding failure |
| Forsaken Sanctuary phone frame 12 | 8 | 0.55779 | Plausible family; exact OCR evidence should rescue |

Stone Quarry's unrelated leading candidates scored around 0.94 to 0.96. A
threshold change cannot make the correct family outrank them. Bilbo also needs
better retrieval because its correct family is not top one and scores below the
minimum evidence level.

## Root cause

The model was trained on one prepared catalog representative per family, with
three synthetic views per identity for twelve epochs. Its useful augmentation
already includes:

- random perspective distortion, up to scale 0.35 with probability 0.85;
- brightness from 0.55 to 1.45;
- color from 0.6 to 1.4;
- contrast from 0.7 to 1.3;
- Gaussian blur or sharpening; and
- Gaussian noise.

This creates many synthetic views, but every positive still derives from a
clean catalog file. It does not model enough of the residual phone-to-print
domain:

- white balance and color tint;
- uneven lighting, shadows, glare, and sleeve reflections;
- printer halftone and moiré;
- sensor, demosaic, and chroma noise;
- camera sharpening and ringing;
- JPEG recompression;
- lens falloff and motion blur; and
- imperfect rectification and crop boundaries.

The catalog and rectified phone crops can look almost identical to a person
while landing far apart in embedding space. The model has learned catalog-
domain cues that are not sufficiently invariant to real printed captures.

The 0.9925 Magic Recall@1 result is still meaningful: it is family-disjoint and
tests synthetic/catalog-domain generalization. It is not a real-camera metric
and cannot approve a release by itself.

## Failure taxonomy

Future reports should label each miss with one primary cause:

- **Detection/rectification:** wrong quad, clipped card, severe rotation, or
  unresolved multiple-card layout.
- **Visual retrieval:** correct family rank/similarity is insufficient before
  OCR or policy.
- **Evidence extraction:** OCR or set/collector reading is absent or wrong.
- **Resolver/policy:** correct visual/evidence candidates exist, but ordering or
  ambiguity rules abstain or choose incorrectly.
- **Catalog/family data:** missing printing, incorrect family membership, or
  stale source catalog.
- **Open-set rejection:** a non-card or unsupported card is accepted.
- **Platform divergence:** Core ML and ONNX pipelines disagree beyond the
  declared tolerance.

This prevents an OCR fix from being credited for a model problem, or a model
retrain from hiding a metadata bug.

## Why OCR remains secondary

OCR helps in three bounded cases:

1. confirming a plausible visual-family candidate with an unambiguous title;
2. selecting an exact printing through collector number or set evidence; and
3. resolving visually repetitive frames, especially lands and shared artwork,
   when the visual candidate is already credible.

It should not establish identity from the full catalog with weak or unrelated
visual evidence. OCR can be disabled in client settings for controlled A/B
testing, and that preference should remain persistent. Release reports should
publish visual-only and visual-plus-OCR results separately.

## Reproduction checklist

For another session or model candidate:

1. Ingest the source session without changing its bytes.
2. Add reviewed ground-truth labels outside the session export.
3. Run the app's full replay and record accepted/correct/wrong/abstained.
4. For every miss, preserve the top candidates, similarities, margins, OCR
   tokens, detector quad, and final reason code.
5. Reconstruct the rectified crop from evidence.
6. Verify catalog self-retrieval for the expected family.
7. Replay the exact exported encoder and entire packed index.
8. Record correct-family rank and similarity before any resolver logic.
9. Classify the failure using the taxonomy above.
10. Visually inspect the original frame, rectified crop, expected catalog image,
    and leading wrong candidates together.

Do targeted catalog-image acquisition for the expected and leading candidates
when necessary. Full-catalog image downloads are not required for this
diagnostic.

The ad-hoc ONNX replay proved the issue, but it should become a maintained
repository script before it is used as a recurring release gate. That script
must consume the exported manifest, rather than embedding artifact paths or
preprocessing constants independently.

## Measured policy-only improvement

After the family-aware resolver, family-scoped footer evidence, and visual/title
agreement policy were implemented, the August 29 session improved from 13/27
to 21/27 correct with zero wrong accepts. Across it and the 22-frame August 27
Magic session, the policy-driven build scored 36/49 correct, zero wrong, and 13
abstentions. The legacy policy scored 28/49 correct and zero wrong; the new
policy lost no previously correct accepts.

Bilbo's Deadly Slice and Stone Quarry should remain abstentions until the model
or representation improves. Lowering thresholds to accept them would weaken
open-set safety and would not repair Stone Quarry's ranking.

The other remaining abstentions include Rage into the Valley, where title and
visual leader disagree, and a Simulator Jungle Hollow crop that scores below
the 0.70 Magic strong-accept point. These are not evidence that the resolver
fix failed.
