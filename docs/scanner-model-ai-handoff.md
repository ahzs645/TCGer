# Scanner Model AI Handoff

Last updated: 2026-08-16 (per-pocket dev-mode coordinator evidence)

## Session Results 2026-08-11 (22:03 device binder export)

Archive: `TCGer-DevMode-scan-session-20260810-220315.zip`, ingested as
`scan-session-20260810-220315` (107 files, session digest recipe v2). Device,
Pokemon, binder mode: 610 s, 9 page captures of 5 physical pages, 41 distinct
pockets, 14 human corrections.

Recorded outcome, 73 raw detections: 12 matched (>= 0.82), 29 uncertain
(0.72-0.82), 32 nothing. Best-of-captures per distinct pocket: 11 matched,
16 uncertain, 14 nothing. **13 of the 14 corrections were on pockets where
the pipeline offered nothing at all**; only one was a wrong suggestion. The
precision guards hold; recall is the gap.

Findings:

- **Binder dev-mode exports now contain real per-pocket diagnostics.** Before
  2026-08-16, `CardScannerViewModel.recordBinderPageForDevMode` synthesized one
  blank-evidence attempt from each final detection; archives recorded before
  that date still have that limitation. New scans isolate one
  `ScanDiagnostics` collector per concurrently processed pocket and merge all
  actual coordinator attempts into the page export. Each attempt carries its
  pocket index, page quad, coordinator-local quad, gate/shortlist/title/footer
  evidence, final binder status, default-inclusion decision and policy reason,
  normalized and native perspective-crop dimensions, crop-quality report,
  applied geometric rotation, and explicit `semanticOrientation: unverified`.
  Frame and original-image pixel dimensions are also persisted. Upside-down
  recognition is not inferred or changed by this instrumentation.
- **Failures cluster on foil.** All 14 corrected cards are holo,
  reverse-holo, or glare-washed; the 12 clean accepts are matte. One all-foil
  Platinum/HGSS page scored 0/8 on both of its captures with crisp,
  human-legible crops. All 14 truth cards are present in
  `CardsIndexMetadata.json`, so this is not index coverage. Border-ring
  saturation separates weakly (median 0.62 accepted vs 0.45 for both failure
  modes) — directional, overlapping, not usable as a gate.
- **The encoder never sees the card name or the collector number.** DINOv2
  preprocessing is resize-shortest-edge-256 then center-crop-224; on a
  720x1000 crop that keeps only y in [18.5 %, 81.5 %]. Parity holds (the
  index is built the same way), so nothing is broken — but the two most
  printing-discriminative bands are structurally unavailable to the model,
  and printing ties were 29 of 73 detections.
- **Re-capturing a page discards the previous result, yet top-1 is stable
  across captures.** Every pocket with candidates in >= 2 captures produced
  the identical top-1 card ID (10/10). Page A scored 1, then 0, then 4
  accepts across three captures of the same page, union 4, with 8 of 9
  pockets holding a consistent top-1. `CardScannerViewModel` replaces the
  page record on rescan; merging per pocket is free recall.
- Basic Energy is its own failure class: dp1-125 Water Energy retrieves
  dp1-123 Grass Energy at 0.784 with a top-2 margin of exactly 0.050 — it
  clears `reviewPreselectionMargin` and auto-includes on a blanket confirm.
- Capture is 1536x2048 (3.1 MP); `CardScannerCamera` sets only
  `sessionPreset = .photo` and never sets `maxPhotoDimensions`. A pocket
  lands at ~236x452 native px before upscaling to 720x1000, putting the
  collector number at ~5 px tall — footer OCR cannot work in binder mode at
  this capture size regardless of the OCR code.

### Binder per-pocket ground truth is now recoverable and asserted

The archive still has no binder label field, but the recorder writes a review
correction from the same `CGImage` it wrote into the page's
`attemptImageFiles`, so the files are byte-identical and hashing both sides
recovers (page frame, attempt index). This was done ad hoc for the 21:12
session before; it is now a tested helper,
`TCGerTests/BinderPocketLabels.swift`, consumed by `BinderSessionReplayTests`.
26 of 26 corrections across the library join to exactly one pocket, no
collisions; after collapsing repeated edits of a pocket to the last one, 24
distinct labeled pockets remain.

First scored run (Simulator, iPhone 17 Pro, 2026-08-11, the two sessions with
corrections): **24 labeled pockets, 6 correct, 1 wrong auto-include, 17
abstained, 0 unlocalized** (pocket alignment IoU 0.50-0.93). The wrong
auto-include is `scan-session-20260809-211223/frame-0008.jpg#0` — Absol
(ex13-18) retrieved as Shiftry (ex2-22) at 0.77 with a top-2 margin wide
enough to clear `isReliableSuggestion`, so a blanket page confirm imports it.
The margin gate cannot catch this: it measures separation, not correctness.
Held in `BinderSessionReplayTests.knownWrongAutoIncludes` as an open defect.

`DevModeSessionReplayTests` now also reads the recorder's own
`expectedCardId`/`expectedNoMatch` as ground truth (previously only the
curated `expectedCards` table was consulted, so corrected frames replayed
unscored), collapses superseded re-edits, and no longer anchors its
lost-accept floor to predictions the human rejected. That surfaced two
genuine wrong accepts on the new session, both listed in `knownWrongAccepts`:
dp1-125 -> dp1-123 (Water Energy read as Grass Energy) and ex13-18 -> ex5-42
(Absol read as Medicham). Note that a separate capture of that same Absol in
the 21:12 session comes back as Shiftry through the binder path: two
different wrong Pokemon from two foil crops of one card, so this is an
unstable retrieval neighborhood, not a near-twin printing the OCR tiebreak
could settle.

### Web cross-check: the encoder is not the problem, the score is

Ran the same crops through the node/web path
(`backend/src/scripts/eval-recognition.ts --no-ocr`, which is a line-for-line
port of `frontend/src/lib/scan/embedding-matcher.ts` with no quality gate, no
face gate, and no 0.72 threshold, so it reports raw retrieval). The index is
byte-identical to the iOS one — 21828 x 384, same int8 payload hash, same row
order as `CardsIndexMetadata.annIndex` — so any difference is encoder or crop,
never the index.

- **iOS and web agree.** On the 41 pockets where iOS produced a candidate,
  the web encoder returns the same top-1 for 38. Transformers.js q8 ONNX and
  the CoreML `CardEmbeddings.mlpackage` are interchangeable here; there is no
  iOS-specific encoder defect in this class of input.
- **The score tracks the iOS decision sanely** across all 73 pockets of the
  22:03 session — median web top-1 similarity 0.845 for iOS-accepted, 0.750
  for uncertain, 0.692 for iOS-nothing.
- **On the 24 human-labeled (i.e. hard, foil) pockets the score carries
  almost no signal.** Correct top-1: n=12, median 0.700, range 0.624-0.802.
  Wrong top-1: n=12, median 0.699, range 0.643-0.835. The two distributions
  are indistinguishable, and of the 6 crops clearing 0.72, **4 are wrong**.
  Threshold tuning has no favorable operating point on this class — the
  highest-scoring crop in the entire labeled set (0.835) is a wrong answer.
- **Retrieval is far better than the pipeline's output suggests.** True card
  at rank 1 for 12/24 and within top-5 for 17/24, on pockets where the device
  delivered nothing 23 out of 24 times. A re-rank stage over the shortlist is
  therefore worth much more than any threshold change (consistent with the
  earlier NCC re-rank result, 13/14 recovered where truth was in a top-5).
- **These are not printing ties.** Only 2 of the 12 wrong top-1s share a name
  with the truth (base4-45/base1-31 Jynx, and dp1-125/dp1-123 Energy, which
  is a same-class tie rather than a same-name one). The other 10 are entirely
  different Pokemon — Absol read as Shiftry, Giratina as Machamp, Altaria as
  Goomy. The collector-number OCR tiebreak arbitrates only among shortlist
  candidates and so cannot address them; exact TITLE evidence could, but the
  center-crop preprocessing removes the name band before inference.
- 6 of the 32 iOS-nothing pockets have a web top-1 at or above 0.72 (max
  0.835), i.e. the raw score would have passed. Whether iOS lost those to the
  face gate or to re-cropping an already-rectified crop cannot be told apart
  from the archive — see the synthesized-evidence finding above.

Reproduce:

```bash
cd backend
npx tsx src/scripts/eval-recognition.ts --images /path/to/pocket-crops \
  --labels /path/to/labels.json --no-ocr --out /tmp/eval-manifest.json
```

Model weights are already cached under
`node_modules/@huggingface/transformers/.cache/onnx-community/dinov2-small`,
so this runs offline.

Validation (Simulator, iPhone 17 Pro, 2026-08-11): full 12-session single-card
replay passes — 31/76 labeled correct, 0 previously-accepted lost, 0
unallowlisted wrong accepts; on the two sessions that carry corrections the
scored label count went from 0 to 24, since those labels were previously
ignored entirely. Binder replay over those two sessions passes with
assertions on: 16 pages, candidates 85 -> 88, matched 26 -> 36. Three pages
of the new session sit below their device candidate baselines in the
Simulator (8/5/4 -> 7/4/3, identical across two consecutive runs, on a change
that touches no detection or retrieval code); they are recorded in
`simulatorCandidateFloors` under the same convention as the 2026-08-10 batch.

## Manual Match Search: Lucario Trainer Kit 3/11

The eBay listing resolved to English Lucario `3/11`, DP Trainer Kit
(Lucario), printed identifier `DPBP#506`; the seller title misspelled the name
as `Lucaio`. The canonical TCGdex/catalog ID is `tk-dp-l-3`.

The exact printing was already present in the bundled Pokemon catalog but was
hard to find: offline search indexed names and set metadata only, collapsed a
compound query into one substring, had no typo fallback, and did not carry the
printed DPBP alias. Its TCGdex record has no image, so the result also appeared
as an indistinguishable placeholder and the printing is absent from the ANN
scanner index.

Retained fixes:

- tokenized AND matching across name, set name/code, canonical collector
  number, and Pokemon display fraction (`3/11`);
- conservative one-edit correction only for an otherwise empty, single-word,
  five-or-more-letter query (`Lucaio` -> `Lucario`);
- a reviewable curated alias registry mapping `DPBP#506` to `tk-dp-l-3`;
- canonical collector number remains `3`, while mapped UI metadata exposes
  `3/11`; and
- shared result cells show set name, set code, collector fraction, an explicit
  unavailable-image state, and the same printing identity to VoiceOver.

`CatalogSearchTests` covers `Lucario`, `Lucaio`, `3/11`, `Lucario 3/11`,
`DPBP#506`, `DPBP506`, wrong denominators, exact-result precedence, and
non-Pokemon number formatting. Focused catalog/normalizer/filter validation
passes 11/11 on iPhone 17 Pro Simulator.

Server fallback was also inconsistent: the adapter sent the local TCGdex
cache's `q`/`pageSize` parameters and expected a wrapped `data` response even
when configured for public `api.tcgdex.net`. Public TCGdex now uses `name` and
colon-style pagination and accepts raw arrays/objects; non-public cache origins
retain their existing contract. Focused adapter/card-service suites pass 11/11
and the backend TypeScript build check passes.

Do not insert metadata without an embedding or relabel `dp1-6` as this card.
TCGdex has no exact reference image and its guessed asset URL returns 404;
`dp1-6` uses different artwork/illustrator despite sharing attacks. Exact
automatic visual matching requires a clean rights-cleared or user-owned front
scan, followed by an atomic vector/metadata rebuild. The curated identifier
can safely support high-confidence OCR verification in the meantime.

## Session Results 2026-08-09 (22:39 binder export)

Archive: `TCGer-DevMode-scan-session-20260809-223944.zip` (SHA-256
`6d84f61e535e3daa12cfcc9ae671a6078088db0a1d7417cda25939c23cbf7b01`).
It contains 41 Pokemon binder-page frames and 324 saved card attempts. There
are no manual correction labels, so device outcomes are regression evidence,
not exact-print ground truth.

### Device evidence

- 67 attempts were accepted, 120 were printing-ambiguous, and 137 had no
  candidates. Nine pages had no accepted card. Accepted confidence ranged
  from 0.820 to 0.910 (median 0.846); ambiguous confidence ranged from 0.620
  to 0.819 (median 0.768).
- Footer-pair OCR was empty for all 324 attempts, and no attempt used title or
  OCR verification. Binder exact-print evidence remains the largest measured
  recognition gap; do not compensate by lowering the 0.82 auto-match bar.
- The pages are mostly upright with modest camera roll, perspective, glare,
  partial pages, card backs, and Energy cards. This is useful binder stress
  coverage but is not semantic 90/180-degree rotation ground truth.

### Arbitrary-angle and crop findings

Perspective correction handled ordinary camera roll well: 312/324 recorded
crop quads had a pixel-corrected top edge within 2 degrees of horizontal,
seven were 2-5 degrees, three were 5-10 degrees, and only two exceeded 15
degrees. The two extreme outliers were isolated bad corner refinements, not
coherently rotated pages.

The clearest case is `frame-0027`, attempt 7. The archived, current
perspective, short-edge-reordered, and 180-degree variants all missed the
visible `pl3-10` Rhyperior in ANN top 10. Cropping the same source from the
detector's axis-aligned box put `pl3-10` at ANN top 1 (0.722); the full
per-card coordinator then returned the exact candidate at 0.777. The binder
decision correctly remains ambiguous below its 0.82 auto-match bar. Rotation
did not solve this failure; the refined corners had latched onto the wrong
image structure.

`BinderPageScanner` now computes the median refined top-edge angle for the
page and retains coherent arbitrary page rotation. It uses the detector box
only when one refinement differs from that page consensus by more than 15
degrees, allowing the per-card coordinator to localize that crop again. This
would affect only the two pathological recorded attempts, rather than every
genuinely tilted card/page.

### Replay and validation

Replaying all 41 full-resolution pages in one Simulator test exceeded the
test-process lifetime after eight pages. `BinderSessionReplayTests` therefore
supports comma-separated `DEVMODE_BINDER_FRAME_FILES` chunks and an explicit
`DEVMODE_BINDER_DIAGNOSTIC_ONLY=1` comparison mode. Six bounded chunks ran to
completion. Recorded device versus current Simulator totals were 187 to 160
attempts with candidates and 67 to 40 matched; this is a Vision
device/Simulator divergence, so these pages must not receive new Simulator
floors without labels.

The two seven-page neighborhoods around the extreme quads were unchanged by
the guarded fallback: frames 21-27 stayed at 16 candidates/2 matches and
frames 28-34 stayed at 35/13. The focused algorithm suite passed 17/17. A
test-only labeled perspective harness remains available for future manually
verified binder slots.

Next measured work: persist manual binder slot corrections as ground truth;
improve high-resolution title/collector OCR for small and vintage crops; add
real whole-page and per-card 90/180-degree captures; and retain card backs,
glare, and partial-page negatives. Arbitrary roll itself is already handled
by quad rectification—future rotation work should distinguish bad corners
from semantic upside-down content.

### Post-shutter warp experiment and repository cross-check (2026-08-10)

The default scanner trigger is `Tap Shutter`, so a bounded correction pass
after capture is acceptable; alternate warps still must not multiply work for
every card on every binder page. The most transferable open-source patterns
were:

- [OSS DocumentScanner](https://github.com/ossappscollective/OSS-DocumentScanner)
  searches multiple edge thresholds, validates convex document-like quads,
  and exposes manual edge/corner correction.
- [WeScan](https://github.com/WeTransferArchive/WeScan) keeps automatic
  detection and an editable post-capture quadrilateral as separate stages.
- [RiftBound Scanner](https://github.com/Nekoraru22/riftbound-scanner) uses
  learned corner/angle localization, full-resolution warps, and synthetic
  perspective, sleeve, glare, and shadow augmentation.
- [Rarebox](https://github.com/novaoc/rarebox) compares multiple Sobel
  thresholds plus strongest/outermost Hough borders. No usable repository
  license was found, so only the independently implemented experiment design
  was retained.
- [UVDoc](https://github.com/tanguymagne/UVDoc) targets dense dewarping of bent
  paper. It is unnecessary for a rigid card and can hallucinate geometry, so
  it is not a production candidate here.
- [yugioh-one-shot-learning](https://github.com/vanstorm9/yugioh-one-shot-learning)
  uses a simple first four-point contour. It is a useful baseline but is too
  brittle for sleeves, artwork rectangles, and binder seams.

`ScannerOrientationExperimentTests` now contains a test-only outer-border
proposal generator. It downsizes only the detector region, tries Sobel mean
multipliers 2.2/1.5/1.0, votes for border lines, compares strongest versus
outermost sufficiently strong lines, and rejects non-card-shaped or badly
sized quads before perspective correction.

On the manually verified `frame-0027` Rhyperior (`pl3-10`), the archived and
current refined crops scored 0.562/0.568 and missed the expected card in the
ANN top 10. The detector box scored 0.722; the outer-border warp raised the
same exact candidate to 0.798 through both raw ANN and the full coordinator.
That remains below the 0.82 binder auto-match threshold, so it improves the
review candidate without justifying an automatic accept.

The broader safety run used all 67 device-accepted attempts as pseudo-labels.
These are regression evidence rather than human exact-print truth. Current
refined crops produced 48/67 top-1, 38 strong-correct, four strong-wrong, and
25 abstentions on Simulator. Detector boxes produced 50/67, 39, six, and 22.
Selecting the maximum detector/Hough score produced 53/67, 47, six, and 14,
but changed identity ten times: five corrections and five regressions. That
unconstrained policy is rejected.

An agreement-only interpretation is safer: accept a Hough score increase only
when it returns the same card ID as the first crop. At the binder 0.82 bar,
detector boxes had 13 matched-correct and zero matched-wrong pseudo-labels;
agreement-only refinement had 16 and zero. The full run generated 62 Hough
proposals, spent 52.487 seconds in the test-only Hough CPU stage, and took
293.7 seconds including embeddings on Simulator. Production work should
therefore remain an uncertain-result-only post-shutter retry, and it still
needs human-labeled binder positives and negatives before promotion.

Do not reintroduce the tempting global binder portrait-normalizer shortcut.
The earlier 19-page replay reduced candidates from 107 to 99 despite gaining
one match, and the archive contains no physical sideways binder card to prove
the intended fix. The safe next sequence is: persist per-slot correction
labels; capture sideways and upside-down cards plus negatives; evaluate the
agreement-only retry; then add an editable four-corner review control for an
uncertain manual-shutter card. Manual correction is the most reliable escape
hatch for sleeve glare or a border detector locked onto interior artwork.

### Offline policy evaluation on one evidence dump (2026-08-10, later)

`ScannerOrientationExperimentTests.testAcceptedBinderPolicyEvidence` writes
one JSON line per strongly accepted binder attempt: the full ANN top-10 for
the refined crop, the detector box, and every Hough proposal, plus Laplacian
sharpness, plus each crop as a PNG. Selection policies are then scored
offline from a single Simulator run instead of re-embedding per policy. On
the same 67 pseudo-labeled attempts:

- Baselines reproduced exactly: refined 16 matched-correct/0 matched-wrong at
  0.82, detector box 13/0, agreement-only 19/0 in this run.
- Separation is highly diagnostic. Every wrong review candidate at >=0.72 had
  a top-2 ANN margin of at most 0.047 (median 0.009); correct ones had median
  0.095. An ANN margin >=0.05 gate would have suppressed all fifteen wrong
  review candidates while keeping roughly three quarters of correct ones.
- Laplacian sharpness did not separate correct from wrong refined crops
  (medians 479 versus 490); binder identity errors here are crop-geometry
  errors, not blur. A sharpness gate changed nothing.
- Identity change with two agreeing alternates (challenger k=2) gained three
  corrections with zero regressions; k=1 behaved like unsafe max-score.
- Grayscale NCC against reference art (128x179, ensemble over crop variants,
  pooled top-5 candidates) recovered 13 of 19 wrong refined top-1s; the six
  misses all lacked the true card in any variant's top-5 (geometry failures,
  unreachable by re-ranking). Restricted to attempts where the true card was
  present, recovery was 13 of 14.
- Combined production-shaped policy — accept refined at >=0.82; otherwise
  NCC-arbitrate pooled candidates only when the refined ANN margin is <0.05,
  requiring NCC >=0.25 and NCC top-2 margin >=0.05 for an identity change —
  scored 59/67 top-1 (11 corrections, zero regressions), 18 matched-correct,
  zero matched-wrong, zero strong-wrong at 0.72.
- One instructive conflict: `frame-0002` attempt 5 was device-accepted as
  Pocket ID `A2-105` at 0.79 ANN, but its reference art NCC was -0.02
  (uncorrelated). A physical binder card with a digital-only Pocket ID plus
  zero pixel correlation suggests art-reuse index aliasing; ANN-versus-NCC
  disagreement is a useful review flag on its own.

Caveats unchanged: pseudo-labels, Simulator Vision, and reference art pulled
from pokemontcg.io/tcgdex CDNs at evaluation time (a production NCC stage
would need bundled or cached reference thumbnails, and four IDs had no
fetchable art). The evaluation scripts live outside the repository; the
JSONL format is documented in the test.

### Pixel-space isCardShaped fix, shipped and validated (2026-08-10, later)

`CardCropper.isCardShaped` measured its [0.58, 0.9] aspect band on
Vision-normalized points, which are anisotropic on any non-square image: a
real card on an 830x1162 binder page measures 0.95 normalized, so the
sub-image corner refinement discarded 58 of 67 correct refined quads and fell
back to plain detector boxes. Shipped fix (commit 031cd843): an `imageSize:`
overload scales corners to pixel space; `refinedObservations` uses it. The
doc-seg plausibility check (`isPlausibleDocumentDetection`) deliberately
stays in normalized space — switching it to pixel space measured 0 change on
the corner-refinement wins but re-admits doc-seg interior panels on
borderless 720x1000 crops (the normalized band on portrait frames only
passes quads narrower than a real card, which effectively disables doc-seg
on second-stage crops, and that is load-bearing).

Validation, all against `~/Downloads/Reference`:

- Binder session replay (68 pages, 8 sessions): candidates 313 -> 366,
  matched 100 -> 166. Eleven pages sat below their recorded device floors
  both before and after the fix (verified with a pre-fix worktree control at
  715fe9b2 — e.g. one page reproduces 0 candidates under both codebases
  against a device baseline of 2); their post-fix Simulator floors are now
  encoded in `BinderSessionReplayTests.simulatorCandidateFloors`. Two floor
  shortfalls are junk candidates no longer retrieving (`ecard3-146`,
  `lc-92`).
- 2,336-image scene replay: unchanged at its floors — 2,334 localized, mean
  IoU 0.928, 18/50 accepted, 16 exact, 0 wrong printings.
- Policy evidence rerun with a `productionRefined` variant (the shipped
  refinement): 61/67 top-1 versus 48 for the recorded device quads,
  37 matched-correct at 0.82 versus 16, 60 strong-correct at 0.72 versus 38.
  Head-to-head it fixes 16 device top-1s and breaks 2 (both sub-0.72, so
  they abstain rather than mis-accept). The single matched-wrong at 0.82 is
  Pocket art-reuse aliasing (`A4-036` over `bw1-25`, margin 0.018) and is
  exactly what the shipped review-margin gate suppresses.
- Margin gate re-validated on post-fix crops: wrong strong top-1s max margin
  0.026, correct median 0.098; the 0.05 gate suppresses all 3 wrong and
  keeps 52 of 60 correct. Shipped in `BinderPageScanner` as
  `reviewPreselectionMargin`: uncertain suggestions below the margin stay
  visible in review but are not auto-included on page confirm
  (OCR-verified primaries exempt). k=2 hysteresis remains regression-free
  but is largely obsoleted by the fix (2 corrections with the
  productionRefined incumbent versus 16 available pre-fix).
- Behavior change decided by the user: a stacked two-card frame
  (`210958/frame-0011`, Giratina LV.X in front) is now identified as the
  front card at 0.87 instead of abstaining. The detector reports ONE box for
  the stack (conf 0.92, no geometric guard possible) and refinement
  deterministically isolates the front card; the ground-truth label moved
  from noMatch to `dpp-DP38`. Fifteen other device accepts that do not
  reproduce in the Simulator on either codebase are allowlisted in
  `DevModeSessionReplayTests.knownSimulatorDivergences`.

### 2026-08-10 ledger: everything tested, every decision, forward path

One place to see what the two 2026-08-10 sessions tried, what shipped, what
was rejected and why, and what deliberately remains. All numbers are
Simulator, on the 67-attempt binder pseudo-label set unless stated.

Shipped to production (`CardCropper.swift`, `BinderPageScanner.swift`):

1. Pixel-space `isCardShaped` for sub-image corner refinement. 61/67 top-1
   versus 48; binder replay matched 100 -> 166; scene replay unchanged.
2. Review-margin gate (`reviewPreselectionMargin = 0.05`): sub-margin
   uncertain suggestions are review-only, never auto-imported on page
   confirm; OCR-verified primaries exempt.

Tested and rejected, with the evidence:

3. Pixel-space shape check in `isPlausibleDocumentDetection` — zero benefit
   on an 11-page A/B (byte-identical results), and it re-admits doc-seg
   interior panels on borderless crops. Kept normalized, documented in code.
4. Max-score / k=1 crop arbitration — churn: max-score changed identity ten
   times (five corrections, five regressions); k=1 hysteresis scored one
   regression and six strong-wrong at 0.72.
5. k=2 hysteresis — regression-free but obsoleted by the crop fix (2
   corrections available versus 16 pre-fix). Reserved as the arbitration
   rule for the future uncertain-only retry; not shipped.
6. Laplacian sharpness gate — non-predictive for binder identity errors
   (median 479 correct versus 490 wrong); errors are geometry, not blur.
7. Sobel/Hough outer-border proposals — 783 ms/attempt for 53/67 with five
   regressions, versus 12 ms for 61/67 from the fixed refinement. Dropped;
   the test-only implementation stays for reference.
8. Learned dewarping (UVDoc-style) — never built: a rigid card is a
   homography; survey and measurements agree nothing in the card space
   uses it.

Measured and validated, awaiting productization:

9. ORB geometric verification (the "stop fixing the crop" signal): correct
   card median 555 inliers (min 110) versus random-decoy max 53 across 187
   attempts with 1,870 label-free decoys; survives 0.8x-1.4x crop error and
   20% shift; auto-resolves 106 of 120 review-queue attempts with two
   verified identity corrections; verifies art, not printing (collector
   OCR stays the printing decider); 167 ms per 5-candidate attempt. SIFT
   tested worse (overlapping separation). Scope: uncertain-result-only
   post-shutter retry, threshold ~100 inliers + sane homography + 2x margin.
10. NCC verification re-rank: recovered 13 of 14 wrong top-1s whose true
    card appeared in any variant top-5; combined margin-gated policy scored
    59/67 with zero regressions. Blocked on bundling/caching reference
    thumbnails on device (art was fetched ad hoc; 4 of 378 IDs had none).

Policy and process decisions:

11. Stacked cards: single-card mode now identifies the front card (user
    decision, see above).
12. Simulator-divergence attribution must use a `git worktree` control at a
    pinned commit — a `git stash` control silently ran post-fix code here
    because a concurrent session committed the working tree mid-run.
13. Pocket art-reuse aliasing is now a repeat offender (`A2-105` at NCC
    -0.02; `A4-036` outscoring `bw1-25` at margin 0.018). The margin gate
    contains it; the index-side audit remains open.

Forward path, in value order:

1. Device build run of the binder + dev-mode replays: settles the learned
   corner head verdict (doc-seg contributed 0/67 on Simulator in either
   shape space — consistent with known Simulator/device Vision divergence),
   and retests the 15 allowlisted single-card frames and 11 binder floors.
2. ORB verification as the uncertain-only accept signal (evidence complete;
   no OpenCV dependency needed — ORB was the better and cheaper of the two
   feature families tested).
3. Manual corner handles, pre-populated from the verification homography's
   corrected corners, re-running identification on every edit (doubles as
   the ground-truth labeling mechanism).
4. Bundle reference thumbnails, then the NCC re-rank stage and the
   ANN-versus-NCC disagreement review flag.
5. Index audit for Pocket art-reuse aliasing.

Not done anywhere: no device runs this session (all Simulator); the ORB/NCC
stages are not in the app; the offline evaluator (`eval_policies.py`) lives
in session scratchpads only — regenerate evidence via
`testAcceptedBinderPolicyEvidence` and rescore (JSONL format documented in
the test).

## Session Results 2026-08-09 (21:29 correction/rotation export)

Archive: `TCGer-DevMode-All-20260809-212942.zip`. It adds two sessions:
16 single-card lighting/overlap captures at 21:09 and seven binder-page
captures plus manual correction events at 21:12.

### Single-card results

- The 21:09 session produced eight exact accepts and eight safe abstentions,
  with zero wrong accepts. Exact accepted IDs were `swshp-SWSH204` (2),
  `dp4-103`, `dp4-104`, `pl4-AR3`, `dpp-DP38`, and `dpp-DP30` (2).
- The abstentions are explainable from the pixels: severe glare/blur on
  Arceus V and Cresselia, two-card overlap on Giratina/Regigigas, and weak
  Arceus/Regigigas shots. This is the intended precision-first behavior.
- The known `ecard3-146` Charizard attractor appeared at 0.65 on an alternate
  Arceus-V attempt and 0.69 on the overlapping Giratina frame. Neither was
  accepted. This is fresh device evidence that the 0.72 plain-visual bar is
  blocking the earlier false-positive mode while clear attempts still pass.
- Current Simulator replay with all 15 single-card frames labeled produces
  10/15 exact, five abstentions, and zero wrong accepts. It recovers Arceus V
  frame 2, Arceus frame 9, and Regigigas frame 14, while the device-accepted
  Darkrai frame 7 is a documented Simulator Vision divergence. Net measured
  recall improves without a false accept.

### Binder corrections are now ground truth

Manual correction images are byte-identical to their originating
`frame-NNNN-attempt-N.jpg` crops. Hash matching recovered ten unique final
labels, and every corrected slot was originally `noCandidates`:

`dp4-41`, `xy3-56`, `pl3-83`, `ex13-18`, `pl2-49`, `pl1-28`, `pl2-28`,
`dp3-131`, `base4-45`, and `ecard1-33`.

Two crops contain correction history rather than separate cards. The final
event must win: Gardevoir ends at `dp3-131`; Alakazam was first labeled
`ecard1-1`, briefly marked no-match, then finalized as `ecard1-33`.

`ScannerCorrectionReplayTests` collapses identical crop bytes in event order
and replays the final labels through the full production coordinator. Current
Simulator result: 2/10 exact (`pl3-83` Skarmory FB and `ecard1-33` Alakazam),
8 safe abstentions, 0 wrong accepts. The Sharpedo crop is especially useful:
raw ANN top-1 is the correct `pl2-49` at 0.74, but the card-face gate is only
0.39-0.41 and footer OCR cannot read `49/111`, so production safely abstains.
Do not lower the gate; improve small/dark collector-number OCR.

The seven recorded binder pages contain 61 detections: 44 had a candidate,
14 were accepted, 30 were printing-ambiguous, and 17 were `noCandidates`.
Localization remains good; exact-print evidence and weak
vintage-card embeddings remain the limiting stages.

Unmodified current code replays those pages in Simulator at 43 candidates
and 17 matches. Pages `frame-0008.jpg` and `frame-0018.jpg` reproduce one
candidate below their device recordings, while `frame-0004.jpg` gains one;
this is another device/Simulator evidence divergence, not a production-code
regression. `BinderSessionReplayTests` now uses per-page Simulator floors for
those two pages and the recorded device count everywhere else.

### Rotation audit

- `CardCropper` perspective-corrects cards and rotates a landscape crop to
  portrait. Its quad/perspective path handles arbitrary in-plane angles, not
  only 90-degree turns, but geometry cannot determine whether printed content
  is upright or upside-down.
- `BinderPageScanner` still has a separate normalizer that can non-uniformly
  scale a landscape perspective result directly into 720x1000. Reusing
  `CardCropper` would remove that sideways-stretch mechanism at no extra
  embedding cost, but the full 19-page Simulator replay regressed from 107 to
  99 candidates across seven upright pages (matches changed 30 to 31). The
  production change was reverted. Existing archives contain no sideways binder
  cards, so first add physical sideways fixtures, then design a binder-specific
  normalizer that preserves the current upright crop pixels.
- Camera orientation remains a separate coordinate-space risk. Live video is
  fixed to 90 degrees, while preview and photo-output connections are not kept
  in an explicitly synchronized interface-orientation mapping. The guide crop
  assumes their pixel and preview spaces agree. Validate portrait, both
  landscapes, and iPad upside-down on a device before changing this path.
- Photos and shutter JPEGs apply EXIF through Image I/O thumbnail transforms.
  Replay/reference loaders use raw `CGImageSourceCreateImageAtIndex`; an image
  whose rotation exists only in EXIF can therefore diverge from Photos. Add a
  shared decoder and EXIF 1-8 asymmetric-corner fixtures.

### Rotation experiments: cardinal and arbitrary angles

`ScannerOrientationExperimentTests` now separates three questions: raw input
rotation, production portrait-geometry normalization, and a test-only
abstention-gated semantic 180-degree retry.

- On ten deduplicated final correction labels, upright raw and normalized
  results were both 3/10 exact top-1, 6/10 top-5, one strong exact, one strong
  wrong, and eight below the 0.72 strong threshold.
- Production normalization maps one sideways direction back to the upright
  baseline. The opposite direction and a 180-degree input remain semantically
  inverted: 1/10 exact, 2/10 top-5, zero strong exact, one strong wrong.
- The test-only 180-degree retry recovered the simulated inverted variants but
  did not improve the real upright baseline and retained its strong wrong.
  It required 34 extra embeddings and 76.7 seconds of Simulator embedding time
  in this diagnostic. Do not ship this retry from the current evidence.
- A representative strongly recognized real crop was placed in synthetic
  1200x1600 camera scenes at +/-15, 30, 45, 60, and 75 degrees, with mild
  perspective at +/-30 and 60. Card detection and normalized cropping both
  succeeded in all 28/28 scenes, all through direct quadrilaterals with no
  axis-aligned fallback. This confirms that the main path handles weird angles.
- Upright flat scenes were strong/exact at 8/10 angles and perspective scenes
  at 3/4, with zero strong wrongs. The failures were +60 and +75 (and +60 with
  perspective). Semantic-180 inputs showed the inverse success at those steep
  positive angles. The crop geometry succeeds, but Vision corner ordering plus
  the unconditional landscape `.right` turn can select the opposite portrait
  direction. This is the next focused geometry experiment; it is not evidence
  for accepting the maximum score across rotations.

The experimental harness supports one labeled frame by default,
`ORIENTATION_EXPERIMENT_FRAME` for a chosen crop, and
`ORIENTATION_EXPERIMENT_GEOMETRY_ALL_LABELS=1` for the slower all-label
arbitrary-angle matrix.

### `/Volumes/Main/Scanner` ideas worth carrying forward

The local `METHODS_ANALYSIS.md` already catalogs 29 scanner repositories.
The most relevant patterns for this app are:

- OpenSorts compares upright and 180-degree embeddings. Spell Coven generates
  all four orientations, but that is four sequential encoder calls and no
  orientation tests were found. Once a quad is normalized to portrait, only
  0/180 remain distinct; keep four-way evaluation offline.
- CardReaderLibrary tries three OCR thresholds at both 0 and 180 degrees and
  chooses the OCR-confidence winner. TCGer can trial title/collector evidence
  as an orientation verifier after abstention, without letting it bypass the
  gate, ambiguity policy, or exact-print safeguards.
- Pokemon-Card-Scanner precomputes transformed reference hashes. Its supposed
  "four orientations" are actually identity, horizontal mirror, vertical
  flip, and mirror+vertical flip; only the last is a 180-degree rotation. The
  useful idea is an offline 180-degree reference index if on-device retry
  latency proves too high, not copying those transforms literally.
- Spell Coven and the MTG sorter use Laplacian sharpness/motion stability.
  A calibrated quality signal could ask the user to hold steady or retake a
  frame without altering embedding pixels.
- RiftBound uses YOLO OBB, full-resolution crops, and synthetic rotation,
  glare, shadow, JPEG, vignette, and distractor augmentation. TCGer already
  has the stronger detector path; the transferable idea is augmentation for
  reference/model training and always cropping from the highest-resolution
  source.
- The MTG sorter combines pHash, HSV, and geometric feature verification.
  For TCGer, a second visual verifier should rerank an ANN shortlist only;
  it must not bypass the gate/printing safeguards.

Primary-source cross-checks point to the same separation of concerns. Apple's
[Vision still-image guidance](https://developer.apple.com/documentation/vision/detecting-objects-in-still-images)
states that Vision assumes upright input and that `CGImage`, `CIImage`, and
`CVPixelBuffer` do not carry orientation, so callers must supply or bake it.
PaddleOCR ships a dedicated
[0/90/180/270 document-orientation classifier](https://github.com/PaddlePaddle/PaddleOCR/blob/main/docs/version3.x/module_usage/doc_img_orientation_classification.en.md)
rather than expecting OCR to infer orientation implicitly. TCGer should not
add that model yet; it is evidence that semantic orientation is its own stage,
after arbitrary-angle localization and perspective correction.

Next measured work: test a short-edge/corner-ordering rule at steep positive
angles, then capture real arbitrary-angle, 90-degree, and upside-down single
cards and binder pages with glare. After that, calibrate collector OCR and blur
guidance and consider perspective/foil reference augmentation. Keep the 0.72
acceptance bar and 0.82 binder auto-match bar unchanged.

## Session Results 2026-08-09 (19:12 lighting/foil export)

The newest export contributed 29 labelable single-card shots and five binder
pages. Repeated shots plus visible titles/collector numbers establish exact
ground truth for every single-card frame; the replay harness now carries those
labels and excludes binder pages, which belong in `BinderSessionReplayTests`.

- At the old 0.70 plain-visual bar, current Simulator replay produced 13/29
  correct, 14 safe abstentions, and two wrong accepts: Primeape became
  `sm3-23` Simisear and Cresselia became the known junk attractor
  `ecard3-146` Charizard. At 0.72 it kept the same 13 correct and changed both
  wrong accepts to abstentions. Exact collector OCR remains eligible from the
  0.55 evidence floor.
- The completed canonical 50-image run at 0.70 was 18 accepted, 16/16 labeled
  accepts exact, and zero wrong printings. Its weakest plain correct accept was
  0.742; the only lower correct result (0.691) was OCR-confirmed. This supports
  0.72 without sacrificing any measured plain correct accept. A second full
  corpus run at 0.72 hit a Simulator/Xcode lifecycle hang and produced no
  report, so do not describe that run as passing.
- Crop-level lighting experiments rejected global preprocessing. Baseline was
  16/29 top-1 and 9 strong correct; exposure reduction fell to 13/29,
  highlight compression fell to 13/29 and introduced a strong wrong result,
  sharpening reached 17/29 but added no strong correct result, and the combined
  filter was 15/29 with a strong wrong result. Keep embedding pixels ungraded.
- New binder pages replay at 7-9 detections per page. Current Simulator replay
  moved candidates 24 -> 22 and matches 4 -> 5; the quads are visually sound.
  The dominant bottleneck is exact-printing evidence (20 recorded
  `printingAmbiguous` attempts), not localization or a global lighting filter.

Next levers: perspective/foil augmentation of reference embeddings, exact
collector OCR for binder crops, and cross-shot aggregation. Do not lower the
gate or acceptance bar to recover glare/blur frames.

## Session Results 2026-08-09 (the evidence-loop sessions)

One long working day, five pushed commits (`9dcfc8be`, `43017cbe`,
`cba75988`, `48ef8509`, `993cadf4`) plus in-flight work. The theme: build the
instrumentation to capture real device evidence, then let that evidence drive
every fix. Full analyses live in
`docs/scanner-import-path-and-detector-2026-08-09.md` (import path + detector
migration) and `mobile-apps/ios/TCGer/SCANNER_TESTING.md` (how to run
everything); this section is the map plus the decisions and their reasons.

### Architecture changes a new model must know

- **`ScanInvocationKind` has three cases.** `.photoCapture` = camera shutter
  (guide-cropped), `.importedPhoto` = photo library / Test Photo / fixtures,
  `.livePreview`. Only the shutter path is `.photoCapture`. The distinction
  exists because a borderless card image defeats every geometric test (an
  iPhone 3:4 photo is inside the card aspect band).
- **The embedding strategy is multi-hypothesis with retry-on-abstain**
  (`BoardCardEmbeddingScannerStrategy.makeCropAttempts`): best detected crop,
  the detector's plain axis-aligned box when corner refinement supplied the
  primary quad, and the normalized whole frame (non-live sources only) —
  ordered by card-face gate score, tried until one accepts. Retries are
  recall-only by construction: an accept returns immediately and every
  attempt faces the full gate/OCR/threshold policy. Non-baseline attempts
  need `strongAcceptanceScore + 0.02` (OCR-verified exempt) because a
  measured 0.707 wrong accept of an out-of-index card arrived via a retry
  attempt.
- **The detector is YOLO11s** (`CardDetector.mlpackage`, 18 MB, ultralytics
  8.4 → Core ML NMS export, trained on the tight-crop-augmented corpus on a
  Colab L4). Consumed unchanged by `CardObjectDetector` (Vision, "card"
  label, conf ≥ 0.50, scaleFit). Replay: 99.9% localized, 97.9% IoU≥0.50,
  95.3% IoU≥0.75 (Create ML predecessor: 90.3%/72.7%). Borderless fixtures
  get full-frame boxes at 0.97+; the two-card composite gets one box per
  card. Vision-level scoring of any candidate model without an app build:
  `mobile-apps/ios/scripts/evaluate-card-detector.swift MODEL split-dir...`.
- **Corner refinement second chance** (`CardCropper.refinedObservations`):
  full-frame Vision doc-seg/rectangles return nothing for steeply angled
  cards, and the axis-box fallback crop embeds ~0.1 below the accept bar
  (same physical cards measured 0.79–0.93 flat vs 0.55–0.64 angled). Corner
  detection re-runs inside the padded detector box; the plain box is KEPT as
  an alternate attempt because a wrong refinement once lost a card the box
  crop caught. `CardCropper.refinedQuad(in:around:)` is the per-box public
  entry used by the binder scanner.
- **Binder pages are detector-first** (`BinderPageScanner.detectCardQuads`):
  YOLO boxes + per-box corner refinement; the legacy rectangle harvest
  (which returned attack text boxes, card backs behind pockets, sleeve
  fabric — 52/77 dead detections on the first device binder session) remains
  only as fallback. Duplicate suppression is overlap-over-SMALLER-area with
  larger quads winning — pocketed cards cannot overlap, and a fragment
  nested in a full-card quad has near-total containment but tiny IoU, which
  the old IoU test never caught. Measured on recorded pages: candidates
  19→48, auto-matched 3→9.
- **Binder shutter captures are guide-cropped** (uncommitted at writing):
  they previously processed the raw sensor frame while the guide said "Fit
  the full binder page" — user-visible mismatch and ~half the pixel density
  per card. The uncropped photo is preserved in dev-mode recordings.
- **OCR upgrades**: letter-prefixed promo collector codes
  (`CollectorNumberOCR.extractPromoCodes`, "SWSH204"/"DP38" → normalized
  "swsh204"/"dp38") — the promo class was structurally unconfirmable before
  and this is verified working on device. Gate false negatives on intentional
  captures can also be overridden by exact-title match AND a
  threshold-clearing visual score (gate measured 0.29–0.47 on legitimate
  hand-held cards; do NOT lower the 0.45 gate threshold instead — carpet
  measures 0.42).

### Dev mode: the evidence loop

`ScannerDevModeStore` + `ScanDiagnostics` record every scan (live, shutter,
import, binder) while the Settings toggle is on: raw input, original sensor
photo for shutter captures, every crop-attempt image with quad, gate score,
top-5 ANN candidates, OCR readings, and a per-attempt outcome enum that makes
abstentions attributable to a stage. Sessions are written in the
device-recording schema (`results.json` + frames) with an `evidence.json`
sidecar, so they browse in Reference Sets, replay, and export for labeling
with zero new tooling. Tester flow: 7 taps on Settings→About→Version unlocks
developer tools; Export All Sessions ships one zip.

Replay harnesses (both env-gated via `TEST_RUNNER_DEVMODE_SESSIONS_DIR`
pointing at an unzipped export):

- `DevModeSessionReplayTests` — single-card frames vs recorded device
  decisions; fails on new false accepts or newly-lost accepts.
- `BinderSessionReplayTests` — binder pages vs recorded baseline; writes
  per-page quad overlays to `/tmp/binder-replay-overlays/`.

**Simulator Vision ≠ device Vision** for doc-seg/rectangles: some recorded
device outcomes do not reproduce in the Simulator on identical code (known
allowlist in the tests). Device-level conclusions need a device build; the
harnesses measure change-vs-baseline, not absolute device truth.

### Measured decisions (do not silently revert)

- Crop candidate ties break by shoelace quad area, not Vision confidence
  (everything ties at 1.00); measured neutral on the 2,336 scene corpus.
- Fixture `minimumConfidence` floors = 0.72 (production bar), two-cards =
  `top5Any` at 0.55 (OCR-verified route).
- Aspect-ratio guards on the detector's axis-aligned box are harmful (a
  rotated card is near-square in its box): one such guard cost 524
  localizations before being reverted.
- The 2,336-image replay is the precision gate: it caught both the harmful
  shape guard and the retry-attempt wrong accept. Run it for any change
  touching crops, thresholds, or the strategy
  (`TEST_RUNNER_ROBOFLOW_REPLAY_DIR`, env vars must be ON xcodebuild, not
  trailing args — trailing args become build settings and the test silently
  skips).
- Latest replay state: 18/50 accepted, 16/24 exact printings, 0 wrong,
  including the long-abstaining same-art Dark Weezing base5-14.

### Where everything lives

- Datasets/replay: `~/Downloads/Reference/TCGer-Scanner-Datasets/` (docx
  paths without `Reference/` are stale). Device dev-mode sessions staged at
  `~/Downloads/Reference/TCGer-DevSessions/`. YOLO training pipeline:
  `scripts/prepare_createml_card_detector.py --tight-crops` →
  `scripts/createml_to_yolo.py` → ultralytics on GPU → Core ML NMS export
  (Colab notebook `Untitled2.ipynb` + artifacts in Drive
  `TCGer-detector/`). Legacy on-Mac Create ML trainer leaks ~30 MB per
  iteration into `$TMPDIR/CreateMLModels` — clear it and keep ≥25 GB free.

### Open items / monitoring

1. `ecard3-146 Charizard` is a junk attractor: cluttered whole-frame crops
   repeatedly retrieve it top-1 at 0.56–0.65. Never accepted so far; watch
   it in future session exports.
2. Binder vintage commons cluster at 0.71–0.82 against the 0.82 auto-match
   bar (`BinderPageScanner.Configuration.matchedScore`); revisit with
   post-guide-crop device data before touching the bar.
3. Steep-angle residuals (0.55–0.69 on extreme foreshortening) are an
   index-side problem — perspective augmentation of reference embeddings is
   the lever, not thresholds.
4. Cross-shot aggregation for repeated binder-page captures (same card
   swings 0.73–0.85 across shots of the same page).
5. Physical-device acceptance items from the scanner report remain (ANE
   latency for YOLO11s measured healthy: 74–780 ms warm scans on iPhone).

## Session Results 2026-08-08 (iOS "scanning doesn't work" diagnosis)

Context: the shared Drive folder (`pokemon/`) holds the generated iOS scanner
assets — `CardsIndexVectors.bin` + `CardsIndexMetadata.json` (built Aug 4),
the older Apr-4 perceptual-hash `index.json`, and `images/` = the card catalog
webp images per set. These were verified and benchmarked offline (Linux, no
device) by reproducing the pipeline in Node with `onnx-community/dinov2-small`
via transformers.js — the exact encoder + processor the index was built with.

Verification results (18 catalog images across A1/base1/bw1 vs the Drive
21,828 × 384 int8 index):

- Index is HEALTHY. Exact web-parity preprocessing → 18/18 top-1 self
  retrieval at mean sim 0.9935. Bin header, metadata alignment, and set
  coverage (all 50 Drive image sets present) all check out.
- fp32 vs q8 encoder weights: mean top-1 sim 0.9836 vs 0.9935 — the CoreML
  (fp) vs web (q8) weight difference is NOT a problem.
- Squash-resize to 224×224 (no shortest-edge-256 + center-crop): mean sim
  collapses to 0.862 with wrong top-1s ON CLEAN CATALOG IMAGES. The
  256→center-crop-224 geometry in `CardEmbeddingEncoder` is load-bearing;
  never regress it.
- Simulated camera conditions (2° rotation, 360px, mild blur, JPEG68,
  brightness lift): 12/18 top-1, and wrong cards DO score above the 0.70
  accept line (0.72–0.77). The OCR tiebreak + ambiguity margin + 2-frame
  consensus are what stand between this and wrong labels — they matter.
- The iOS crop color grade (CIExposureAdjust +0.1EV + CIColorControls
  sat 1.05 / contrast 1.1 / brightness −0.02 in `CardCropper` and
  `BinderPageScanner`) cost a further 2/18 top-1 under camera conditions and
  flipped several results to wrong cards. Both indexes (embedding + artwork
  fingerprint) are built from UNGRADED catalog images. REMOVED this session —
  contrast-style ops stay OCR-only, consistent with the 2026-07-02 finding.
- Artwork fingerprint strategy (5% art + 95% HSV, min 0.90): 18/18 on clean
  catalog images (its own training distribution) but 10/18 under camera
  conditions with almost every score UNDER its 0.90 floor — on a real phone
  it mostly abstains. It previously ran at priority 0 for Pokémon and
  short-circuited the embedding pipeline on clean frames while carrying no
  OCR verification or ambiguity guard. Priority swapped this session:
  Pokémon now runs `.mlDetector` (embedding) first, fingerprint as fallback.

Root-cause candidates for "scanning does nothing" on device, in order:

1. MISSING GENERATED ASSETS. `CardEmbeddings.mlpackage`, the index bin, and
   metadata are gitignored build outputs; when absent the embedding strategy
   sets `supports() == false` and disappears SILENTLY, leaving only the
   fingerprint matcher (which abstains on most camera frames) and server
   strategies (absent in phone-only mode). Note the Drive folder contains the
   two index files but NO CoreML model — if the .mlpackage is also absent
   from the local build, this alone explains a scanner that never matches.
   NEW this session: `ScannerAssetDiagnostics` + a "Scanner Assets" pane in
   ScannerDebugView show exactly what the installed bundle contains, and the
   capture-photo error now names the missing files instead of the generic
   "not available yet".
2. Crop color grade breaking parity (fixed, above).
3. Fingerprint short-circuit hiding the verified pipeline (fixed, above).

Packaging decision 2026-08-09: all scanner assets stay bundled in the app for
now; R2 delivery is planned later with the artwork fingerprint database as
the first asset to move (then the index; the CoreML model stays bundled).
Rationale and migration order: `docs/scanner-asset-packaging.md`.

Per-game fingerprints 2026-08-09: the artwork fingerprint database is now per
game — `artwork-fingerprints-<TCGGame.rawValue>-uint8.json` (Pokémon's file
renamed accordingly), bundle first then Documents, legacy filename still
honored via its own `tcg` field. Loading is lazy per game on first scan
(previously the ~53 MB JSON parsed eagerly at scanner init for every game).
To add a game: run backend `build-artwork-fingerprints.ts` for it and drop
the output in `CardScanner/Resources/` under the per-game name — no code
changes needed.

OPEN ITEM — gate fallthrough: when `CardFaceRejectionGate` rejects a crop as
non-card, the embedding strategy returns nil and the coordinator falls
through to the artwork-fingerprint strategy, which has NO card-face check —
so a rejected pack/hand/card-back can still be named by the HSV matcher if
it clears 0.90. Proposed fix: a distinct "non-card detected" signal (e.g.
`CardScannerError.nonCardDetected`) that stops local matchers for that frame
while plain no-match keeps falling through. Not yet implemented (awaiting
go-ahead).

ROOT CAUSE CONFIRMED 2026-08-09: the app is built by Xcode Cloud on push,
from a fresh clone — and the ScanIndex model/index were gitignored, so no
cloud build ever contained them; the pre-build guard only warns by default.
Every TestFlight install shipped a scanner with no embedding model/index.
Fixed by tracking `CardEmbeddings.mlpackage` (rebuilt this session on Linux,
verified 18/18 top-1 @ 0.970 mean sim against the index), the index bin, and
metadata in git. Do not move them to LFS (Xcode Cloud can't resolve it).

Still to do on a real device: run the Scanner Assets pane, confirm all green;
if the model is missing, `bash scripts/ios-assets.sh build` (needs the
py3.11 coremltools venv) and rebuild. Then re-test live scanning — and feed a
few real phone captures back into the replay tooling so camera-condition
numbers replace the synthetic ones above.

Offline repro scripts (scratchpad, not committed): embed Drive catalog images
with transformers.js, query the int8 index, compare exact/fp32/graded/squashed
variants, and a JS port of the fingerprint+HSV matcher. Rebuild them from this
description if needed — or just re-run `eval-recognition.ts` paths.

## Session Results 2026-07-01

Headline: the recognition pipeline is far better than the old benchmark said.
The v1 ground-truth fixture was systematically misaligned; 16/16 sampled
"wrong" labels were verified frame-by-frame to be CORRECT scanner output,
usually down to the exact collector number.

Benchmark (Sinnoh video, 10s sampling, scored against ground truth v2 with
`--tolerance-seconds 5`, jumbo excluded):

| run | crops | gate | coverage | top-1 name | committed-label precision |
|---|---|---|---|---|---|
| baseline | 640px frames | off | 73.7% | 27.6% | 22/26 = 85% |
| gated | 640px frames | 0.45 | 73.7% | 27.6% | 22/26 = 85% |
| gated + full-res | 1080p frames | 0.45 | 85.5% | 35.5% | **31/31 = 100%** |

Key takeaways:

- Crop resolution was the dominant error source. Cropping from the full-res
  frame (detect on 640, crop from source) removed every misidentification
  (Morpeko V -> Pikachu ex/Pachirisu ex, Furfrou -> Shiftry were 640px-crop
  confusions).
- The rejection gate (logistic head on the existing DINOv2 embedding) rejects
  ~66% of junk crops at 98.7% card-face recall on held-out video time. It did
  not change top-1 on this video (all above-threshold errors were real card
  faces), but it kills junk before retrieval and is the open-set safety net.
- Low top-1-per-window is now mostly a sampling artifact: most reveal windows
  are ~4s, so 10s sampling misses them entirely. Per-observation precision is
  the honest runtime metric.
- ffmpeg `fps=1/N` sampling has a phase offset of up to ~4s between different
  N. Ground-truth windows are padded and the evaluator has
  `--tolerance-seconds` for this. Do not compare runs at different sample
  rates without tolerance.

New artifacts and scripts (all in this repo):

- `backend/fixtures/video-ground-truth/sinnoh-first-partner-pack.ground-truth.v2.json`
  — rebuilt evidence-based ground truth: 79 windows (76 scored, 3 jumbo),
  each tagged `verified-frame` (human/agent eyeballed the frame) or
  `proposal` (pipeline-confident, sim >= 0.75). v1 kept for history; USE V2.
- `backend/src/scripts/build-video-crop-dataset.ts` — auto-labeled crop
  dataset from a video + ground truth (card-face / negative / uncertain by
  window membership; ~650 crops from the Sinnoh video at 2s sampling).
- `backend/src/scripts/train-rejection-gate.ts` — trains the card-face gate:
  class-balanced logistic regression on the L2-normalized DINOv2 embedding,
  time-based train/val split, threshold table + recommendation.
- `backend/fixtures/models/card-face-rejection-gate-dinov2.v1.json` — trained
  gate artifact (384-d weights + bias + recommendedThreshold 0.45). Runtime
  cost: one dot product. Portable to web and iOS as-is.
- `backend/src/scripts/propose-video-ground-truth.ts` — dense full-res gated
  pipeline pass that groups confident identifications into draft ground-truth
  windows with per-window evidence frames (labeling tool, uses tfjs-node).
- `live-video-stream-scan.ts` new flags: `--gate <artifact>`,
  `--gate-threshold <x>`, `--full-res-crops`.
- `eval-video-stream.ts` new flag: `--tolerance-seconds <n>`.
- `docs/benchmarks/2026-07-01-sinnoh/` — the three eval reports above.

Reproduce the best run:

```bash
cd /Users/ahmadjalil/github/TCGer
# serve the YOLO model (any static server on 3003 works)
(cd frontend/public && python3 -m http.server 3003 &)

npm --prefix backend run scan:video-live-stream -- \
  --video "/Users/ahmadjalil/Downloads/YTDown_YouTube_Sinnoh-Pokemon-TCG-First-Partner-Pack-Op_Media_wH1JUdnkKHA_001_1080p60.mp4" \
  --sample-seconds 10 \
  --gate backend/fixtures/models/card-face-rejection-gate-dinov2.v1.json \
  --full-res-crops \
  --out-dir /tmp/tcger-live-fullres

npm --prefix backend run eval:video-stream -- \
  --ground-truth /Users/ahmadjalil/github/TCGer/backend/fixtures/video-ground-truth/sinnoh-first-partner-pack.ground-truth.v2.json \
  --results /tmp/tcger-live-fullres/live-stream-results.json \
  --exclude-tags jumbo --tolerance-seconds 5 \
  --out /tmp/tcger-live-fullres/eval-report.json
```

Gotchas found this session:

- npm scripts run with `backend/` as cwd; relative `--ground-truth` paths in
  the older examples below resolve wrong. Pass absolute paths.
- `@tensorflow/tfjs-node` breaks on Node >= 23 (`util.isNullOrUndefined`
  removed); offline tools shim it (see build-video-crop-dataset.ts). Never
  needed for runtime code.
- tcgdex names differ from card wording in places ("Castform Rain Form" vs
  "Castform Rainy Form") — ground truth uses `acceptedNames` for aliases.

Highest-leverage next steps — ALL SHIPPED later the same day (session 2):

1. DONE — full-res cropping in the browser scanner. `extractCardCrop` takes a
   `sourceScale`; `processYoloWithEmbedding` captures a 1920px copy of each
   frame at the same instant as the 640px detection frame and crops
   embedding/OCR inputs from it (`CROP_FRAME_SIZE`). The sharpness gate
   downsamples to 96px internally, so its calibration is unaffected.
2. DONE — rejection gate wired into web AND iOS.
   - Web: artifact served as `/scan-index/card-face-gate.json` (service worker
     already caches that path). `embedding-matcher.ts` exports
     `ensureCardFaceGate` (null on missing artifact or encoder/dimension
     mismatch → gating disabled, never rejects) + `scoreCardFaceGate`;
     enforced in `matchDetectionEmbedding` before top-K (skip label
     `yolo-nonface`, outline still shown).
   - iOS: `CardScanner/Embedding/CardFaceRejectionGate.swift` loads bundled
     `Resources/ScanIndex/CardFaceGate.json`; `BoardCardEmbeddingScannerStrategy`
     returns nil for gated crops. Simulator build green, artifact verified in
     the .app bundle.
   - NOTE: the web runtime copy remains gitignored. The iOS
     `Resources/ScanIndex/CardFaceGate.json` copy is now tracked and bundled so
     clean clones retain rejection gating. The canonical fixture remains
     `backend/fixtures/models/card-face-rejection-gate-dinov2.v1.json`; the iOS
     asset pipeline verifies that the bundled JSON matches it.
3. DONE — dense-sampling benchmark. `live-video-stream-scan.ts` gained
   `--native-backend` (tfjs-node, accuracy runs only). 3s sampling + full-res
   + gate on the Sinnoh video: coverage 85.5% → **98.7%** (75/76 windows),
   top-1 name 53.9%, per-observation precision 87.9% (91 committed). The new
   wrong labels are one-frame transition misreads; simulating the doc's
   temporal rule (same name ≥2 observations within 9s) on the same results
   gives **100% precision (50/50)**. At browser frame rates (~2-5 fps
   effective vs 0.33 here) the 2-frame rule costs almost no coverage — the
   offline 17% coverage under the vote is purely a sparse-sampling artifact.
   Report: `docs/benchmarks/2026-07-01-sinnoh/gated-fullres-3s.eval-v2-tol5.json`.
4. DONE — twin-print OCR: slash-less digit-run recovery. Real-video finding:
   Tesseract reads the Morpeko V footer as "0079202" (= 079/202 with the
   slash dropped), so the strict NNN/NNN pair rule abstained on every frame.
   New conservative fallback in `collector-ocr.ts` (`runs` on OcrReading +
   fusion), `eval-recognition.ts`, and iOS `CollectorNumberOCR.swift`
   (`readFooter`, `extractDigitRuns`, `runsConfirm`): a 5-8 digit run counts
   only if it is exactly `0-padded collector number + 2-3 digit denominator`
   for EXACTLY ONE distinct shortlist number (ambiguity → abstain). Validated
   on full-res Morpeko V crops: 4/6 frames resolve to the verified-correct
   swsh1-79, zero false promotions, noisy reads abstain
   (`eval-recognition.ts` metrics: ocrMatchedRate 0 → 0.5, exact-print top-1
   2/9 → 4/9 on that set).

Sampling-rate finding (user-driven, 2026-07-01 late): cards in this video are
on screen ~1.5-2.5s each during pack flips. At 2s sampling a card can land
entirely on its transition frames (Sinistea at ~203s was missed this way; a
0.5s rescan identifies it at 0.83 plus three more pack-1 cards every slower
pass missed: Fire Energy, Dubwool, Lucky Egg — all now in GT v2). Rule of
thumb: offline benchmarks of pack-opening content need >= 1 fps sampling; the
live browser scanner is busy-loop paced (~2-5 fps effective) and is not
affected. `--start-seconds/--end-seconds` on live-video-stream-scan.ts make
segment rescans cheap.

Miss taxonomy (from the scan-review sessions, 2026-07-01 late — every missed
card in the Sinnoh video falls into one of three classes):

1. Threshold-line misses — correct card IS top-1 but sits just under 0.72
   (Chinchou 0.715, energies/trainers 0.63-0.68). Recoverable: more frames,
   or the verified path (>=0.65 + OCR agreement).
2. Single-frame policy suppression — model right, smoothing hid it (Yamper,
   Sinistea, Metal Energy). Fixed by print-consensus confirmation (top-2
   candidates same name = self-confirming single frame); note an
   evolution-line neighbor as #2 (Swirlix/Slurpuff) defeats consensus.
3. Hard embedding failures — correct card not even in the top-20 shortlist,
   so OCR fusion cannot rescue it (Galarian Yamask swsh6-82: dark art +
   glare band → rank 46 @ 0.597 on a clean manual crop; index entry itself
   verified healthy). Only fixes: a glare-free frame, glare/dark
   augmentation at index build time, or a title-band OCR recognition path
   independent of the embedding.

Perspective rectification (2026-07-02, "what people do online" applied):

- The benchmark harness now exposes `--rectify-mode none|rescue|always`;
  `--rectify` remains an alias for `rescue`. See
  `docs/manabox-inspired-geometry-experiment.md` for the decision, test matrix,
  metrics, and promotion gates.

- `backend/src/scripts/card-rectify.ts` — pure-TS quad refinement + homography
  warp: Sobel edge scan per side -> RANSAC line fit (median rejection is NOT
  enough; fingers create contiguous outlier blocks) with 30-degree orientation
  constraint -> per-side detector-box fallback (max 1 side) -> DLT homography
  -> bilinear warp to a flat 480px card.
- Measured on the full Sinnoh video (1s sampling, GT v2 = 94 windows, tol 5):
  - plain full-res crops:        275 committed, 93.8% precision, 85/91 windows
  - BLANKET rectification:       252 committed, 91.7%, 81/91 — NET NEGATIVE
    (warping already-good crops shifts sims; a holo Slowking started misreading)
  - RESCUE CASCADE (`--rectify`): 287 committed, 93.0%, **87/91 windows,
    zero windows lost** — plain crop first, warp only when top-1 fails the
    threshold, keep whichever scores higher (65 rescues fired).
- Contrast standardization measured HARMFUL for the embedding path
  (normalise/CLAHE moved a hard case from rank 46 to rank 278-313; catalog
  ranks unchanged on good crops). Keep contrast ops OCR-only.
- Title-band OCR feasibility PROVEN for the dark-art class: Tesseract reads
  "Basic, Galarian Yamask w60" verbatim off the rectified crop's title band.
  The embedding-independent title fallback is the remaining rescue to build.
- Still missed at 1 fps after cascade (4/91): Chinchou (0.70-0.72 line),
  Energy Retrieval (0.69), Galarian Yamask (dark+glare, rank ~1 after rectify
  but ~0.61), Slowking-recap (fast flipping). All are title-OCR-rescuable.

Technique survey round 2 (2026-07-02, user-driven):

- Statistical acceptance (Magic Card Detector's 4-sigma rule) — TESTED, does
  NOT transfer to DINOv2 cosine distributions: z-scores of junk (2.5-2.8) and
  wrong matches (2.75) interleave with good matches (2.6-3.5). Fixed
  threshold + gate stays. (z/margin could still be gate-v2 features.)
- Track-level embedding averaging — TESTED offline, strong WHEN fused with
  rectification and track purity: Energy Retrieval rank 23 -> 1, Morpeko V
  rank 239 -> 2 (twin print), Spheal +0.055. Does not fix all-frames-glared
  (Yamask) or mixed-card windows. PORTED TO BROWSER: `EmbeddingTrackAverager`
  in use-video-scan-processor.ts (spatial-bucket tracks like the OCR voters,
  sliding window 5, mean-normalized query once >=2 frames) + the rescue
  cascade via `frontend/src/lib/scan/card-rectify.ts` (copy of the backend
  module — keep in sync). Production build passes. The offline harness
  remains per-frame (no tracker), so browser recall should now EXCEED the
  benchmark numbers.
- Still on the shelf, in rough priority: art-crop fallback index (occluded
  cards; Magic detector future-work + our old artwork pipeline), ArcFace-style
  fine-tuned embedding (Ximilar's approach — GT v2 + crop dataset now provide
  the training data), rotation TTA in the cascade (for upside-down cards in
  live use), alpha-QE query expansion (margin-gate it: blurs twins).

Title-band OCR fallback (2026-07-02) — **100% window coverage reached**:

- `backend/src/scripts/title-ocr.ts` + `--title-ocr` on the harness: when the
  cascade still fails on a gate-approved card face, OCR the title band
  (top 2-12% of the rectified/plain crop, 3x upscale), match the longest
  index card name contained verbatim in the collapsed text, then let the
  embedding pick the PRINT within that name's entries (restricted re-rank —
  reliable even when the global rank is not; sanity floor 0.45).
- Full Sinnoh video (1s, GT v2 = 94 windows): **91/91 scored windows
  identified (100%)**, up from 87/91 with the cascade alone; the 4 gains are
  exactly the prior misses (Chinchou, Energy Retrieval, Galarian Yamask,
  Slowking-recap), 14 title-OCR observations, zero windows lost. Report:
  `docs/benchmarks/2026-07-02-sinnoh-rectify/full-1s-titleocr.eval-v2-tol5.json`.
- PITFALL FIXED: Stage-1/2 cards print "Evolves from <pre-evolution>" under
  the title; when OCR reads that line but misses the stylized title, the
  pre-evolution matches (observed: Slurpuff -> "Swirlix" x3). matchTitleText
  strips `evolvesfrom<name>` before matching.
- GOTCHA: terminate the Tesseract worker (`terminateTitleWorker`) or the
  Node process never exits.
- NOT yet in the browser: title-OCR port needs a letters-whitelist Tesseract
  worker beside the digits one in collector-ocr.ts, plus the name index
  (entries are already client-side). Basic-energy cards have no collector
  number AND single-word names shorter than the 6-char floor ("Fire Energy"
  passes; bare "Potion" would not) — keep the floor, it is the false-positive
  guard.

Remaining follow-ups:

- Real-camera validation on a physical iPhone (still never done — no device).
- Web/iOS preprocessing parity (resize-256+crop vs resize-224) is still the
  known top-1 gap on iOS; see earlier session notes.
- Grow the crop dataset + retrain the gate on new eval videos (one command
  each: build-video-crop-dataset.ts → train-rejection-gate.ts). If the
  embedding model ever changes, the gate MUST be retrained (loaders check
  model/dimension and disable gating on mismatch).
- Browser track layer already accumulates per-track evidence; consider making
  the 2-frame same-name agreement an explicit surfacing rule in
  `video-scan-tracks.ts` to match the measured 100%-precision policy.

## Purpose

This document is for an AI agent or engineer building, replacing, or testing
TCGer card-scanning models. It explains the current scanner shape, where card
metadata comes from, how to run video/live-scan evaluations, and the constraints
that matter for web and iOS.

The goal is not just to identify one clean card image. The goal is live scanning:
detect card-like objects in video frames, reject non-card crops, recognize real
card faces conservatively, and only surface a card label after enough temporal
evidence.

## Current Diagnosis

The embedding model is not the main runtime bottleneck. The main risks are:

- YOLO runtime selection on web. A CPU fallback is too slow for live scanning.
- Open-set recognition. Packs, backs, tins, hands, backgrounds, and bad crops
  must not be forced to the nearest card.
- Confidence calibration. Margin-only acceptance causes false labels.
- Temporal instability. One-frame guesses should not be shown as final labels.
- iOS parity. The iOS scanner should stay native SwiftUI/CoreML/Vision, not a
  WebView wrapper.

The desired behavior is:

- high-confidence cards get names
- weak detections show "card detected"
- bad/non-card crops are rejected
- labels require repeated agreement across frames

## Key Repositories And Services

Main app repository:

- `/Users/ahmadjalil/github/TCGer`

Infrastructure/GitOps repository:

- `/Users/ahmadjalil/github/personalprox`

The production-like cluster card library is defined in personalprox:

- `/Users/ahmadjalil/github/personalprox/k8s/tcger/caches.yaml`
- `/Users/ahmadjalil/github/personalprox/k8s/tcger/backend.yaml`
- service: `tcger-tcgdex`
- namespace: `tcger`
- internal service URL: `http://tcger-tcgdex:4040`

The backend is configured to use that library:

```text
POKEMON_API_BASE_URL=http://tcger-tcgdex:4040
TCGDEX_API_BASE_URL=http://tcger-tcgdex:4040
```

External/backend route from the LAN:

```bash
curl 'http://tcger.k8s.home/api/cards/search?query=Pikachu&tcg=pokemon'
```

Direct cache debug route with port-forward:

```bash
kubectl --kubeconfig /Users/ahmadjalil/github/personalprox/kubeconfig.yml \
  port-forward -n tcger svc/tcger-tcgdex 14040:4040

curl 'http://127.0.0.1:14040/health'
curl 'http://127.0.0.1:14040/cards?q=turtwig&page=1&pageSize=3'
```

Known cache state from the last check:

- `tcger-tcgdex` was healthy
- it had `23,315` Pokemon cards
- backend `/api/cards/search` worked with a normal timeout

Important caveat: backend search responses may contain image URLs like
`http://tcger-tcgdex:4040/images/...`. That hostname is valid inside the
cluster, not in a normal browser outside the cluster. Browser-facing image URLs
need a proxy or rewrite.

## Scanner Architecture

The intended scanner pipeline is:

1. Detect card candidates.
2. Crop and rectify each card candidate.
3. Reject non-card/card-back/bad crops before recognition.
4. Embed or fingerprint the crop and retrieve a top-K shortlist.
5. OCR title/footer regions as verification and reranking signals.
6. Track detections over time.
7. Surface a final card label only after stable evidence.

Relevant web files:

- `/Users/ahmadjalil/github/TCGer/frontend/src/lib/scan/yolo-detector.ts`
- `/Users/ahmadjalil/github/TCGer/frontend/src/lib/scan/embedding-matcher.ts`
- `/Users/ahmadjalil/github/TCGer/frontend/src/components/scan/use-video-scan-processor.ts`
- `/Users/ahmadjalil/github/TCGer/frontend/src/components/scan/video-scan-tracks.ts`
- `/Users/ahmadjalil/github/TCGer/frontend/src/components/scan/video-scan-lab.tsx`

Relevant backend/eval files:

- `/Users/ahmadjalil/github/TCGer/backend/src/scripts/live-video-stream-scan.ts`
- `/Users/ahmadjalil/github/TCGer/backend/src/scripts/eval-video-stream.ts`
- `/Users/ahmadjalil/github/TCGer/backend/fixtures/video-ground-truth/sinnoh-first-partner-pack.ground-truth.json`

Relevant iOS files:

- `/Users/ahmadjalil/github/TCGer/mobile-apps/ios/TCGer/TCGer/CardScanner/BoardCardEmbeddingScannerStrategy.swift`
- `/Users/ahmadjalil/github/TCGer/mobile-apps/ios/TCGer/TCGer/CardScanner/Embedding/CardEmbeddingEncoder.swift`
- `/Users/ahmadjalil/github/TCGer/mobile-apps/ios/TCGer/TCGer/Resources/ScanIndex/README.md`
- `/Users/ahmadjalil/github/TCGer/mobile-apps/ios/scripts/convert-dinov2-coreml.py`

## Current Model Assets

### Reproducible iOS asset pipeline

From the repository root:

```bash
bash scripts/ios-assets.sh build
bash scripts/ios-assets.sh check
```

The build command generates/synchronizes the offline catalogs, builds the iOS
binary/metadata index from the web DINOv2 embedding index, runs Core ML
conversion when its Python dependencies are installed, and refreshes the
tracked rejection-gate copy. It prints exact setup commands for unavailable
optional generators; its final check still exits nonzero while any required
shipping asset is missing or invalid. The check validates JSON, catalog
manifest counts/byte sizes/SHA-256 hashes, and scanner-index binary headers.

The TCGer app target has a pre-build guard that invokes the same check. Missing
or invalid assets are warning-only in Debug, but hard-fail Release builds. This
keeps simulator work possible on a clean clone while preventing an incomplete
scanner/catalog bundle from shipping.

Web YOLO model:

- `/Users/ahmadjalil/github/TCGer/frontend/public/models/yolo-card-detector/model.json`
- shard files in the same directory

Web Pokemon embedding index:

- `/Users/ahmadjalil/github/TCGer/frontend/public/scan-index/pokemon-embeddings.json`
- manifest: `/Users/ahmadjalil/github/TCGer/frontend/public/scan-index/manifest.json`

iOS model/index resources:

- `/Users/ahmadjalil/github/TCGer/mobile-apps/ios/TCGer/TCGer/Resources/ScanIndex/`

Backend embedding/export scripts:

- `/Users/ahmadjalil/github/TCGer/backend/src/scripts/build-embedding-index.ts`
- `/Users/ahmadjalil/github/TCGer/backend/scripts/export-external-embedding-assets.py`
- `/Users/ahmadjalil/github/TCGer/backend/src/scripts/benchmark-embeddings.ts`
- `/Users/ahmadjalil/github/TCGer/backend/src/scripts/build-ios-index.ts`

## Recognition Policy

Use conservative open-set behavior. Do not force every crop to a card.

Recommended defaults:

- raw embedding label requires similarity around `0.70-0.72`
- similarity around `0.65` should only be used with OCR or temporal
  confirmation
- do not accept a card because margin alone is high
- use top-K internally, usually `20` or more
- show "card detected" when below recognition threshold
- require the same card/name across `2-3` good frames before showing a final
  label

Non-card examples that must not receive card names:

- sealed packs
- card backs
- tins
- hands
- playmats
- transition frames
- heavily blurred crops
- partial crops with no readable face

## Web Runtime Rules

For browser live scanning, backend choice matters more than embedding math.

Preferred TF.js backend order:

```text
WebGPU -> WebGL -> WASM -> CPU
```

Rules:

- log the selected backend
- treat CPU as dev-only/non-live
- avoid synchronous tensor reads such as `dataSync()`
- prefer async `data()`
- run heavy scanning on a fixed detector cadence, not every animation frame
- use `requestVideoFrameCallback` where practical
- move expensive work to a Worker with OffscreenCanvas/ImageBitmap when the UI
  starts janking

If a benchmark says YOLO is several seconds per frame, first check whether it is
using a CPU backend. A Node script using plain `@tensorflow/tfjs` is not a fair
browser WebGPU/WebGL benchmark.

## iOS Runtime Rules

iOS should remain native:

- SwiftUI UI
- CoreML embedding encoder
- Vision rectangle/document detection and OCR
- Accelerate/vectorized lookup where needed

Do not wrap the web scanner in a production WebView.

Critical parity rule:

- the model preprocessing used to build the index must match runtime
  preprocessing exactly
- for DINOv2-style models, the current expectation is shortest-edge resize to
  `256`, then center crop to the model input size

Use Vision rectangle/document detection first. Only export YOLO to CoreML if
real phone captures show Vision crop recall is bad.

## Evaluation Video

Primary test video:

```text
/Users/ahmadjalil/Downloads/YTDown_YouTube_Sinnoh-Pokemon-TCG-First-Partner-Pack-Op_Media_wH1JUdnkKHA_001_1080p60.mp4
```

Ground truth:

```text
/Users/ahmadjalil/github/TCGer/backend/fixtures/video-ground-truth/sinnoh-first-partner-pack.ground-truth.json
```

This video includes non-card objects and transition states. That is useful. The
scanner should not score well by guessing card names for everything.

## Live-Stream Benchmark

Run from the repo root or backend directory.

Example full live-stream scan:

```bash
cd /Users/ahmadjalil/github/TCGer

npm --prefix backend run scan:video-live-stream -- \
  --video "/Users/ahmadjalil/Downloads/YTDown_YouTube_Sinnoh-Pokemon-TCG-First-Partner-Pack-Op_Media_wH1JUdnkKHA_001_1080p60.mp4" \
  --sample-seconds 10 \
  --out-dir /tmp/tcger-live-video-full-10s
```

Then evaluate:

```bash
npm --prefix backend run eval:video-stream -- \
  --ground-truth backend/fixtures/video-ground-truth/sinnoh-first-partner-pack.ground-truth.json \
  --results /tmp/tcger-live-video-full-10s/live-stream-results.json \
  --exclude-tags jumbo \
  --out /tmp/tcger-live-video-full-10s/eval-report.json
```

Useful evaluator options:

```bash
npm --prefix backend run eval:video-stream -- --help
```

Use `--include-proposals` only when intentionally scoring every proposal. The
default is best-observation scoring, which better matches what the UI should
surface per frame.

## What To Measure

Do not optimize only top-1 accuracy. A useful scanner needs these metrics:

- top-1 name hit rate
- top-1 externalId hit rate
- top-K candidate recall
- false-positive observation count
- covered ground-truth windows
- confident-frame rate
- latency per detector frame
- latency per embedding crop
- selected web runtime backend
- number of frames skipped due to processing backpressure

For model development, prioritize:

- false positive reduction first
- top-K recall second
- top-1 reranking third
- raw FPS only after the pipeline is conservative

## Model Development Contract

A new recognition model should provide:

- deterministic image preprocessing
- documented input size and normalization
- an encoder usable on web and iOS
- an index builder using the exact same preprocessing
- top-K retrieval output with scores
- calibration data for thresholds
- a failure mode report, especially for packs/backs/bad crops

Minimum artifact set:

```text
model metadata
web model artifact
iOS/CoreML model artifact if applicable
reference vector/index file
metadata mapping vector row -> card externalId/name/set/collector number
benchmark report against the Sinnoh video
threshold recommendation
```

If preprocessing changes, rebuild the entire reference index. Do not compare
new runtime embeddings against an old index.

## OCR And Reranking

Embedding should produce a shortlist, not final truth.

Use OCR as verification:

- title band for visible names
- footer/collector number for exact print identity
- denominator/set code where readable
- temporal OCR votes per tracked card, not one global OCR vote bucket

Expected behavior:

- OCR agreement can allow lower embedding similarity
- OCR disagreement should down-rank a candidate
- absence of OCR should not force rejection if embedding is strong and stable
- OCR from one detection should not influence a different spatial track

## Card-Face Rejection

Add or improve a card-face rejection stage before embedding. It can be a small
classifier, heuristic gate, or both.

Signals to consider:

- visible title/text band
- border/card aspect sanity
- artwork/text layout consistency
- card-back color/layout detection
- pack/sealed-product rejection
- blur/sharpness threshold
- crop coverage and occlusion estimate

YOLO confidence alone is not enough because non-card or non-face objects can
still be detected with high confidence.

## Existing Local/Cluster Commands

Check cluster TCGer resources:

```bash
kubectl --kubeconfig /Users/ahmadjalil/github/personalprox/kubeconfig.yml \
  get pods,svc,ingress -n tcger -o wide
```

Check backend health:

```bash
curl http://tcger.k8s.home/api/health
```

Check Pokemon search through backend:

```bash
curl 'http://tcger.k8s.home/api/cards/search?query=Pikachu&tcg=pokemon'
```

Check TCGdex cache directly:

```bash
kubectl --kubeconfig /Users/ahmadjalil/github/personalprox/kubeconfig.yml \
  port-forward -n tcger svc/tcger-tcgdex 14040:4040

curl http://127.0.0.1:14040/health
```

Local frontend:

```bash
cd /Users/ahmadjalil/github/TCGer
npm run dev:frontend
```

Default local frontend URL:

```text
http://localhost:3003/scan
```

## Verification Commands

Frontend typecheck:

```bash
cd /Users/ahmadjalil/github/TCGer/frontend
npx tsc --noEmit --pretty false --incremental false
```

Backend focused script typecheck:

```bash
cd /Users/ahmadjalil/github/TCGer/backend
npx tsc --noEmit \
  --target ES2021 \
  --module commonjs \
  --moduleResolution node \
  --esModuleInterop \
  --strict \
  --skipLibCheck \
  --types node \
  src/scripts/live-video-stream-scan.ts \
  src/scripts/eval-video-stream.ts
```

iOS static parse for edited scanner files:

```bash
cd /Users/ahmadjalil/github/TCGer
xcrun swiftc -parse \
  mobile-apps/ios/TCGer/TCGer/CardScanner/BoardCardEmbeddingScannerStrategy.swift \
  mobile-apps/ios/TCGer/TCGer/CardScanner/Embedding/CardEmbeddingEncoder.swift
```

Python conversion script syntax:

```bash
cd /Users/ahmadjalil/github/TCGer
python3 -m py_compile mobile-apps/ios/scripts/convert-dinov2-coreml.py
```

Whitespace check:

```bash
cd /Users/ahmadjalil/github/TCGer
git diff --check
```

## Known Pitfalls

- Do not trust Node TF.js CPU timings as browser live-scan timings.
- Do not accept labels from margin-only nearest-neighbor matching.
- Do not globally share OCR votes across unrelated detections.
- Do not evaluate only frames that contain clean front-facing cards.
- Do not compare embeddings built with one preprocessing pipeline against
  runtime embeddings from another.
- Do not use WebView-wrapped web scanning as the production iOS answer.
- Do not treat card search metadata as the same thing as scanner ground truth.
- Do not forget non-card negatives; open-set rejection is part of recognition.

## Immediate Useful Work

The current ranked roadmap is in "2026-08-10 ledger: everything tested,
every decision, forward path" above. Older generic list:

Best next tasks for a model/scanner AI:

1. Add a card-face/non-card rejection model or heuristic gate.
2. Run the Sinnoh live-stream benchmark after each threshold/model change.
3. Add more ground-truth windows and explicit negative windows.
4. Generate a crop dataset from the video with labels:
   - card face
   - card back
   - pack/sealed product
   - hand/background
   - blurry/transition
5. Benchmark DINOv2/CLIP or any new embedding model on top-K recall and false
   positives, not only top-1.
6. Improve OCR reranking with collector-number/footer verification.
7. Validate iOS preprocessing parity against web/index-builder outputs.

## Success Criteria

A change is genuinely useful when it improves live-scan behavior:

- fewer false card names on non-card objects
- fewer one-frame bad labels
- similar or better top-K recall on true visible cards
- no CPU-only web runtime regression
- no iOS/web preprocessing divergence
- evaluation report is saved and reproducible

Always leave behind the command, output directory, and threshold/model version
used for the benchmark.
