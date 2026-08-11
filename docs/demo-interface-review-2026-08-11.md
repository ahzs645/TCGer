# Demo interface review — 2026-08-11

Page-by-page pass over every route under `/demo`, at desktop (1440×900, plus
1280 / 1366 / 1536 / 1600 / 1700 / 1920 for the header) and mobile (390×844,
iPhone UA, DPR 2). Driven with Chromium/Playwright against `next dev`.

Routes covered: `/demo`, `/demo/dashboard`, `/demo/collections`, `/demo/cards`,
`/demo/sets`, `/demo/sets/[tcg]/[setCode]`, `/demo/decks`, `/demo/trades`,
`/demo/wishlists`, `/demo/sealed`, `/demo/prices`, `/demo/packs`,
`/demo/analytics`, `/demo/guides`, `/demo/scan`.

The floating "N" badge and palm-tree badge visible in dev screenshots are the
Next.js dev indicator and the TanStack Query devtools — dev-only, not counted
as findings.

25 findings: 4 blockers, 3 desktop layout, 5 data coherence, 6 mobile,
7 polish.

---

## Outcome (updated after the fix pass)

All 25 findings were worked. **All 25 are now resolved** — 24 fixed and
verified in a browser, and finding 24 closed as a wrong premise (see below).
Verification re-ran the exact measurement behind each finding against the
demo's real shipped artifact (the `DEMO_EXPORT=true` static export), not
against a dev server: **33 of 33 automated checks pass**.

| # | Finding | Status |
| --- | --- | --- |
| 01 | Account menu off-screen | Fixed — rightmost control now ends at 1244/1330/1370/1418/1450/1610 for 1280→1920 |
| 02 | Logo clipped to "TCGe" | Fixed — link measures 101px at every width (was 69px) |
| 03 | `/demo/guides` has no nav | Fixed — 12 header controls present |
| 04 | Analytics chart draws no bars | Fixed — 6 bars, heights 119–152px in a 192px row; live app too |
| 05 | Wishlist sidebar clipped 33px | Fixed — button 280px, labels read 92% / 100% / 75% |
| 06 | Card explorer dead space | Fixed — page height 900px against a 900px viewport |
| 07 | Placeholder truncated | Fixed — 222px input, placeholder fits |
| 08 | Totals disagree / drift | Fixed — dashboard, analytics and prices all read 68 cards / $1430.07, identical across fresh sessions |
| 09 | Set completion contradicts itself | Fixed — list and detail both read 6/7 for MH2 |
| 10 | Exact printings 0/N | Fixed — MH2 6/7, LOB 4/6, STA 3/3 |
| 11 | Activity all one date | Fixed — 4 distinct dates |
| 12 | `catalog/manifest.json` 404 | Fixed — no 4xx on any demo route |
| 13 | Trades scrolls sideways | Fixed — scrollWidth 390 against a 390px viewport |
| 14 | Price columns clipped | Fixed — 41 change values fully on-screen |
| 15 | Header/button collision | Fixed on trades, decks and sealed |
| 16 | Desktop placeholders on mobile | Fixed on decks and collections |
| 17 | Sub-44px tap targets | Fixed — 44×44 `::before`, visual glyph unchanged |
| 18 | Wishlist detail cramped | Fixed — title no longer truncates |
| 19 | Unexplained disabled actions | Fixed on all three |
| 20 | Scan is a dead end | Fixed — dropped from demo primary nav, still reachable from More |
| 21 | Packs ships its dev HUD | Fixed — hidden in a production build, `?debug=1` opts in |
| 22 | Every tab titled "TCGer Demo" | Fixed — 12/12 distinct titles |
| 23 | Dashboard has no `<h1>` | Fixed |
| 24 | Placeholder card art | Not a defect — real art arrives via catalog enrichment; backs are the correct fallback |
| 25 | Guides opens on an empty guide | Fixed — opens on the index |

`tsc --noEmit` clean, 14/14 tests pass, lint 0 errors. Warnings went 75 → 80
across all three passes, every one of them an instance of the `mounted`-flag
`set-state-in-effect` pattern that `dashboard-content.tsx` already uses and
already warns on.

### Corrections to this review

- **Finding 08 was wrong about Decks.** "156 total cards" was never
  hardcoded — the page already summed `quantity` across all six decks
  (31+36+30+17+13+29). It is legitimately a different figure from the
  collection total, so the value stayed and only the label changed to
  "Cards Across Decks".
- **The unnamed control in "What holds up" was a false positive.** The audit
  did not filter on visibility, so it flagged a Radix `Select` trigger inside
  the `hidden lg:block` inspector — in the DOM, never reachable at 390px.
  Adding `aria-label` there would have been actively wrong: on a
  `role="combobox"` trigger it replaces the name computed from content,
  trading the announced value for a static field name.
- **Finding 16's premise was partly wrong.** Decks does not expand inline on
  mobile; the detail renders full-width below all six deck cards. Only the
  empty placeholder is hidden, so a selected deck still renders at every width.

### Resolved — finding 24 was wrong about its own cause

**24 — placeholder card art.** The claim that this needed licensed images or a
live API was incorrect, and so was the reasoning behind it. It is true that
`DemoCard` carries no image field, but that is not where demo card art comes
from. The offline catalog packs carry `imageUrl` / `imageUrlSmall` per card
(`docs/catalog-pack-format.md`), and the demo store already has
`enrichCardsFromCatalog`, which matches seeded demo cards against an installed
catalog and writes the real image URLs onto them. It is wired to run
automatically — from `use-catalog.ts` after an install, and from three points
in `demo-adapter.ts`. The deployed demo sets `NEXT_PUBLIC_CATALOG_BASE_URL`
(`.github/workflows/pages.yml:85`) and surfaces `CatalogDownloadPrompt`, so a
visitor can install a catalog and the art appears.

The card backs are the correct pre-catalog fallback, and they are already
implemented properly: `src/components/cards/card-image.tsx` takes the real
`src` when present, falls back to the per-game back
(`public/card-backs/{game}.png`), paints the same back as a CSS background so
there is no flash of empty box, and re-falls-back on `onError`. Alt text comes
from the caller and names the card.

The only reason the review saw nothing but backs is that local testing had no
catalog origin configured — which is the same root cause as finding 12's
`/catalog/manifest.json` 404. No code change was needed.

### New findings from the fix pass

**26. `/sets/[tcg]/[setCode]` 500s in a server build (pre-existing).** Under
`next start`, the route throws *"Page changed from static to dynamic at
runtime, reason: headers"* — it is prerendered via `generateStaticParams` but
`getToken()` reads `headers()` at request time. Confirmed pre-existing: it
reproduces with our only file under that directory removed. The demo is
unaffected because it ships as a static export, where the route prerenders
correctly and returns 6/7 — but the **live app** serves this route the same
way and would hit it. Fixing it means choosing a rendering strategy for that
route, which is beyond this review's scope.

**27. Two shared UI primitives carry traps that will recur.**
`src/components/ui/tabs.tsx:33` puts `min-w-[120px]` on every `TabsTrigger`
while `TabsList` never wraps — that is what made trades overflow, and it will
do the same to any other narrow tab row. `src/components/ui/scroll-area.tsx`
forwards no viewport className, so its `display: table` content wrapper cannot
be overridden by consumers — that is what clipped the wishlist sidebar. Both
were worked around at the call site; fixing them at the source would prevent
recurrence.

### Round two — completeness and interaction pass

A follow-up pass asked for the interfaces to read as finished rather than beta,
and for the interaction screens to make sense. An automated crawl clicked every
visible control on all 13 demo routes at both viewports (1,040 clicks, each
after a fresh page load) and recorded whether anything observable happened.

Most of what it flagged was probe error, not product error — worth recording so
the same conclusions are not re-derived:

| Flagged | Reality |
| --- | --- |
| Sealed sort tabs do nothing | Works; the crawler's index shifted after its reload |
| Mobile price sort does nothing | Works; the row selector matched the wrong elements |
| Dashboard set-completion card is dead | It is already an `<a>` to the set page |
| Wishlist delete does nothing | It uses `window.confirm`, which Playwright auto-dismisses |

Four genuine problems came out of it:

**Beta and coming-soon markers on features that work.** The Collection sandbox
carried a "Beta" badge over 4.5k lines of complete per-copy CRUD with no TODOs.
The command menu's only Utilities entry read "View price analytics (coming
soon)" and dismissed itself, while Analytics and Prices both exist. Account
settings offered "Dark mode — sync theme across devices (coming soon)" behind a
disabled button, while the user menu has had a working theme toggle all along.
All three now do the thing they advertise. The Card Scan page-level "Beta" is
gone too, but the Video Scan "Experimental" badge stays: it is an on-device
model that supports Pokémon today, and that caveat is honest.

**Trades, Decks and Sealed were stubs of finished features.** The live app has
full `createTrade` / `createDeck` / `createSealedOpening` flows. The demo could
not reach them because `demo-adapter` routes only auth, collections, wishlists,
guides, users, settings and setup — so each page held a local `const` array and
a disabled button. Their seed data moved to `src/lib/data/demo-portfolio.ts`
and the demo store now owns them alongside binders and wishlists, so the create
flows work and what you create survives navigation and reload.

**Six native browser dialogs.** `window.confirm` × 5 and `window.alert` × 1,
in an app with a full Radix dialog system. Native dialogs ignore the theme,
cannot be dismissed like the rest of the UI, and are suppressed outright in
some embedded contexts — which silently turns "are you sure?" into "yes". They
are now a promise-based `useConfirm` built on the existing Dialog, with no new
dependency.

**Two mouse-only controls.** The price table's sort headers were bare
`<th onClick>` — no keyboard access, no announced sort state. Deck cards were
clickable `<div>`s. Both are now real controls with `aria-sort` / `aria-pressed`
and keyboard handling, with the visuals unchanged.

Verified against the demo's real static export: create/persist round-trips on
all three pages, no Beta or coming-soon copy on any of the 13 routes, the packs
debug HUD still gated, zero native dialogs and zero 4xx across the run. The
original 33 regression checks still pass — three were rewritten, since they
asserted the old "disabled with an explanatory tooltip" behaviour that working
buttons have now superseded.

### Follow-ups not taken

All three of the follow-ups previously listed here are now done.

- **Scan (20) — done.** `/scan` needs the server-side hash store and upload
  API, so in the demo it can only say "disabled" while occupying one of five
  desktop nav slots and one of three mobile tabs. `primaryNavigation` is now
  derived from `demoMode` with `/scan` filtered out, and Scan moved into the
  More sheet where it still explains why it is off. Live mode is unchanged.
- **Tablet game filter — done.** Measured headroom with the switcher hidden:
  222px free at 640, **110px at 768**, 242px at 900, 365px at 1023, against a
  212px switcher. So the dead zone was never the whole 640–1023 band, only
  roughly 768–830, where the five-item nav appears while the container is
  still narrow. Moving the "Quick Actions" label and ⌘K badge to `lg:` frees
  ~134px there, which is enough; the switcher is back at `sm:flex` and visible
  at every width from 640 up. The trigger is icon-only below `lg`, so it
  gained an `aria-label` and `title`.
- **Deck scroll-into-view — done.** Selecting a deck below `lg` now scrolls
  the detail into view, guarded to the stacked layout and honouring
  `prefers-reduced-motion`, with `scroll-mt-20` keeping it clear of the fixed
  header.

---

## Blockers

### 1. The account menu is completely off-screen at every common laptop width

The header is one non-wrapping row: logo + Demo badge + 5 nav buttons + Quick
Actions + 6-way game switcher + user menu. At `xl` (≥1280px) both the nav
labels *and* the game labels expand, so the row needs ~1501px of content while
`.container` caps it at 1360px. Everything past that is pushed off the right
edge.

Measured position of the user-menu trigger (last button in the header):

| Viewport | User menu (left – right) | Reachable? |
| --- | --- | --- |
| 1280 | past the right edge | no |
| 1366 | 1465 – 1501 | **no** |
| 1440 | 1499 – 1535 | **no** |
| 1536 | 1547 – 1583 | **no** |
| 1600 | 1579 – 1615 | partially |
| 1700 | 1629 – 1665 | yes |

The user menu is where the theme toggle and Sign out / exit-demo live
(`src/components/navigation/user-menu.tsx:174,192`). So on a 1366, 1440 or
1536 laptop a demo visitor cannot switch to dark mode and cannot leave the
demo. The "Pokémon" chip of the game switcher is cut off at the same widths.

Source: `src/components/layout/app-shell.tsx:98-172`, with the long labels from
`src/components/navigation/game-switcher.tsx:80-82`.

Fix: move the nav/game labels to a higher breakpoint (or keep the game switcher
icon-only below ~1600px), and give the right-hand cluster `shrink-0` so the
user menu is never what gets pushed out.

### 2. The logo wordmark renders as "TCGe"

`src/components/layout/app-shell.tsx:103` — the logo `<Link>` has no
`shrink-0`, so it is the first flex item compressed when the header overflows.
It measures 69px against 101px of intrinsic width, clipping the final "r".
Visible at **every** width ≥1280px, including 1920.

### 3. `/demo/guides` renders with no navigation at all

`app/demo/guides/page.tsx` is the only one of the 14 demo routes that doesn't
wrap its content in `<AppShell>` — all the others do. Result: no header, no
logo, no game switcher, no mobile bottom nav. It's reachable from the mobile
"More" menu and the desktop ⌘K menu, and once there the only way out is the
browser back button.

### 4. "Collection Value Over Time" renders zero bars

`app/demo/analytics/page.tsx:140-157`. The bar's parent column is
`flex flex-1 flex-col` with auto height inside an `items-end h-48` row, so the
bar's `style={{ height: "<pct>%" }}` has no definite parent height to resolve
against and collapses to zero. Only the `$1420 … $2045` value labels and the
month labels render; the chart body is blank on desktop and mobile.

**The same bug ships in the live app** at `app/analytics/page.tsx:332-349`.

Fix: give the column `h-full` and wrap the bar in a
`flex-1 w-full flex items-end` container, or size the bar with flex-basis
instead of a percentage height.

---

## Desktop layout

### 5. The wishlist sidebar is clipped 33px short

`src/components/wishlists/wishlist-content.tsx:1354` puts the sidebar inside a
Radix `<ScrollArea>` in a `lg:grid-cols-[280px_1fr]` grid. Radix's scroll
viewport renders its child with `display: table`, which sizes to content rather
than to the 280px viewport — measured: viewport `clientWidth` 280,
`scrollWidth` 313, inner wrapper 313px, and the `w-full` "New Wishlist" button
laid out at 313px. The viewport is `overflow-x: hidden`, so the last 33px is
cut off: every completion percentage loses its `%` sign (`92`, `100`, `75`),
every progress bar runs past the card border, and the primary button is sliced.

Fix: add `w-full` / `min-w-0` to the ScrollArea viewport child (shadcn's
`ScrollArea` accepts a `viewportClassName`-style override), or drop the
ScrollArea here and let the column scroll with the page.

### 6. A full screen of dead space under the Card Explorer results panel

`src/components/cards/card-search-panel.tsx:184` pins the results `ScrollArea`
to `h-[calc(100vh-280px)]` regardless of content, so "No results yet. Try
adjusting your query or game filter." is followed by ~620px of empty card on
desktop and ~560px on mobile. Since Card Explorer is a top-level nav item, this
empty frame is one of the first things a visitor sees.

### 7. The Card Explorer keyword input truncates its own placeholder

The desktop sidebar input is 174px wide against a 42-character placeholder, so
it reads "Search cards by nam". Widen the field or shorten the placeholder.

---

## Data coherence

### 8. Collection totals disagree between pages, and change on every visit

`src/stores/demo-store.ts` seeds card quantities and conditions with
`Math.random()` (lines 178, 230, 240, 250, 260, 278), so the dashboard total
differs every session. Across four loads I recorded **73 / 70 / 68 / 64 cards**
and **$1427.67 / $1501.93 / $1341.87 / $1468.17**. Card-distribution
percentages and per-copy conditions shift with them.

The other pages are hardcoded to unrelated figures:

| Page | Says |
| --- | --- |
| Dashboard | 64–73 cards, ~$1.4k (random each load) |
| Analytics | 135 cards, $2045.50 |
| Prices | 20 tracked cards, $1049.78 |
| Decks | 156 total cards |
| Sealed | 22 items, $1961.00 |

A visitor clicking through the demo gets four different answers to "how big is
my collection?". Seeding the store from a fixed seed, and deriving the
analytics/prices headline numbers from that same store, fixes both halves.

### 9. Set completion contradicts itself

`/demo/sets` shows *Modern Horizons 2 — "6 unique prints owned", 6/6*, full
green bar, completion check. `/demo/sets/magic/MH2` shows *"0 / 7 unique
printings owned · 0% complete"* and offers "Select" on all seven cards. Both
the numerator and the denominator disagree.

### 10. Every "Exact printings" row reads 0/N · 0%

Dashboard set completion shows 0% exact printings for all three featured sets,
because the seeded copies carry no printing IDs. A working feature reads as
broken.

### 11. Recent Activity is all one date

`seedBinders()` stamps `addedAt: now` on every card
(`src/stores/demo-store.ts:197,212`), so all five Recent Activity rows show the
same day. Spreading the timestamps over a few weeks would make the panel look
alive.

### 12. `/catalog/manifest.json` 404s on every page

`src/lib/catalog/catalog-client.ts:246` fetches it; the asset isn't in the demo
build, so every page load logs a console 404.

---

## Mobile

### 13. `/demo/trades` scrolls horizontally

Page `scrollWidth` is 517px against a 390px viewport. The four filter tabs
(`All (7)` / `Pending (2)` / `Completed (4)` / `Declined (1)`) are fixed at
~120px each = 517px, which drags the *entire page* — header, cards, everything
— sideways. Let the tab row wrap, or make it its own horizontal scroller.

### 14. Price Tracker loses its data columns on mobile

The table's inner scroller is 396px inside a 340px box. The 7d and 30d change
columns are clipped with no scroll affordance and the Set column is dropped
entirely — the price-movement data is the point of the page. A stacked
card-per-row layout below `sm` would serve it better.

### 15. Page headers collide with their action button

On Trades, Decks and Sealed the `<h1>` and description share a row with the
action button. At 390px the title wraps to two lines and the button crowds it;
Sealed is worst, with "Sealed Products" wrapping underneath a floating "Add
Product". Stack the button below the header under `sm`.

### 16. Desktop-only detail placeholders render on mobile

`/demo/decks` shows a large empty "Select a deck to view its contents" card at
the bottom of the phone layout even though tapping a deck expands inline. Same
pattern on `/demo/collections`. Hide the placeholder below `md`.

### 17. Sub-44px tap targets in the collection sandbox

38 interactive controls under 40px on `/demo/collections` at 390px — the row
expand/collapse `+`/`−` buttons are 24×24. That clears WCAG 2.5.8 AA by
exactly nothing and misses both iOS HIG and WCAG 2.5.5 AAA (≥44px).

### 18. The wishlist detail panel is cramped

Title truncates to "Scarlet & …" with room to spare, "8 / 8 owned" wraps around
the "100% complete" pill, the destructive delete button gets equal visual
weight to "Add", and the inner card list cuts a card mid-row at the container
bottom.

---

## Polish

### 19. Disabled actions with no explanation

"New Trade" (`app/demo/trades/page.tsx:181`), "New Deck"
(`app/demo/decks/page.tsx:399`) and "Add Product"
(`app/demo/sealed/page.tsx:188`) are `disabled` with no tooltip. Greyed-out
buttons read as broken, not as out-of-scope. A `title="Not available in the
demo"` — or better, letting them work against the local demo store — fixes the
impression.

### 20. Scan is a primary nav item and a dead end

`/demo/scan` is one of only three primary mobile tabs and one of five desktop
nav items, and it renders "Scan is disabled in demo mode". Consider demoting it
in demo mode, or replaying a canned scan so the flagship feature is at least
visible.

### 21. Pack Opening Lab ships its dev HUD

`/demo/packs` renders a `phase / revealed / Force chase / Slow-mo` debug panel
and describes itself as "Dev sandbox for the TCG Pocket–style booster opening.
Not linked from navigation — direct URL only" — but it is part of the demo
export and reachable. On mobile the "Swipe to browse · drag a pack to spin it ·
tap to open" hint is clipped behind the bottom nav and the pack carousel
overflows both viewport edges. Either polish it into a real demo page or drop
it from the export.

### 22. Every tab is titled "TCGer Demo"

`app/demo/layout.tsx` sets one title for the whole tree; only `/demo/packs`
overrides it. Tab titles, browser history and shared links are all
indistinguishable.

### 23. The dashboard has no `<h1>`

Every other demo page opens with a heading; `/demo/dashboard` goes straight
into the stat cards. Consistency and screen-reader gap.

### 24. Card art is a placeholder back everywhere

Wishlists, set detail and guides render the generic card back for every card,
so the wishlist grid is a wall of identical Pokéballs and the MH2 set page is
seven identical Magic backs. For a demo whose pitch is collection management
this undersells the product more than anything else on this list.

### 25. Guides opens on an empty guide

`/demo/guides` lands on "Pokémon Clay Art" showing "0 matching cards" plus a
"Follow and add missing cards" CTA. First impression of the feature is an empty
list — open on the guide index, or seed a guide that has matches.

---

## What holds up

- Dark mode renders correctly on every page checked, desktop and mobile.
- No JS errors, no broken `<img>`s, no missing `alt` attributes, and no unnamed
  buttons or links (one unnamed Radix combobox trigger on `/demo/collections`).
- No page-level horizontal overflow anywhere except `/demo/trades`.
- The mobile "More" menu, the wishlist master→detail transition, collection row
  expansion, set browsing, and the sealed / prices / analytics list layouts all
  work as intended.
- Sealed product arithmetic checks out — per-row values sum to the $1961.00
  headline, and profit and ROI are consistent with it.

---

## Suggested order

1. Header overflow (#1, #2) — it costs the demo its theme toggle and its exit.
2. `/demo/guides` AppShell (#3) — one line, removes a navigational dead end.
3. Analytics chart (#4) — one line, and it also ships in the live app.
4. Wishlist sidebar clipping (#5) — small fix, very visible.
5. Demo data coherence (#8–#11) — the loudest "this is a mockup" signal.
6. Mobile trades overflow (#13) and the price table (#14).
7. The rest as polish.
