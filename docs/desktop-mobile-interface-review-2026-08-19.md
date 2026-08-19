# Desktop & mobile interface review — 2026-08-19

A full pass over the web client at desktop and phone widths, in both themes,
covering **both the `/demo` tree and the live (non-demo) routes**. Driven with
Chromium/Playwright against `next dev`, plus a source read of the shared shell,
navigation and UI primitives.

- **Desktop:** 1440×900 primary, with a header sweep at 1024 / 1100 / 1200 /
  1280 / 1360 / 1366 / 1440 / 1536 / 1600 / 1700 / 1920 / 2560.
- **Mobile:** iPhone 15 Pro (393×659 CSS px, DPR 3, touch, iOS UA).
- **Themes:** dark for the full sweep, light re-run on dashboard, collections,
  wishlists, analytics, prices and sets at both viewports.
- **Routes (demo):** `/demo`, `/demo/dashboard`, `/demo/packs`, `/demo/cards`,
  `/demo/collections`, `/demo/wishlists`, `/demo/scan`, `/demo/pokedex`,
  `/demo/guides`, `/demo/sets`, `/demo/sets/magic/MH2`, `/demo/decks`,
  `/demo/prices`, `/demo/analytics`, `/demo/trades`, `/demo/transactions`,
  `/demo/sealed`, `/demo/activity`.
- **Routes (live, signed out):** `/`, `/setup`, `/cards`, `/collections`,
  `/scan`, `/sets`, `/packs`.
- **Interaction:** mobile More drawer, command palette, user menu, wishlist
  master→detail, account settings dialog, desktop More dropdown, keyboard
  focus walk through the header.

**17 findings: 1 blocker, 4 layout, 5 consistency, 5 mobile, 2 polish.**

The prior pass (`docs/demo-interface-review-2026-08-11.md`) closed 25 findings
against the demo tree. Most of that work holds — trades no longer scrolls
sideways, the price table is a card list on mobile, the analytics chart draws,
per-page titles exist under `/demo`, no native dialogs, no page-level
horizontal overflow anywhere, no console errors and no 4xx across the demo
sweep. What follows is new, or is the same class of problem resurfacing in
code that pass did not cover (the live tree, and two routes added since).

---

## Environment caveats — not counted as findings

Three things look broken locally but are configuration, not code. They are
listed so nobody re-derives them:

- **No card art.** `frontend/public/catalog/` holds only a README, and
  `NEXT_PUBLIC_CATALOG_BASE_URL` is unset locally, so every card falls back to
  its per-game back. The deployed demo sets a catalog origin and the art
  appears. `/catalog/manifest.json` 404s for the same reason.
- **Guides resolve to zero cards** for the same reason — `/demo/guides` lands
  on "Pokémon Clay Art" with "No matching cards available" and a disabled
  "Guide unavailable to follow". The explanatory panel it shows
  ("Install or refresh the pokemon catalog") is correct and well-written.
- **Live routes have no backend.** Port 3004 refuses connections here, so live
  data surfaces could not be exercised. Finding 13 below is about what the UI
  does in that state, which is a genuine question regardless.

The Next.js dev indicator and the TanStack Query devtools badge appear in
screenshots and are dev-only.

---

## Blocker

### 1. The desktop "More" menu is unclickable at every width ≥ 1360px

The header is one non-wrapping row: logo → Demo badge → primary nav → Quick
Actions → game switcher → user menu. `.container` is capped at **1360px**
(`frontend/tailwind.config.ts:24`), and the nav expands its labels at
`min-[1360px]` (`frontend/src/components/layout/app-shell.tsx:244`). The
labelled nav needs 723px; with the logo and the 460–516px right-hand cluster
the row needs ~1470px against ~1328px of content box. The left group is
`min-w-0` and the right cluster is `shrink-0`, so the nav does not compress —
it **overflows underneath** the right cluster, which paints on top of it.

Measured at 1440×900 in **live** mode (7 nav items):

| Element | Span | Right cluster starts | Result |
| --- | --- | --- | --- |
| Wishlists | 789 – 898 | 862 | last 36px covered |
| More | 902 – 985 | 862 | **entirely covered** |

`document.elementFromPoint` at the More button's centre returns the Quick
Actions button at 1360, 1366, 1440, 1536, 1600, 1920 — and at 2560, because
the container never grows past 1360. A Playwright `click()` on it **times out**
with the pointer intercepted. Demo mode is the same, one item narrower.

The More menu is the only header route to Pokédex, Guides, Sets, Decks,
Prices, Analytics, Trades, Transactions, Sealed and Code Vault — **10 of the
16 sections**. On desktop they are reachable only through ⌘K. Below 1360 the
nav is icon-only, everything fits, and every item is clickable, so the bug is
invisible on a small laptop and permanent on everything above it.

The prior review's finding 1 was the same root cause with a different symptom
(the user menu pushed off-screen). It was fixed by moving labels to
`min-[1360px]` and adding `shrink-0` to the right cluster — which converted
overflow into overlap. Adding a sixth primary item (`Open Packs`,
`app-shell.tsx:104`) then pushed it past the budget again.

Fix: the label breakpoint has to be derived from the real content width, not
guessed. Either raise it well past 1360 (the row needs ~1470px, and the
container never provides it — so labels can never show at this container cap),
give the nav `min-w-0 overflow-hidden` so it clips instead of overlapping, or
move More out of the nav and into the right cluster where it cannot be
covered.

---

## Layout

### 2. Analytics renders its headline chart as six flat monochrome blocks

`app/demo/analytics/page.tsx:207` and `app/analytics/page.tsx` paint the bars
`bg-primary/80`. In dark mode `--primary` is `210 40% 98%`
(`app/globals.css:39`) — near-white; in light mode it is near-black. The result
is the largest element on the page rendered as six grey slabs with no axis, no
baseline, no gridlines and no accent colour. The six values span $993–$1274
(28%), but because the bars are drawn from a zero baseline the visible
difference is ~22% of the plot height, so the trend the card exists to show is
barely legible.

This is downstream of a broader point: the app ships the stock shadcn slate
palette unmodified, so `--primary` is white-on-dark / black-on-light and the
product has **no accent colour at all**. Every progress bar, active nav pill,
primary button and chart bar is monochrome. Wishlist completion bars are the
clearest tell — 100% is green, 92% and 75% are plain white.

### 3. The wishlist sidebar still clips its own list items on desktop

`src/components/wishlists/wishlist-content.tsx:1388` sizes the sidebar at
`lg:grid-cols-[280px_1fr]`. "Scarlet & Violet Chase Cards" measures 201px into
a 167px box and renders as "Scarlet & Violet Chas…" at 1440×900, with room to
spare in the 1060px detail pane beside it. The prior review fixed the
ScrollArea clipping here; the column is simply too narrow for the seeded names.

### 4. `/demo/activity` uses a different page width from every other route

It is the only page that wraps its content in `mx-auto max-w-5xl`
(`app/demo/activity/page.tsx:145`). Every other route fills the container, so
navigating to Activity shifts the left gutter from 50px to 202px at 1440 and
the page visibly jumps.

### 5. Set-detail filter controls wrap inside their own triggers

On `/demo/sets/magic/MH2` at 1440 the "Owned and missing" `Select` trigger
wraps its label onto two lines inside a fixed-height control. The filter row
gives each control an equal share of the width regardless of label length.

---

## Consistency

### 6. The same dollar amount renders four different ways

There are five money formatters in the frontend using three different
strategies:

| Where | Code | $1273.64 renders as |
| --- | --- | --- |
| Dashboard | `Intl.NumberFormat("en-US", …)` (`dashboard-content.tsx:424`) | `$1,273.64` |
| Collections detail | `Intl.NumberFormat("en-US", …)`, cents dropped ≥ $100 (`sandbox/helpers.ts:55`) | `$1,274` |
| Transactions | `Intl.NumberFormat(undefined, …)` (`transactions-content.tsx:78`) | `US$1,273.64` in `en-CA` |
| Prices / Sealed (live) | `Intl.NumberFormat(undefined, …)` | browser-dependent |
| Prices / Analytics / Sealed (demo), Trades, collection table | `` `$${n.toFixed(2)}` `` (15 call sites) | `$1273.64` |

Observed side by side in one session: Dashboard says `$1,273.64`, Prices and
Analytics say `$1273.64`, Transactions says `US$28.50`. The `undefined` locale
is the worst of the three — a Canadian, British or German user gets a different
currency rendering on Transactions than on every hardcoded-`en-US` page in the
same app. One shared `formatMoney()` would close all of this.

### 7. Live routes all share one browser tab title

`/`, `/cards`, `/collections`, `/scan`, `/sets` and `/setup` all report
`document.title === "TCGer"`. Only `/packs` sets its own. Meanwhile every demo
route sets a distinct title (`Dashboard · TCGer Demo`, `Price Tracker · TCGer
Demo`, …). The prior review's finding 22 was fixed in the demo tree only, so
the shipping product is the half that still has indistinguishable tabs,
history entries and shared links.

### 8. Two demo routes were added after the title fix and missed it

`/demo/transactions` and `/demo/activity` both fall back to the layout default
`TCGer Demo`; the other 15 demo routes set their own.

### 9. Four page headers, three different layouts

| Page | Markup | Mobile result |
| --- | --- | --- |
| Transactions | `flex-col … sm:flex-row` (`transactions-content.tsx:169`) | button on its own row **below** the description — correct |
| Collections | `flex flex-wrap` + `ml-auto` (`app/collections/page.tsx:20`, `app/demo/collections/page.tsx:16`) | buttons wrap **between** the h1 and its description |
| Trades | `flex items-start justify-between` (`app/demo/trades/page.tsx`) | button beside the h1 |
| Sealed | `flex items-start justify-between` (`app/demo/sealed/page.tsx:198`) | "Sealed Products" wraps to two lines beside the button |

Collections is the one that reads as a defect: the action row splits the
heading from the sentence that explains it.

### 10. Set detail builds a sentence out of a scope name

`src/components/sets/set-detail.tsx:434` renders
`Track every unique printing in {selectedCollectionName}.` With the default
scope selected this reads **"Track every unique printing in All collection."**
at both viewports.

### 11. The command palette duplicates itself and outlives its own nav

`command-menu.tsx:68` adds a "Utilities" group whose two entries — "View price
analytics" → `/analytics` and "Track card prices" → `/prices` — are already in
the Navigation group above, so both appear twice in one dialog. It also
hardcodes "Card Scan" into Navigation, which demo mode deliberately drops from
the primary nav (`app-shell.tsx:126`) because it is a dead end there.

---

## Mobile

### 12. The More drawer's close button lands under the title, left-aligned

`src/components/ui/drawer.tsx:66` gives `DrawerHeader` the base class
`grid gap-1.5 p-4 …`. `app-shell.tsx:440` overrides it with
`flex-row items-center justify-between`. `tailwind-merge` treats `grid` and
`flex-row` as different property groups, so neither is dropped: the element
stays `display: grid` and `flex-row`/`justify-between` are inert on a
single-column grid. The ✕ renders on its own row beneath "More", flush left.
Fixing it is one word — `flex` rather than (or alongside) `flex-row` — and it
fixes the primitive for every future consumer.

Same drawer: 13 destinations in a 3-column grid fill 85% of the viewport
height (top 99 of 659). It is the entire secondary navigation, so it is a
sheet that has to be scrolled to reach the last row.

### 13. Nothing tells you the backend is unreachable

With the API down, live `/` renders the ordinary signed-out dashboard —
"Welcome to your dashboard · Start by adding cards to a binder" plus a
"Collection achievements 0/8 unlocked" panel with eight progress cards. There
is no error, no retry, no offline banner; the only console trace is
`Failed to check access: TypeError: Failed to fetch` from
`SetupGuard.checkAccess`. **A total outage is visually identical to a new
empty account**, on desktop and mobile alike.

Related: signed-out treatment differs per route. `/sets` shows a proper "Sign
in required" gate; `/`, `/collections`, `/cards` and `/scan` each render a
working-looking empty product. A first-time visitor gets four different answers
to "am I supposed to be logged in?".

### 14. Touch targets are 36–40px app-wide, not 44px

`src/components/ui/button.tsx:22-26` defines `default: h-10` (40px),
`sm: h-9` (36px), `icon: h-10 w-10` (40×40). Nothing reaches the 44px iOS HIG /
WCAG 2.5.5 AAA target. Per-route counts of visible sub-44px controls at 393px:
collections 33, sealed 28, trades 25, activity 22, MH2 set detail 16,
packs 12, guides 9, transactions 9, pokedex 8, prices 7, dashboard 5,
cards 5, wishlists 5, sets 5, analytics 4, scan 4.

The two worst are on every page: the header's **user menu (40×40)** and
**Quick Actions (50×40)**. Others of note: grid/list view toggles (40×36,
29 instances), collection row buttons (291×38), trade filter tabs (175×32).
The prior review's finding 17 fixed the 24×24 collection expanders with a
`::before` expander; the same technique — or bumping the `sm` and `icon`
variants — would clear the rest in one change.

### 15. The global game filter is unreachable from a phone header

`game-switcher.tsx:39` is `hidden … sm:flex`, so below 640px the switcher is
gone. The mobile header then carries a logo on the left, two buttons on the
right and ~500px of empty space between them. The filter still exists — the
Quick Actions dialog has a "Switch TCG" group — but it is four items down a
scrolled palette, and nothing on the page hints that the app has a global game
scope at all.

### 16. Transactions is the only page whose stat grid doesn't go 2-up

`transactions-content.tsx:187` and `:378` use
`grid gap-3 sm:grid-cols-2 lg:grid-cols-4`. Dashboard, Prices, Trades, Sealed
and Analytics all use `grid-cols-2 … xl:grid-cols-4`. Below 640px Transactions
therefore stacks eight stat cards one per row, and the four headline numbers
alone take more than a full screen of scrolling.

### 17. Two rows truncate the identifier that matters

- `/demo/prices` — set names clip in seven rows: "Legend of Blue Eyes" gets
  91px for 122px of text, "Flames of Destruction" 91 for 132.
- `/demo/sealed` — product types clip in six rows: "Collector Booster Box"
  gets 97px for 129.

In both cases the row has spare width elsewhere; the label column is just
fixed too narrow.

Also mobile: the wishlist detail's filter row keeps a search input and a select
side by side at 393px, so the placeholder reads "Search within wishlist.." and
the "All Cards" trigger wraps to two lines.

---

## Polish

### 18. The Card Explorer search panel is the only dashed card in the app

`src/components/cards/card-search-panel.tsx:118` — `border-dashed` on a
`<Card>`. Every other surface uses a solid border, so the panel reads as a
placeholder or drop zone rather than the page's primary control.

### 19. Five controls on `/demo/collections` have no accessible name

At 1440, visible and in the DOM: one `Select` trigger (310×40), three
checkboxes (16×16) and one textarea (310×98), all in the detail panel below
the fold. These are not the false positive the prior review corrected — that
one was inside a `hidden lg:block` wrapper; these are visible. The checkboxes
are also the smallest interactive targets on the page.

---

## What holds up

- **No page-level horizontal overflow on any route, at either viewport.**
- **No console errors, no page errors and no 4xx** across the entire demo
  sweep at both viewports.
- **Light mode is correct everywhere it was checked** — dashboard, collections,
  wishlists, analytics, prices and sets, desktop and mobile.
- **Keyboard focus is visible on every header control** (2px outline plus a
  ring) and the tab order is logical; "Skip to main content" works.
- Every route has exactly one `<h1>` except `/demo/packs` and `/packs`, which
  are deliberately full-bleed.
- No broken images, no `<img>` without `alt`.
- The mobile bottom tab bar, the More drawer's routing, the wishlist
  master→detail transition, the trades tab wrap, the mobile price card list,
  and the pack-opening stage all behave correctly at 393px.
- Data reads consistently across pages: 66 cards / $1273.64 on dashboard,
  analytics and prices; MH2 6/7 in both the set list and the set detail;
  sealed totals reconcile with the per-row values.
- The Pokédex and Guides degradation messages ("Printing catalog not
  downloaded", "Guide cards aren't available … install or refresh the pokemon
  catalog") are specific, honest and actionable — the model the rest of the
  app should copy for finding 13.

---

## Suggested order

1. **Finding 1** — 10 of 16 sections are unreachable from the desktop header
   at every common laptop and desktop width. Everything else is cosmetic
   beside it.
2. **Findings 12 and 16** — both one-line fixes with visible mobile payoff.
3. **Finding 6** — one shared formatter; it removes four inconsistencies and a
   locale bug at once.
4. **Findings 7 and 8** — titles in the live tree and the two new demo routes.
5. **Finding 14** — the button size variants; one change clears the sub-44px
   count on sixteen routes.
6. **Finding 13** — an offline/error state for an unreachable API.
7. **Finding 2** — give the product an accent colour, and the chart an axis.
8. The rest as polish.

## Not covered

The iOS SwiftUI client under `mobile-apps/ios/` could not be exercised — this
environment is Linux with no Xcode or simulator. "Mobile" above means the web
client at phone width. A source-level read of the SwiftUI views is possible if
that is wanted.
