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
