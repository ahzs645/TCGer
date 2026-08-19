# Web ↔ iOS presentation parity, and a first-run-only pack spotlight

**Date:** 2026-08-19
**Branch:** `claude/desktop-mobile-interface-review-c59mkx`
**Scope:** `frontend/` — shared per-game presentation, plus the dashboard's pack-opening pitch.

Two asks, answered in one pass:

1. The iOS client shares presentation decisions that the web client did not — the
   question was framed around "icons that it uses for sets etc".
2. The dashboard's "Open a pack" panel should be a first-run hint, not a permanent
   fixture.

---

## Part 1 — one source for how a game looks

### What iOS has that the web did not

iOS answers "how does this game look" in exactly one place: `TCGGame` in
`TCGModels.swift` (display name, short name, icon) plus
`TCGGame+Presentation.swift` (`brandColor`). Every view reads from it, so a
Yu-Gi-Oh! chip in the collection list and one in the deck header are the same
colour by construction.

The web client had **eight** separate copies of that decision, and they
disagreed:

| Source | yugioh | magic | pokemon | onepiece | lorcana | dragonball |
|---|---|---|---|---|---|---|
| iOS `TCGGame.brandColor` | `#6C4AB0` | `#A5732C` | `#3D7DCA` | `#CD2F3A` | `#8F6E1E` | `#CC4E0F` |
| `stores/demo-store.ts` | `#ef4444` | `#8b5cf6` | `#f59e0b` | `#0ea5e9` | `#14b8a6` | `#f97316` |
| `app/sealed`, `app/decks` (+ demo twins) | `#ef4444` | `#8b5cf6` | `#f59e0b` | `#0ea5e9` | `#a855f7` | `#f97316` |
| `app/prices` (+ demo twin) | `#ef4444` | `#8b5cf6` | `#f59e0b` | — | — | — |
| `components/cards/set-symbol.tsx` | violet | amber | red | sky | fuchsia | orange |

Three consequences, all visible:

- **Pokémon was three different colours** depending on the page — amber in the
  price table, red on a set symbol, blue on iOS.
- **Three of the six games had no colour at all** on the prices pages, because
  those maps only covered three games and the lookup fell through to
  `undefined`.
- **`set-symbol` disagreed with everything**, so the fallback badge for a set
  with no artwork was tinted from a palette no other component used.

Separately, the icon path map (`/icons/Yugioh.svg` …) was duplicated in
`navigation/game-switcher.tsx` and `account/account-settings-dialog.tsx`.

### What changed

**`src/lib/games.ts` (new)** — the single source, ported field for field from
`TCGGame` and `TCGGame+Presentation.swift`: `label` (matches iOS `displayName`),
`shortLabel` (matches `shortName`), `color` (matches `brandColor` exactly), and
`icon`. `gamePresentation()` resolves by game code *or* display name — the demo
fixtures label games `"Yu-Gi-Oh!"` rather than `"yugioh"`, which is why three of
the eight maps were keyed by name — and falls back to a neutral grey rather than
rendering an uncoloured chip.

**`src/components/cards/game-badge.tsx` (new)** — the chip itself. Border, fill
and text all derive from the one colour; the mark is painted with `mask-image`
plus `background-color` rather than an `<img>`, because the artwork ships as
solid black and a mask reproduces the exact brand colour in either theme instead
of approximating it with a filter chain.

All eight colour maps and both icon maps are deleted. Every game chip now reads
from `games.ts`:

| File | Change |
|---|---|
| `src/lib/games.ts` | new — the source |
| `src/components/cards/game-badge.tsx` | new — the chip |
| `src/components/cards/set-symbol.tsx` | dropped its own palette; fallback badge now uses the brand colour at the same 12% fill / 40% border as iOS `SetArtworkView.fallbackBadge` |
| `src/components/navigation/game-switcher.tsx` | icon map deleted; "no mark" now drives the `Layers` fallback instead of a separate `game === "all"` test |
| `src/components/account/account-settings-dialog.tsx` | icon map deleted |
| `app/sealed`, `app/prices`, `app/decks` (+ all three demo twins) | colour maps deleted, chips swapped to `GameBadge` |
| `src/stores/demo-store.ts` | `GAME_COLORS` deleted |
| `src/components/sets/set-detail.tsx` | outline badge → `GameBadge … long` |
| `src/components/collections/bulk-add-dialog.tsx` | two outline badges → `GameBadge` |
| `src/components/wishlists/wishlist-content.tsx` | outline badge → `GameBadge` |
| `app/shared/[shareToken]/page.tsx` | was rendering the raw code (`"magic"`) → `GameBadge` |
| `app/demo/shared/[shareToken]/demo-shared-binder.tsx` | outline badge → `GameBadge` |

Two demo pages were also rendering the bare game code where the live page
rendered a label (`app/demo/decks` deck header, `app/demo/prices` table); both
now match.

### On set icons specifically

The web `SetSymbol` was already at parity and is now exactly so. Both clients
try `iconUrl → iconFallbackUrl → logoUrl` in order, fall through on load
failure, and land on a monospaced set-code badge — Yu-Gi-Oh! truncated at the
hyphen, everything else at five characters. The one thing that differed was the
fallback badge's tint, which came from `set-symbol`'s private palette; it now
comes from the shared brand colour, so a Pokémon set with no artwork is Pokémon
blue on both clients rather than blue on iOS and red on the web.

---

## Part 2 — the pack spotlight is a first-run hint

`PackOpeningSpotlight` rendered unconditionally at the top of the dashboard, on
every visit, forever. It is an onboarding pitch; after the first pack it is an
ad occupying the most valuable space on the page.

### The signal

`tcger-saved-pack-openings` was the obvious candidate, but saving is optional —
the opener only writes it when the visitor taps "Save pulls" — so someone who
opens ten packs without saving would still be pitched. A separate milestone key
records the fact directly.

**`src/lib/packs/opening-history.ts` (new)** now owns every pack-history read and
write: the saved-openings store (`subscribe`/`snapshot`/`parse`/`persist`/`remove`,
lifted out of `pack-opening.tsx`), the `tcger:pack-opened` milestone, the
spotlight dismissal, and the `usePackOpeningSpotlight()` hook.

It is a separate module for a specific reason: the dashboard needs the answer,
and `pack-opening.tsx` drags in the whole three.js opening scene. Importing from
here keeps the renderer out of the dashboard bundle — the only `@tcg/pack-core`
reference in the new module is an erased `import type`.

The opener calls `recordPackOpened()` on any native-state update whose phase is
past `select`. It is guarded by a module-level boolean, so the common path
during an opening is a boolean check rather than a `localStorage` read.

### The gate

The hook returns `visible: false` until the first client render resolves it.
`useSyncExternalStore`'s server snapshot deliberately reports "unknown": the
server cannot know, and flashing the pitch at someone who has opened dozens of
packs and then pulling it away a frame later is worse than showing it a frame
late to someone who has opened none. In practice neither happens, because the
dashboard renders skeletons until its data lands.

The spotlight also gained a dismiss control (a 44×44 ghost `×` beside the CTA,
sharing the row so it never overlaps the copy at any width) for visitors who
simply are not interested. The dismissal survives a storage write being refused
— private browsing keeps it for the session rather than ignoring the click.

### Storage registry

Three keys were added to `src/lib/storage/keys.ts`, each with the consequence-of-
clearing note the file requires. `tcger-saved-pack-openings` had been live and
unregistered since the history dialog shipped, so `clearAllLocalData()` was
leaving it behind; it is now swept like everything else.

| Key | Meaning | Cleared |
|---|---|---|
| `tcger-saved-pack-openings` | saved opening sessions, newest first | browser-side history gone; pulls also saved to a collection survive |
| `tcger:pack-opened` | `"1"` once a pack has actually been opened | the spotlight returns |
| `tcger:pack-spotlight-dismissed` | `"1"` if dismissed without opening one | the spotlight returns |

---

## Verification

- `tsc --noEmit` clean.
- `npm test` — 101/101.
- `eslint` — 0 errors, 80 warnings across `src/` and `app/`, all pre-existing
  `react-hooks/set-state-in-effect` reports in effects this pass did not touch.
  (Earlier passes quoted a much larger figure; that count was dominated by the
  gitignored `.next-docker/` build output eslint was walking.)
- **Route sweep**, 17 routes × desktop 1440 and iPhone 15 Pro: no page scrolls
  horizontally, no broken images, and zero console or page errors on all 34
  combinations. Touch emulation was asserted per route (`pointer: coarse` true on
  every mobile row, false on every desktop row) rather than assumed — full-page
  screenshots silently disable it, which is why they are not taken here.
- **Badge colours read back from the DOM** in both themes: computed colour and
  painted mask colour equal the iOS `brandColor` exactly — Pokémon
  `rgb(61, 125, 202)`, Yu-Gi-Oh! `rgb(108, 74, 176)`, Magic `rgb(165, 115, 44)`.
- **Spotlight, driven end to end**: fresh visitor sees it → opening a pack sets
  `tcger:pack-opened` → the dashboard no longer shows it. Dismissing hides it
  immediately and after a reload. Mobile: no overflow, dismiss target 44×44.
- **The refactored history path**: seeded store reads back as "Saved openings
  (1)", the dialog lists it, and the delete control removes it — no console
  errors.

Four audit findings were examined and are not defects:

- Desktop tap targets below 44px — the rule is `coarse:`-scoped, so it applies
  under `pointer: coarse` only; desktop mouse targets are 36–40px by design.
- One "overflowing" element on the mobile dashboard — the spotlight's decorative
  blur, deliberately positioned outside the card and clipped by its
  `overflow-hidden`. `scrollWidth === innerWidth` on that route.
- One unnamed 1×1 control on `/demo/packs` — an `sr-only` file input.
- Five unnamed controls on desktop `/demo/collections` — the same false positive
  documented in the fixes pass: the audit's name resolver consults `label[for]`
  for `<input>` only, and these are a `<button>` trigger, three checkbox buttons
  and a `<textarea>`, all correctly associated via `<Label htmlFor>`.
