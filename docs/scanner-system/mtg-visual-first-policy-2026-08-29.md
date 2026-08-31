# Magic visual-first policy — 2026-08-29 replay record

Companion to [Real-camera recognition findings](real-camera-recognition-findings-2026-08-29.md)
(the diagnosis) and [Two-stage recognition](two-stage-recognition.md) (the
contract). This note records the iOS policy change and the simulator replay
that measured it.

## What changed (iOS)

`mobile-apps/ios/TCGer/TCGer/CardScanner/BoardCardEmbeddingScannerStrategy.swift`
and `ScannerEncoderVariant.swift`:

1. **Per-game strong accept.** Magic runs at 0.70 on ArcFace; other games
   keep the encoder value (now `ScannerGameAcceptancePolicy.builtin(for:)`).
   `SCANNER_STRONG_ACCEPT_MAGIC` overrides it for sweeps.
2. **No title gate on single-card captures.** `requiresTitleConfirmation` is
   true only for Magic binder pages (or with `SCANNER_MTG_TITLE_GATE=1`).
   A Magic photo is accepted on visual evidence like a Pokémon photo.
3. **OCR keyed to the attempt's required score.** Title/footer OCR runs when a
   crop cannot pass on its own score, including retry hypotheses that need
   the +0.02 margin. Previously a 0.71 whole-frame retry was neither accepted
   nor examined.
4. **Footer numbers match every represented printing.** A family row's
   `printingAlternatives` are searched, and the confirmed printing becomes the
   result identity with `verified` provenance.
5. **Title/visual agreement confirms the family.** When the exact printed title
   names the same card the image ranked first (and no different-name rival is
   inside the ambiguity margin), the family is accepted from the 0.55
   evidence floor and `CardPrintingResolver` chooses the printing. The
   "0.85 or abstain" rule now applies only when title and image disagree.
6. `CardPrintingResolver` keeps `printingAlternatives` on expanded candidates,
   and `DevModeSessionReplayTests` scores a same-family newest-printing
   fallback as a family match rather than a wrong accept.

`SCANNER_MTG_LEGACY_POLICY=1` restores the previous behaviour from the same
build for A/B replays.

Items 1, 2, 4 and 5 were then lifted out of Magic-specific code into the
declarative per-game [acceptance policy](game-acceptance-policy.md)
(`ScannerGameAcceptancePolicy` on iOS, `ScannerAcceptancePolicy` on Android,
`tools/scanner-acceptance-policies.json` for publishers), so the same rules
apply to any game from its manifest. Android's manual-capture OCR rescue is
now policy-gated rather than Magic-only and matches footer numbers across a
family's printings; the browser index takes its thresholds from the policy.

## Replay (iOS Simulator, iPhone 17 Pro clone, Magic visual-family v2 runtime)

Sessions: `scan-session-20260827-223150` (22 MTG frames, HOB foils) and
`scan-session-20260829-200235` (27 frames, reprint-heavy; labels added to
`DevModeSessionReplayTests.expectedCards`, session ingested into
`TCGer-Session-Reference`).

| Policy | Correct | of which family fallback | Wrong | Abstain | Lost accepts |
|---|---:|---:|---:|---:|---:|
| Legacy (`SCANNER_MTG_LEGACY_POLICY=1`) | 28/49 | 3 | 0 | 21 | — |
| Visual-first | **36/49** | 4 | **0** | 13 | 0 |

Per session: 08-27 stays 15/22 (its unique-title rescues are preserved);
08-29 goes 13/27 → 21/27. Recovered frames are the title-agreement cases
(Nivix Guildmage, Corpse Appraiser, Racers' Ring ×2, Broken Wings, Riveteers
Charm) and the nested-printing footer cases (Jwar Isle Refuge C17 258 and
Forsaken Sanctuary SOI 273, both now `verified`).

Still abstaining, all model-side: Bilbo's Deadly Slice (correct family below
the 0.55 floor), Stone Quarry (catastrophic camera-domain embedding; its
0.99 hits on unrelated retro-frame/back-face rows are caught by the ambiguity
margin, i.e. `printingAmbiguous`), Rage into the Valley at 0.65 with a title
match whose image leader disagreed, and Jungle Hollow whose Simulator crop
scores 0.59 (device scored 0.70 with footer 239 — expected to pass on device).

## Hand-held session 2026-08-29 23:37 (30 frames) and the fixes it forced

The same cards re-scanned hand-held (hand + laptop keyboard in frame),
labeled into the curated table. The device build accepted 21/30 — including
**two wrong accepts**: Tranquil Cove accepted as Sandblast at 0.725/0.74
through the whole-frame hypothesis, with no OCR consulted. The Simulator
replay reproduced one and produced a second of its own (an inverted
degenerate crop accepted as "Island" at 0.94 — the sibling orientation of a
hub-rejected crop). The audit of every accepted attempt across the 79
labeled MTG frames also showed a footer reading "273" once confirming
Cathedral of War over Forsaken Sanctuary, because both have a #273 printing
in the shortlist. Three fixes followed, all replay-verified:

1. **Whole-frame crops need printed evidence when a card was detected.**
   If the detector saw a credible box (≥ 10 % of the frame), the whole-frame
   hypothesis is card *plus background* — its embedding is not evidence of a
   card, and no similarity accepts it on its own. When the detector saw
   nothing (imports, scans, a 1 %-of-frame noise box), the frame effectively
   *is* the card and plain-visual acceptance stays. In the labeled data this
   kills both Sandblast wrong accepts and loses no frame: every correct
   plain-visual whole-frame accept happened with no credible detection, and
   the one exception (Vow to Erebor) was already accepted by its detected
   crop. An earlier interim fix used a fitted +0.05 whole-frame margin; this
   structural rule replaces it.
2. **Hub collapse voids the crop, not the orientation**
   (`CardScannerError.degenerateInput`): if either orientation of a crop hub-
   rejects, both are discarded; later hypotheses may still answer.
3. **Footer collisions abstain**: when a collector-number reading matches
   printings of more than one family in the shortlist, it confirms nothing
   unless the shortlist is title-constrained to one name.

| Replay (after fixes) | Correct | Wrong | Lost |
|---|---:|---:|---:|
| MTG 49-frame set | 36/49 | 0 | 0 |
| MTG hand-held 30-frame set | 18/30 (14 exact + 4 family) | **0** (was 2) | 1 (Pinecone Strike, Simulator-divergence; lost pre-fix too) |
| Pokémon 76-label library | 51/76 | 0 | same 5 pre-existing |

The hand-held set's 12 abstentions are the camera-domain story again:
Tranquil Cove, Forsaken Sanctuary ×4, Rage into the Valley ×3, Stone Quarry,
Pinecone Strike — correct families stuck in the 0.55–0.70 band or hub-collapsed.
A localizer bake-off on the same 30 frames (device quad vs Vision, DETR, YGO
OBB, seg models) again moved top-1 by at most one frame — the crop is not
what fails on hand-held captures either.

## Art-panel crops — the largest single failure class (2026-08-30)

`scan-session-20260830-171145` (29 hand-held frames, first session on a
device build with hub rejection) accepted 21/29 with 0 wrong. Its eight
abstentions were audited crop by crop, and five of them share one cause that
also explains six frames of the 23:37 hand-held session and one of the 20:02
photo session — **12 of the 108 labeled Magic frames**: the crop handed to the
encoder was the card's **art panel**, not the card. The panel embeds as
garbage (0.55–0.68 "Swamp", "Call Forth the Tenebrous", "Lessons"), while the
same frames rank the correct card first at 0.76–0.93 from the plain detector
box (`tools/camera-corpus/bench_localizers.py`, `app-detector-box` localizer).
Both Sandblast wrong accepts of 08-29 were downstream of this: the panel crop
failed, and the unguarded whole-frame hypothesis answered instead.

Two mechanisms, one per runtime, both structural rather than tuned:

1. **The detector fires on the panel (device).** On the full-resolution
   original the YOLO11s card detector returns the card *and* its art panel
   — 0.95 vs 0.90–0.96, and on frame 22 the panel out-scores the card. The
   app took the highest-confidence box, and every later stage is gated on
   agreement with that box, so the panel became the crop (the recorded quad
   equals the detector box exactly on frames 1/11/13/16; on frame 22 the
   winning box is a second card lying on the table, which is the two-card
   problem, not this one). Fix:
   `CardObjectDetector.indicesSuppressingNestedBoxes` — a detection whose
   area lies ≥ 80 % inside a larger detection is a panel, because cards do
   not contain cards, and is dropped regardless of confidence. Applied in
   `CardCropper` (single card) and `BinderPageScanner` (after its own size
   filter, so a page-sized false detection cannot swallow the cards).
2. **Vision's quad passes the agreement gate (Simulator, and any device
   frame where the detector finds only the card).** The doc-seg and
   rectangle candidates had to overlap the detector box by IoU ≥ 0.45/0.35
   — measured on axis-aligned `boundingBox`es. On a tilted card the panel's
   bounding box inflates (a 0.15-area panel reports a ≈0.24 box) and clears
   the gate against the 0.50 card box (Simulator probe, frames 11/13/22:
   one card-sized detection, chosen quad = the 0.15-area panel);
   `isCardShaped` cannot help because a Magic art panel is itself ≈0.75
   and the band is orientation-agnostic.
   An area bound does not separate the cases: a panel in a tight box covers
   ~0.35 of it, while a sleeved or toploaded card in a loose box covers
   0.27–0.46 (a first attempt with "quad ≥ 0.5 × box" recovered the Magic
   frames and broke two Pokémon binder frames, Timburr and Regigigas, by
   discarding their correct quads). Orientation does separate them: the
   panel is landscape inside a portrait card. Fix:
   `CardCropper.matchesDetectorOrientation` — a candidate quad must share
   the detector box's orientation whenever both are decisive (beyond a 10 %
   difference of extents, in pixel space); a near-square box, i.e. a
   steeply tilted card, decides nothing and keeps the old gates. Rejected
   candidates fall through to the padded-box retry and finally to the plain
   box crop.

Android has no card detector (single-crop pipeline), so nothing to port;
the web runtime crops from the browser's own detector output and should
adopt rule 1 when it gains multi-box output.

| Replay (Simulator, same build otherwise) | Before | After | Wrong | Notes |
|---|---:|---:|---:|---|
| 171145 hand-held (29) | 18/29 | **24/29** (20 exact + 4 family) | 1 → 1 | frames 11/13/22 now 0.82/0.82/0.90 from the card crop, frame 1 at 0.65, Forsaken Sanctuary (10) at 0.69; the one wrong is the pre-existing two-card frame 27 |
| MTG 49-frame set | 36/49 | **39/49** (35 exact + 4 family) | 0 → 0 | 223150 frames 1 and 17, Jungle Hollow (200235 frame 19) recovered; nothing lost |
| MTG 23:37 hand-held (30) | 17/30 | 18/30 (15 exact + 3 family) | 0 → **1** | frame 24 recovered; frame 2: see below |
| Pokémon 76-label library (390 frames) | 51/76 | **53/76** | 0 → 0 | binder sleeves/toploaders unaffected by the orientation rule (Timburr, Regigigas agree with the device again); two labeled recoveries |

The new wrong accept is the honest cost of a better crop. On 23:37 frame 2
the crop is now the whole Tranquil Cove (previously the art panel, which
abstained), and the encoder returns **Island, Aetherdrift #508 at 0.95**
with a 0.24 margin. That Island is a yellow full-art card and the photo has
a strong warm cast (the Cove's text box reads yellow in it): the match is on
global colour, not the card. Its 180° twin lands in a spread of unrelated
lands at 0.70–0.77, and offline every competent localizer's crop of frames
2/3/4 produces a confident wrong top-1 (0.83–0.99), so this is the
camera-domain model failure the notes above already name, not a crop or
policy defect — no structural rule separates it from a real 0.95, and a
fitted one is not wanted. Frames 3/4 of the same card stay abstained only
because their other orientation hub-rejects. The lever is the real-camera
fine-tune with colour-cast augmentation (the augmentation bank measured the
warm-light channel ratios at 0.89/0.85/0.85).


What remains in 171145 after this: frame 0 (Rage into the Valley) is a
genuine encoder miss (every crop ≈0.6 wrong); frame 19 is motion blur
(sharpness 0.027, a retake hint would be honest); frames 22/27 have two
cards in frame and belong to a multi-card path; four family fallbacks
(Golgari Guildgate, Jungle Hollow, Riveteers Charm, Darksteel Ingot) happen
because OCR is not consulted once the visual score clears strong accept —
pinning the printing from the footer on strong accepts is an OCR-on-only
refinement and is deliberately not part of the visual path.

## Two cards in frame: the framed card wins (2026-08-30)

On 171145 frames 22 and 27 a second card lying on the table out-scored the
held card in the detector (0.96 vs 0.95, 0.94 vs 0.89) and was cropped
instead — frame 27's Darksteel Ingot was the session's one wrong accept.
The single-card flow shows a centred framing guide and feeds the guide crop
to the pipeline, so the card the user framed is the one under the frame
centre: `CardCropper.preferredDetectionIndex` now takes the most confident
detection that contains the frame centre, and falls back to confidence
order when none does. Replays: 171145 24/29 with **0 wrong** (frame 27 now
abstains on the half-occluded Crosis's Charm rather than accepting the
Ingot); the 49-frame set (39/49), 23:37 set (18/30) and Pokémon library
(53/76) are unchanged. A frame with two fully visible framed cards is still
a multi-card capture and belongs to the binder path.

## Query colour normalization — the camera-domain gap was colour and contrast (2026-08-30)

Chasing the Tranquil Cove → Island 0.95 accept with the released encoder
offline, one probe settled where the "camera-domain model failure" lives:
the raw crop ranks Tranquil Cove **10,947th** (0.10) behind Plains/Oasis/
Forest at 0.83–0.85; a grey-world white balance of the same pixels ranks it
first at 0.67, a 1 % autocontrast at 0.76. The gallery is embedded from
clean, white-balanced, full-range renders; hand-held crops arrive
low-contrast under a room colour cast, and the encoder was never trained to
ignore either (its augmentations are geometric, brightness/saturation/
contrast, blur and noise — no cast).

Measured on every labeled frame, identical Vision document-quad crops,
released encoders (`.artifacts/camera-corpus/probe/colour_eval.py`):

| Query preprocessing | Magic top-1 (108) | would accept, correct | would accept, wrong | Pokémon top-1 (52) | would accept, correct |
|---|---:|---:|---:|---:|---:|
| raw (shipped) | 79 | 61 | 1 | 42 | 27 |
| grey-world | 96 | 75 | 3 | 35 | 24 |
| autocontrast 1 % | 100 | 91 | 1 | 43 | 31 |
| **grey-world + autocontrast** | **104** | **93** | 1 | 43 | 31 |

("would accept" = top-1 ≥ 0.70 with a 0.05 family margin; the Magic
"wrong" under normalization is a same-name family of Crosis's Charm, and
the raw wrongs are the attractor hits — Dark Ritual 0.91, Dust Bowl 0.98,
Shivan Gorge 0.998 — that hub rejection exists for.) All eight Rage into
the Valley frames (rank 4–52 → 0 at 0.81–0.90), all six Stone Quarry frames
(rank ∞ → 0 at 0.67–0.83), Bilbo's Deadly Slice, Forsaken Sanctuary ×5,
Eagle of the Great Shelf and Tranquil Cove are recovered by normalization
alone. Clean renders are near-invariant (self-similarity 0.94–0.997), so
the shipped gallery stays valid.

Shipped as `QueryColorNormalization.swift`: grey-world gains, then Pillow's
per-channel 1 % autocontrast, applied to every crop before the encoder's
resize/centre-crop contract (`SCANNER_QUERY_NORMALIZATION=0` restores raw
queries for A/B). The arithmetic is a pixel-exact port so the offline
evaluator and the device agree. The trainer gained the same stage
(`--query-normalization grey-world-autocontrast`, applied to training
views, gallery renders and evaluation queries), a colour-cast augmentation
(warm ↔ cool channel gains up to 1.25× with gamma, `apply_colour_cast`),
and a weights-only `--finetune-from` mode with a fresh schedule (Hub resume
would restore a finished cosine schedule and learn nothing); both HF job
wrappers forward `--lr`, `--query-normalization` and
`--finetune-from-hub-path`.

It is **per game**, declared as `queryNormalization` in the acceptance
policy (`none` | `grey-world-autocontrast`): the Pokémon `physical-v2`
encoder was trained toward camera captures and *loses* under the same
normalization (76-label replay 53 → 49, 0 wrong), so it stays `none`;
Magic is `grey-world-autocontrast`. Android applies the identical
arithmetic (`QueryColorNormalization.kt`, driven by the runtime's policy);
the browser runtime still embeds raw queries and must adopt the same stage
for Magic before its gallery is republished (its matcher is mid-edit in
another workstream, so it is not touched here).

| Replay (Simulator) | multi-card rule only | + query normalization (Magic) + hub 2 | Wrong |
|---|---:|---:|---:|
| 171145 hand-held (29) | 24/29 | **27/29** (22 exact + 5 family) | 0 → 0 |
| MTG 49-frame set | 39/49 | **47/49** (41 exact + 6 family) | 0 → 0 |
| MTG 23:37 hand-held (30) | 18/30 | **28/30** (22 exact + 6 family) | 0 → **1** |
| Pokémon 76-label library | 53/76 | 53/76 (`none`; identical outcomes) | 0 → 0 |

The 23:37 wrong accept is frame 4: Vision finds no card-shaped quad, the
crop falls back to the plain detector box (card plus hand and background),
and the normalized box crop hits the yellow full-art Island at 0.94. Its
sibling frame 3 used to fail the same way; with `hubDistinctNames` lowered
from 3 to 2 its box crop is voided (Plains 0.99 / Forest 0.99 — two
different names at hub similarity, which no correct crop of the 160 labeled
ever shows) and the frame resolves correctly through the whole-frame
hypothesis. Frame 4's twin orientation is not a hub (Plains 0.84), so the
remaining lever there is the crop itself — the game-specific segmentation
model — not a threshold. Session-level: 108 labeled Magic frames went from
72 correct at the start of 2026-08-30 to **102** (0 → 1 wrong).


## Does this need a retrain?

Not for these gains — they are policy and metadata handling. A retrain is the
next lever for the remaining abstentions, and it only helps with **real-camera
positives** (foil, glare, sleeves, perspective); another catalog-only run with
the same recipe would reproduce the same 0.55–0.70 band. The camera-corpus
plan in [Current state and direction](current-state-and-direction-2026-08-29.md)
is the prerequisite. The attractor rows (~880 v2 rows with a >0.9 neighbour of
a different name) turned out to be a symptom, not a lever — see the
[camera corpus note](camera-corpus-2026-08-29.md); the guard that works is
the policy's hub rejection plus the non-card gallery exclusions.

## Follow-ups

- Android now shares the policy contract and the rescue rules (title gate,
  agreement rescue, family-scoped footer matching); item 3 (OCR keyed to the
  retry-attempt required score) has no Android equivalent because Android
  evaluates one crop. Web reads the policy's thresholds only.
- Add the visual leader name/score to `ScanDiagnostics.Attempt` so
  title-agreement decisions are auditable from evidence alone.
- Pokémon regression (full session library, physical-v2 runtime, same
  build): 51/76 labeled correct, 0 wrong accepts — versus 47/76 in the v2
  release gate. Five device accepts abstain in the Simulator; all five are in
  the release gate's own lost-vs-device list (Simulator Vision divergence),
  so they predate this change.
