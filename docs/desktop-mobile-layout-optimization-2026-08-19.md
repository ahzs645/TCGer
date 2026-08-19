# Desktop & mobile layout optimization — 2026-08-19

A second pass, after `docs/desktop-mobile-interface-fixes-2026-08-19.md`. That
one fixed defects; this one is about **how well each page uses the viewport it
is on** — width on desktop, vertical budget on a phone.

Measured with a density sweep over all 16 demo routes at 1440×900 and 393×659,
recording page height, the responsive column count of every grid, and how much
of the viewport width the content actually reaches.

**Mobile scroll fell 17% across the sweep (51,554px → 42,757px).**
Desktop grids now scale with the container instead of stopping at a fixed
column count.

25/25 regression checks pass · `tsc --noEmit` clean · 101/101 tests ·
eslint unchanged from baseline.

---

## Mobile — page height per route

| Route | Before | After | |
| --- | ---: | ---: | --- |
| `/demo/pokedex` | 16,250px | 9,118px | **−44%** |
| `/demo/sets` | 4,458px | 3,510px | **−21%** |
| `/demo/transactions` | 2,361px | 2,113px | −11% |
| `/demo/analytics` | 2,626px | 2,466px | −6% |
| `/demo/dashboard` | 4,520px | 4,304px | −5% |
| `/demo/cards` | 1,188px | 1,132px | −5% |
| `/demo/guides` | 1,496px | 1,452px | −3% |
| `/demo/collections` | 3,719px | 3,687px | −1% |
| `/demo/decks` | 1,242px | 1,297px | +4% |
| **Total (16 routes)** | **51,554px** | **42,757px** | **−17%** |

Decks is the one page that grew, deliberately: its empty detail placeholder now
has a floor so the reserved column does not read as abandoned.

## Desktop — page height per route

| Route | Before | After | |
| --- | ---: | ---: | --- |
| `/demo/pokedex` | 6,473px | 4,416px | **−32%** |
| `/demo/sets/magic/MH2` | 1,524px | 1,399px | −8% |
| `/demo/sets` | 1,718px | 1,612px | −6% |
| everything else | — | — | unchanged |

---

## What was wrong, and what changed

### Responsive ladders stopped at the wrong end — and had holes in the middle

The dominant pattern. Grids were written `sm:grid-cols-2 xl:grid-cols-3`: two
columns from 640px, three from 1280px, and nothing in between or beyond.

| Grid | Before | After |
| --- | --- | --- |
| Set cards | `sm:2 xl:3` | `sm:2 lg:3 xl:4` |
| "Your sets" strip | `sm:2 xl:7` | `2 sm:3 lg:4 xl:6` |
| Set-detail card grid | `2 sm:3 lg:4 xl:5` | `2 sm:3 md:4 lg:5 xl:6` |
| Pokédex species | `2 sm:3 md:4 lg:5 xl:6` | `3 sm:4 md:5 lg:6 xl:8` |
| Pokédex printings | `2 sm:3 lg:4` | `2 sm:3 lg:4 xl:5` |
| Dashboard set completion | `md:3` | `sm:2 lg:3` |
| Card distribution | `md:3` | `sm:2 lg:3` |
| Achievements | `sm:2 xl:4` | `sm:2 lg:3 xl:4` |
| Decks stat tiles | `3` (at every width) | `2 lg:3` |
| Transactions stat tiles | `sm:2 lg:4` | `2 md:gap-6 xl:4` |

Two things this exposed:

- **The ceiling is the container, not the viewport.** Page content still lives
  in `.container`, which caps at 1360px, so a `2xl:` column count adds columns
  without adding width. A first attempt at `2xl:grid-cols-5` on the sets page
  gave 250px cards at 1920 and wrapped every set name; the real ceiling there is
  four. Every ladder was capped where the card still fits its content.
- **Three columns on a 393px phone is not always wrong.** The Pokédex species
  tile went 2→3 columns, and the species name — the one thing the tile exists to
  tell you — started truncating to "Charma…". A slightly smaller name that wraps
  to two lines fixed that, and the page still lost 44% of its scroll.

### Card padding was a desktop measure applied everywhere

`CardHeader` and `CardContent` hardcoded `p-6`. On a 393px phone that is 48px of
a 361px content width and 48px of height **per card**, with ~20 cards on a page.

The obvious fix — changing the base class to `p-4 sm:p-6` — is wrong, and the
sweep caught it: page heights for Trades and Collections went *up* on desktop.
`tailwind-merge` drops the conflicting `p-4` when a caller passes `p-3`, but
keeps `sm:p-6`, so a call site's deliberately compact padding was silently
overridden from 640px up. `app/demo/trades/page.tsx` has eight such call sites.

The padding now lives in a `@layer components` class instead. Tailwind's layer
order puts utilities above components, so a caller's `p-*` wins at every
breakpoint — which is what a call-site override should do. Desktop heights
returned to their exact previous values; mobile kept every gain.

### Master/detail panes wasted the width they reserved

- **Decks** split the row `1fr 1fr`: six one-line deck rows got 652px, and so
  did the detail — the thing you actually came to read. Now
  `minmax(300px,26rem) minmax(0,1fr)`, with the detail sticky so it stays on
  screen while the list scrolls, and a floor on the empty placeholder.
- **Card Explorer** pinned its results to `h-[calc(100vh-280px)]` at every
  width — a nested scroller inside a scrolling page, which on a phone traps the
  results in a short window. It is now desktop-only, paired with a sticky search
  form so you can refine without scrolling back up.
- **Wishlists** had a static sidebar beside a long detail pane; it is now
  sticky and independently scrollable, matching Guides.

### Achievement tiles carried a grid floor into a one-column layout

`min-h-48` levels tiles against each other inside a grid. Stacked one-up on a
phone there is nothing to level against, so it added ~50px of empty card to each
of eight achievements. Now `sm:min-h-48`.

---

## Where the remaining width goes

The sweep's width-use metric flags four desktop routes below 0.85. All four are
explained, and none is a layout defect:

- **`/demo/sets/magic/MH2` (0.65)** and **`/demo/sets` (0.85)** — partial last
  rows. Seven cards in a six-column grid leaves a row that is one-sixth full.
  With a real 300-card set the metric goes the other way.
- **`/demo/collections` (0.82)** — the inspector column is sticky beside a
  3,600px table, so most sampled rows see only the table. That is the design.
- **`/demo/guides` (0.75)** — the guide detail resolves to zero cards without an
  installed catalog, so the right column is empty in this environment.
