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
catalog identities remain separate so the verifier can return the correct
catalog object. The TrainingSetPlan selects one training reference per family;
metadata schema v3 exports one ANN vector row per family with a nested,
newest-first `printings` list. The ArcFace head therefore never receives
contradictory labels for visually identical reprints, and the runtime no
longer stores the same vector once per reprint.

## Game policies

| Game | Visual family | Exact-print evidence | Required abstention cases |
|---|---|---|---|
| Pokémon | Reviewed artwork-family map produced by the audit described in [Artwork-family matching](artwork-family-matching.md); exact printing until that map exists | Name, set, collector number | Missing/unreadable set or number when variants collide; every TCG Pocket row is outside the physical-scanner scope |
| Magic | Oracle/card identity + Scryfall `illustration_id` + visible-style fingerprint (face, layout, frame, border, language, full-art/frame effects, textless and watermark), falling back to visible printing face | Title, set code/symbol, collector number and face | Same-style reprints, The List/original pairs, basic lands, tokens, or unreadable footer evidence |
| Yu-Gi-Oh! | Artwork ID | Title, passcode and printed set code when the source enumerates printings | One artwork/passcode mapped to multiple products without readable set evidence |
| Future game | Manifest/catalog-declared stable visual family | Declarative fields supported by a reviewed runtime adapter | Any unresolved candidate group or unsupported verifier evidence |

MTG generic Art Series reverse/checklist faces are excluded from the scanner
gallery because they identify no front. Catalog records may still retain them.
Content-addressed storage may deduplicate identical bytes without collapsing
their legitimate catalog relationships.

Set code, collector number, release date, finish, promo status and security
stamp do not enter the MTG visual-family key. They remain exact-print evidence:
the identifying marks are too small or unreliable to justify duplicate ANN
vectors. A different illustration, frame, border, language, face, full-art or
other visible treatment retains its own family.

## Training and evaluation

The durable image library hashes `recognitionFamilyId` into a 90/5/5
train/validation/test partition. Every printing and sample in a family stays in
one partition. Before image materialization, the small platform-neutral
`tcger-training-set-plan-v1` dataset records the chosen references, source
catalog hashes, validated blob locations, and missing-image count. The trainer:

1. trains only rows in the train partition;
2. maps all train rows in one family to one ArcFace class;
3. queries held-out families for primary Recall@1/5;
4. separately reports exact catalog-row retrieval as a diagnostic;
5. expands the winning family's nested printings only after ANN retrieval for
   Quick Scan policy or Exact Printing review.

An ANN top-K list is not the print chooser: large families such as basic lands
can contain far more printings than the shortlist. Exact-print candidates must
be expanded from the catalog by `recognitionFamilyId` after visual retrieval.

## Visual-first acceptance (Magic, 2026-08-29)

A single-card Magic capture is accepted the same way a Pokémon capture is:
on visual evidence alone at its per-game operating point. The iOS ArcFace
runtime uses a Magic strong-accept of 0.70 (Pokémon keeps 0.65) with the
shared 0.05 ambiguity margin; the value was chosen from the two labeled MTG
sessions, where a plain-visual policy at 0.65 admitted three wrong accepts
between 0.64 and 0.69 and 0.70 admitted none. Title OCR is no longer a gate
on intentional captures (binder pages still require it); it is read only when
a crop cannot pass on its own score and then acts as bounded evidence:

- an exact, globally unique title confirms a 0.55-or-higher neighbour (unchanged);
- an exact title that names the same card the image ranked first, with no
  different-name rival inside the ambiguity margin, confirms the visual
  *family* from the same 0.55 floor — the printing is then resolved by the
  normal Quick Scan / Exact Printing policy instead of the former "0.85 or
  abstain" rule that blocked every reprinted card;
- a footer collector number is matched against every printing a family row
  represents, not only its representative, so a correct reading pins the
  exact printing (verified provenance) inside the family.

Simulator replay of the two labeled MTG sessions (49 frames, v2 index):
28 correct / 0 wrong / 21 abstain before, 36 / 0 / 13 after, with no
previously accepted frame lost. `SCANNER_MTG_LEGACY_POLICY=1` replays the
previous policy from the same build for A/B runs.

These rules are not Magic code: they are the fields of the per-game
[acceptance policy](game-acceptance-policy.md) (`strongAcceptanceScore`,
`ambiguityMargin`, `evidenceFloor`, `titleGate`, `uniqueTitleRescue`,
`titleAgreementRescue`, `collectorNumberScope`), declared in each game's
scanner manifest and resolved to a built-in or default profile when absent.

## User OCR control

OCR is an optional verifier, not the primary recognizer. It defaults on and is
only invoked for uncertain intentional captures. A persistent **Use OCR for
Difficult Scans** switch is available in iOS, Android, and web settings (and in
the native scanner controls). Turning it off skips title and footer OCR, keeps
visual retrieval and rejection thresholds active, and may therefore abstain or
leave an exact printing unresolved more often. The setting is device-local:
iOS stores it in `UserDefaults`, Android in `ScannerOptionsStore`, and web in
the registered `tcger.scanner.ocr-enabled` local-storage key.

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

Physical Pokémon builds also require `--pokemon-sets`, normally a pinned
official TCGdex `cards-database` archive joined by `setCode`, so every runtime
printing carries `releaseDate` and `collectorNumber`. Reviewed same-art
assignments may be supplied through `--pokemon-family-overlay`.
Unlisted printings remain singleton families; the builder never merges cards
by name alone.

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
