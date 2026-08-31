# Yu-Gi-Oh Duel/Table and Deck Scan — 2026-08-30

## Decision

Ship the useful seams from the DRAW2 investigation, not DRAW2 itself.

- Ordinary single-card scanning keeps the existing TCGer localizer.
- Browser Duel / Table Scan exposes TCGer's existing YOLO11 OBB path for
  rotated, steep-angle, and multi-card video. The path already returns corner
  quads, crops at source resolution, de-rotates the card, and attempts
  perspective refinement only after a plain crop fails acceptance.
- Optional Deck Scan restricts Yu-Gi-Oh recognition to the selected deck's
  passcodes/artworks. It keeps the normal score and margin gates and returns no
  candidate when the deck and installed index do not intersect.
- DRAW2 remains an external benchmark challenger. Its repository is AGPL-3.0,
  so neither its source nor weight was copied into TCGer.

This also fits the measured evidence: TCGer's current localizer was stronger
on the single-card TCGX set, while DRAW2's OBB was materially stronger on
multi-card spreads. That supports a challenger for Duel/Table recovery, not a
global replacement.

## Product behavior

The browser scan page now calls the multi-card surface **Duel / Table Scan**
and describes its oriented-box behavior. Yu-Gi-Oh users who are signed in can
select **Full Yu-Gi-Oh catalog** or **Deck Scan · _deck name_**. The deck UI
states that:

- the gallery is restricted;
- the recognizer can still abstain; and
- deck-scoped results are not full-catalog accuracy.

The iOS scanner context carries the same optional `CardScanDeckScope`. The
metadata store maps representative ids, exact-printing ids, and nested
printing ids to vector rows. The existing ANN layer already performs exact
cosine search when `allowedIndices` is supplied, so a small deck cannot lose a
candidate to an approximate full-catalog shortlist.

## Acceptance evidence

The corpus contract lives at
`tools/camera-corpus/yugioh-acceptance.schema.json`; the validator/adapter is
`tools/camera-corpus/yugioh_acceptance.py`. It requires at least one frame in
each of these slices before a run is valid:

1. `single_handheld` — sleeves, foil, glare, and blur;
2. `steep_playmat` — steep and rotated face-up cards; and
3. `duel_field` — multiple cards, face-down cards, and partial occlusion.

The benchmark now reports correct accept, wrong accept, abstain, and correct
reject for each localizer and slice. `deckExternalIds` enables a separate
restricted-gallery run over the same pixels. Face-down/rejection records have
no fake catalog label, so an asserted identity is counted as a wrong accept.
Each duel-field card is a separate instance record with a ground-truth pixel
quad; repeated records can share one image, and each localizer is paired to
the prediction with the highest overlap for that target card.

No physical Yu-Gi-Oh acceptance corpus was present in the repository on
2026-08-30. Unit tests, builds, and the existing Magic/Pokémon replay evidence
can verify implementation and regression behavior, but they cannot establish
Yu-Gi-Oh field accuracy. The acceptance gate remains pending until real
Yu-Gi-Oh captures populate the manifest and both TCGer and DRAW2 are run over
the same frames.
