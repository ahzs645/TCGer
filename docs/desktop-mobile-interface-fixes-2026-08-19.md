# Desktop & mobile interface — fix pass, 2026-08-19

Implementation pass over every finding in
`docs/desktop-mobile-interface-review-2026-08-19.md`.

**18 of 19 findings fixed. 1 withdrawn as a measurement error (19).**
Two problems in the review's own measurement harness were also found and
corrected — see *Corrections to the review* below.

33/33 automated regression checks pass (`More` reachable at 8 widths, header
clearance at 12 widths, 0 sub-44px targets across 7 routes, 20/20 distinct
titles, offline banner present in live and absent in demo, mobile game filter,
drawer header geometry).

`tsc --noEmit` clean · 101/101 unit tests pass · eslint unchanged from baseline
(1279 problems / 696 errors / 583 warnings before **and** after — all
pre-existing `react-hooks/purity` and `set-state-in-effect` findings from the
upgraded eslint config, none introduced here).

---

## Outcome

| # | Finding | Status |
| --- | --- | --- |
| 01 | Desktop "More" unclickable ≥1360px | **Fixed** — opens at 1024/1280/1440/1700/1920/2560 with all 10 items; no overlap at any of 13 widths × 3 configurations |
| 02 | Analytics chart is flat monochrome blocks | Fixed — shared `ValueBarChart` with gridlines, baseline, axis row and a dedicated chart colour ramp |
| 03 | Wishlist sidebar clips list items | Fixed — 280 → 320px (`xl:` 360px), plus a `title` tooltip |
| 04 | `/demo/activity` uses a different page width | Fixed — `max-w-5xl` removed |
| 05 | Set-detail select labels wrap inside the trigger | Fixed at the primitive — `SelectTrigger` is `whitespace-nowrap` with a truncating value |
| 06 | Four renderings of the same dollar amount | Fixed — one `formatMoney()`; 5 formatters and 28 raw call sites replaced |
| 07 | Every live route titled "TCGer" | Fixed — root `title.template` + per-route metadata; 22/22 routes distinct |
| 08 | Two demo routes missing titles | Fixed — and the demo tree now composes via its own template |
| 09 | Four page headers, three layouts | Fixed — shared `PageHeader` on collections, trades, sealed, transactions (live + demo) |
| 10 | "Track every unique printing in All collection." | Fixed — the all-scope case gets its own sentence |
| 11 | Command palette duplicates and drifts | Fixed — Utilities group dropped; both nav lists now come from `AppShell` |
| 12 | More drawer close button lands under the title | Fixed at the primitive — `DrawerHeader` is `flex flex-col`, so a caller's `flex-row` applies |
| 13 | Nothing says the backend is unreachable | Fixed — `useServerStatus()` + a banner with a retry, self-clearing on recovery |
| 14 | Touch targets 36–40px | Fixed — `coarse:` variant on Button/Tabs/ToggleGroup and four custom controls: **202 → 2** sub-44px targets, both remaining ones 1×1px hidden form elements |
| 15 | No game filter on a phone | Fixed — compact game menu below `xl`, which also gave the tablet nav its space back |
| 16 | Transactions stat grid doesn't go 2-up | Fixed — matches the other five pages |
| 17 | Set/product names truncate on mobile | Fixed — 14 → 0 clipped labels; 4 select *values* now ellipsis by design (see below) |
| 18 | Card Explorer is the only dashed card | Fixed — `border-dashed` removed |
| 19 | Five unnamed controls on `/demo/collections` | **Withdrawn** — measurement error, see below |

---

## Corrections to the review

Both of these are harness bugs in the review's own tooling. They are recorded
so the same wrong conclusions are not re-derived.

### Finding 19 was a false positive

The audit resolved accessible names with a hand-rolled function that only
consulted `label[for=…]` for `<input>` elements. The five controls it flagged
on `/demo/collections` — a Radix `Select` trigger, three checkboxes and a
`<textarea>` — all carry proper `<Label htmlFor>` associations
(`detail-panel.tsx:464,528,839,918,975`). With the resolver corrected to check
`label[for]` and ancestor `<label>` for *any* labelable element, the page has
**zero** unnamed interactive controls. No code change was needed, and adding
`aria-label` would have been actively wrong on the combobox: on a
`role="combobox"` trigger it replaces the name computed from content, trading
the announced value for a static field name.

### The per-route tap-target counts were measured with touch emulation off

`page.screenshot({ fullPage: true })` resizes the viewport, and Chromium drops
touch emulation when it does. The audit took a full-page capture on the first
tall route, so **every route measured after that reported
`matchMedia("(pointer: coarse)") === false`**. Any `coarse:`-gated rule was
therefore invisible to the audit, and — more importantly — the review's
per-route counts (33 on collections, 28 on sealed, …) were collected in that
state. The counts happened to be right for the *before* tree, which had no
pointer-conditional sizing at all, but they would have silently reported the
fix as a no-op.

The audit no longer takes full-page captures; it asserts
`pointer: coarse` per route, and the before/after comparison was re-measured
from scratch against a stashed working tree so both sides use the fixed
harness.

---

## What changed, by area

### The header (finding 1)

The root cause was a fixed budget, not a bad breakpoint. `.container` caps at
1360px, and the labelled 7-item nav (810px) plus the logo, the demo badge and a
460–691px right-hand cluster needs ~1470px. No breakpoint fixes that, because
the container never gets wider. Three changes together:

- **The header left `.container`.** It now spans the viewport with its own
  padding, so wide screens actually provide the width the row needs.
- **Labels expand at `min-[1700px]`** instead of `min-[1360px]` — measured, not
  guessed, against the widest configuration (live, signed out, six games).
- **The nav is `min-w-0 overflow-hidden`.** A future item can only ever clip
  the nav; it can never again paint over the controls to its right.

Verified at 768 / 900 / 1024 / 1200 / 1280 / 1360 / 1366 / 1440 / 1536 / 1600 /
1700 / 1920 / 2560, in demo and live mode, with 3 and 6 games enabled: no
overlap anywhere, smallest clearance 49px.

`768px` used to clip three nav items even so. Moving the game switcher to a
compact menu below `xl` (finding 15) freed the 212–308px that was causing it.

### Money (finding 6)

`src/lib/format-money.ts` is now the only money formatter. It pins the locale
deliberately — the two `Intl.NumberFormat(undefined, …)` call sites meant a
Canadian reader saw `US$28.50` on Transactions and `$28.50` everywhere else.
`formatMoney` / `formatMoneyCompact` / `formatMoneyDelta` cover the value, axis
and delta cases; `sandbox/helpers.ts` no longer drops cents above $100.

### Touch targets (finding 14)

A `coarse:` variant (`@media (pointer: coarse)`) is registered in
`tailwind.config.ts` and applied in `buttonVariants`, `TabsTrigger`,
`ToggleGroupItem` and four custom controls. Desktop density is untouched;
only finger input gets the 44px floor.

### Primitives fixed at the source

Three of the findings were call-site symptoms of shared-component bugs, and
were fixed in the primitive so they cannot recur:

- `DrawerHeader` was `grid`; a caller's `flex-row` could not override it
  because tailwind-merge treats `display` and `flex-direction` as different
  groups. It is now `flex flex-col`, matching `DialogHeader`.
- `SelectTrigger` let long values wrap inside a fixed-height control. It is now
  `whitespace-nowrap` with a truncating value span.
- `TabsList` was fixed-height and non-wrapping while every `TabsTrigger`
  carried `min-w-[120px]` — the combination that used to drag whole pages
  sideways on a phone. `TabsList` now wraps.

---

## Known trade-offs

- **Four select values now ellipsis instead of wrapping.** "Owned and missing",
  "All enabled games", "Not specified" and a wishlist name exceed their column
  by 5–16px. Clipping a value with an ellipsis is the correct behaviour for a
  fixed-height trigger; the defect was the control growing to two lines. The
  two worst columns were widened; the rest are left to ellipsis.
- **The header is full-width while page content stays capped at 1360px.** On a
  very wide screen the logo no longer aligns with the page gutter. This is the
  standard app-shell pattern and it is what buys the header the room it needs.
- **`--primary` was not repainted.** The review noted the app has no accent
  colour at all, since `--primary` is the stock shadcn near-white/near-black.
  Charts and data visualisation now use a dedicated `--chart-*` ramp, but
  turning every button and progress bar a brand colour is a design decision,
  not a defect fix, so it was left alone.
- **Live data surfaces still could not be exercised** — no backend in this
  environment. Finding 13's banner was verified in exactly that state, which is
  the state it exists for.
