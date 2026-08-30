# Game acceptance policy (`tcger-scanner-acceptance-policy-v1`)

How a scanner turns a similarity ranking plus printed evidence into an
accept/abstain decision is **data declared per game**, not code paths keyed
on the game name. This is what lets a future game ship a scanner with no
client release, and what lets an existing game move its operating point by
republishing a manifest.

Source of truth: [`tools/scanner-acceptance-policies.json`](../../tools/scanner-acceptance-policies.json).
Design background: [Two-stage recognition](two-stage-recognition.md) and the
[2026-08-29 Magic visual-first record](mtg-visual-first-policy-2026-08-29.md).

## The contract

```json
"acceptancePolicy": {
  "schema": "tcger-scanner-acceptance-policy-v1",
  "strongAcceptanceScore": 0.70,
  "ambiguityMargin": 0.05,
  "evidenceFloor": 0.55,
  "titleGate": "binderPage",
  "uniqueTitleRescue": true,
  "titleAgreementRescue": true,
  "collectorNumberScope": "family"
}
```

| Field | Meaning |
|---|---|
| `strongAcceptanceScore` | Cosine similarity at which the visual top-1 is accepted with no other evidence. Retry crop hypotheses (alternate box, whole frame) add the client's retry margin (+0.02 on iOS). |
| `ambiguityMargin` | Minimum top-1 minus top-2 similarity when the runner-up is a different family. Closer than this abstains unless printed evidence decides. |
| `evidenceFloor` | Lowest similarity at which printed evidence (title, collector number) may confirm a candidate. Must not exceed `strongAcceptanceScore`. |
| `titleGate` | When an exact printed title is *required* before any accept: `never`, `binderPage`, or `intentionalCaptures`. Live preview never requires it. |
| `uniqueTitleRescue` | An exact, catalog-unique title confirms its visual neighbour from `evidenceFloor`. |
| `titleAgreementRescue` | An exact title naming the same card the image ranked first — with no different-name rival inside `ambiguityMargin` — confirms the visual **family** from `evidenceFloor`. The printing is then chosen by the normal Quick Scan / Exact Printing resolver. |
| `collectorNumberScope` | Which printings a footer collector number is matched against: `representative` (the family row only) or `family` (every printing the row represents; the confirmed printing becomes the result with `verified` provenance). |

Every field is optional in a manifest; an omitted field takes the `default`
profile's value. A declared policy that fails validation (values outside
[0, 1], `evidenceFloor` above `strongAcceptanceScore`, unknown `schema`) is
ignored and the client uses its built-in profile — a broken publish degrades
to known behaviour, never to nonsense thresholds.

What the policy does **not** change: the candidate evidence floor used to
build the shortlist (0.55), the open-set ambiguity rule itself, the
printing-resolution modes, or the OCR user switch. Those are runtime
contract, not per-game data.

## Where it lives

| Surface | Carrier | Reader |
|---|---|---|
| iOS | `ios/scan-assets/{game}/manifest.json` → `acceptancePolicy` (format 3) | `ScannerAssetManifest.acceptancePolicy` → `ScannerRuntimeAssets` → `BoardCardEmbeddingScannerStrategy.acceptancePolicy(for:)` |
| Android | `android/scan-assets/{game}/manifest.json` → `acceptancePolicy` (format 2) | `ScannerAssetManifest.acceptancePolicy` → `ArcFaceRuntimeContract.acceptancePolicy` → `ArcFaceCardRecognizer` |
| Browser | index artifact `thresholds` (+ `acceptancePolicy` for diagnostics) | `matchEmbeddingTopK` reads `index.thresholds` |
| Publishers | `tools/r2/publish-ios-scan-pack.mjs`, `publish-android-scan-pack.mjs`, `build-browser-scan-index.mjs` | `loadAcceptancePolicy(game, overridePath)` in `tools/r2/lib.mjs` |

The Android manifest keeps its legacy top-level `strongAcceptanceScore` /
`ambiguityMargin`; the publisher fills them from the policy so old clients
keep working, and new clients prefer the policy object.

### Resolution order (both native clients)

1. **Environment overrides** — replay sweeps and A/B runs only
   (`SCANNER_STRONG_ACCEPT`, `SCANNER_STRONG_ACCEPT_<GAME>`,
   `SCANNER_AMBIGUITY_MARGIN`, `SCANNER_MTG_TITLE_GATE=1`,
   `SCANNER_MTG_LEGACY_POLICY=1`; iOS `TEST_RUNNER_` passthrough).
2. **The installed manifest's declared policy**, when valid.
3. **The built-in profile** for the game (`ScannerGameAcceptancePolicy.builtin`
   on iOS, `ScannerAcceptancePolicy.builtin` on Android). These mirror the
   JSON for the shipped games and exist for manifests that predate the field.
4. **`fallback`/`default`** — the profile every unknown game starts with.

## Shipped profiles

| Game | strong | margin | floor | titleGate | rescues | footer scope | Evidence |
|---|---:|---:|---:|---|---|---|---|
| Pokémon | 0.65 | 0.05 | 0.55 | never | unique + agreement | family | physical-v2 76-label replay; 0.65 sits above the pack/empty negatives (0.6285/0.6476) |
| Magic | **0.70** | 0.05 | 0.55 | binderPage | unique + agreement | family | 49 labeled frames: 0.65 admitted three wrong accepts (0.64–0.69), 0.70 none; replay 28 → 36 correct, 0 wrong |
| Yu-Gi-Oh! | 0.65 | 0.05 | 0.55 | never | unique + agreement | family | inherits the encoder point; no labeled phone sessions yet |
| `default` | 0.70 | 0.05 | 0.55 | never | unique + agreement | family | conservative: highest measured strong-accept point, visual-first |

## Adding a game

1. **Ship the runtime** through the existing game-package path (catalog,
   family metadata, model, index). Nothing in the policy depends on the
   game's name.
2. **Start under `default`.** Publish the manifest without an
   `acceptancePolicy`, or with the `default` entry; the client resolves it
   to the conservative profile on every platform.
3. **Collect evidence.** Scan real cards with Scanner Debug (Dev Mode) on,
   export, ingest into `TCGer-Session-Reference`, and label the frames
   (`DevModeSessionReplayTests.expectedCards`; exact printing ids). Include
   negatives — backs, packs, out-of-index cards — or false accepts cannot be
   measured. See [Reference session ingestion and replay](reference-session-ingestion-and-replay.md).
4. **Calibrate.** Replay with `TEST_RUNNER_SCANNER_STRONG_ACCEPT_<GAME>`
   sweeps (and `REPLAY_EVIDENCE_DIR` for offline scoring). The operating
   point is the lowest strong-accept with zero wrong accepts across the
   labeled sessions; raise it before loosening any rescue. Record correct /
   wrong / abstain, never recall alone.
5. **Declare it.** Add the game's entry to
   `tools/scanner-acceptance-policies.json` with a `calibration` note,
   republish the manifests, and add the same values to both clients'
   `builtin` tables so pre-policy manifests and the fallback stay coherent.
6. **Gate it.** The release gate for the game must report visual-only and
   visual-plus-OCR results separately and pass the same replay before
   promotion.

Games whose printings cannot be distinguished visually (same-art reprints)
get exact printings only through `collectorNumberScope: family` plus
readable footers, or user selection in Exact Printing mode. That is the
design, not a gap: the model identifies the visual family; printed evidence
identifies the printing.

## Changing a shipped policy

Edit the JSON, run the replay gate for that game, republish that game's
manifests (objects first, manifest last), and update the built-in tables in
the same change. Do not lower `strongAcceptanceScore` to recover a frame the
model ranked wrongly — that is a retrieval failure and belongs to the model
or index, not the policy.
