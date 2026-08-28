# Two-stage recognition and exact-print resolution

## Decision

TCGer treats visual recognition and exact-print identification as separate
tasks. The encoder retrieves a small candidate set by
`recognitionFamilyId`; a verifier then uses printed evidence to select an
`exactPrintingId`. If the available evidence cannot distinguish printings, the
scanner returns the family/candidates for Review instead of inventing an exact
printing.

## User modes

The setting is intentionally about ambiguity policy, not model choice:

| Mode | If printed evidence verifies a printing | If one printing is possible | If the artwork family has multiple unresolved printings |
|---|---|---|---|
| **Quick Scan** (default) | Use the verified printing | Use it | Choose the newest compatible physical printing by `releaseDate`, with `exactPrintingId` as the deterministic tie-breaker |
| **Exact Printing** | Use the verified printing | Use it | Require the user to choose; never add a visual top-1 automatically |

Every result records one of `verified`, `single_printing`, `latest_fallback`,
`user_selected`, or `unresolved`. A verified collector number/set symbol always
overrides the Quick Scan fallback. “Newest” is never inferred from a set-code
sort; it requires the artifact's ISO `releaseDate`. Language, physical/digital
format, face, and treatment eligibility are applied before this decision.

The policy and persisted setting are implemented in iOS, Android, and web.
Android blocks automatic session insertion for an unresolved Exact Printing
result; iOS uses its existing Choose Match review; the browser annotates the
family as requiring selection. An older artifact without family/date fields
continues to behave as a single-printing artifact rather than merging cards by
name.

This is a platform-neutral data contract. iOS already has the strongest
runtime implementation (visual top-K plus title and collector-number evidence),
and Android/web can consume the same metadata fields as their verifiers are
hardened. A manifest can supply data and a compatible model, but cannot inject
executable verification behavior.

## Identity contract

| Field | Purpose |
|---|---|
| `visualIdentityId` | One concrete catalog image or visible face; remains a distinct gallery row |
| `recognitionFamilyId` | Visual class used by ArcFace and deterministic train/evaluation partitioning |
| `exactPrintingId` | Collection identity selected only after second-stage evidence |
| `annIndex` | Ephemeral row position in one exported index |

Multiple exact printings may share one recognition family. Their metadata and
vectors remain separate so the verifier can return the correct catalog object;
the ArcFace head does not receive contradictory labels for the same artwork.

## Game policies

| Game | Visual family | Exact-print evidence | Required abstention cases |
|---|---|---|---|
| Pokémon | Reviewed artwork-family map produced by the audit described in [Artwork-family matching](artwork-family-matching.md); exact printing until that map exists | Name, set, collector number | Missing/unreadable set or number when variants collide; every TCG Pocket row is outside the physical-scanner scope |
| Magic | Scryfall `illustration_id`, falling back to visible printing face | Title, set code/symbol, collector number, face, frame and treatment | Same-art reprints, The List/original pairs, basic lands, tokens, treatments, or unreadable footer evidence |
| Yu-Gi-Oh! | Artwork ID | Title, passcode and printed set code when the source enumerates printings | One artwork/passcode mapped to multiple products without readable set evidence |
| Future game | Manifest/catalog-declared stable visual family | Declarative fields supported by a reviewed runtime adapter | Any unresolved candidate group or unsupported verifier evidence |

MTG generic Art Series reverse/checklist faces are excluded from the scanner
gallery because they identify no front. Catalog records may still retain them.
Content-addressed storage may deduplicate identical bytes without collapsing
their legitimate catalog relationships.

## Training and evaluation

The durable image library hashes `recognitionFamilyId` into a 90/5/5
train/validation/test partition. Every printing and sample in a family stays in
one partition. The trainer:

1. trains only rows in the train partition;
2. maps all train rows in one family to one ArcFace class;
3. queries held-out families for primary Recall@1/5;
4. separately reports exact catalog-row retrieval as a diagnostic;
5. exports every eligible gallery row and its exact-print metadata.

Catalog augmentation is not real-camera evaluation. Promotion additionally
requires held-out phone captures, exact-print labels, confirmed precision,
coverage, false-accept rate, and per-game operating-point calibration.

## Physical Pokémon profile

Scanner builds default to `--pokemon-profile physical`. Ingestion excludes
`series=tcgp`, `format=pocket`, and `/tcgp/` image paths. The normalized
builder, image-library builder, trainer, and iOS/Android/web publishers all
fail closed if a Pocket row reaches a physical scanner artifact. The general
collection catalog may use `--pokemon-profile all`; that output is not valid
trainer or scanner input.

The corrected snapshot contains 19,507 physical rows and excludes 2,321
Pocket-only rows from the prior 21,828-row index.

## Public design evidence

The approach is consistent with public MTG scanners that combine visual or OCR
candidate generation with printed evidence rather than forcing one image-only
class per printing:

- [MTG Card Analyzer](https://github.com/dills122/MTG-Card-Analyzer) combines
  OCR/fuzzy name matching with perceptual card or set-symbol hashes and exposes
  exact-print, fingerprint, layout, and abstention research.
- [Mimir MTG Visual Cataloguer](https://github.com/JovinJovinsson/Mimir-MTG-Visual-Cataloguer)
  uses a Scryfall-derived visual catalogue and perceptual matching.
- [fortierq/mtgscan](https://github.com/fortierq/mtgscan) performs OCR followed
  by fuzzy lookup against an MTG dictionary.
- [GrimbiXcode/mtgscan](https://github.com/GrimbiXcode/mtgscan) targets the
  collector-number region and performs precise Scryfall lookups.

These projects are design evidence, not interchangeable benchmarks. TCGer’s
release decision remains based on its own frozen catalogs, artifacts, and
phone-capture suites.
