# The local runtime, as it stands

**Status:** Description of the system as built. Written after Stages 0–4 of
`docs/data-layer-dexie-convex-plan.md` and steps 1–3 of the corrected Stage 5
sequencing (§9 of that document). The local runtime's collection now runs on the
portable contract; the Convex adapter is the remaining step (§7).

**What this describes:** how TCGer stores data today, on each of its runtimes,
and exactly how far the "one application, two interchangeable storage runtimes"
goal has been carried.

---

## 1. The runtimes

TCGer selects one storage runtime at startup and never syncs between them. This
is societyer's pattern; there is no sync engine, no offline queue and no
conflict resolution anywhere in the codebase, by design.

| Runtime | Where it runs | Storage | Status |
|---|---|---|---|
| **Convex** | hosted site | Convex tables, reached through the Express bridge | shipping |
| **iOS on-device** | iPhone, no server | `LocalStore` (`APIService.swift`, 2,447 lines) behind 104 `isOnDevice` branches | shipping |
| **Web local** | the demo today; PWA / desktop tomorrow | IndexedDB via Dexie | shipping as "the demo" |

The web local runtime is the one being generalised. It is currently reached only
through demo mode, but nothing about it is demo-specific except the fixtures it
seeds.

## 2. Web local runtime: storage layout

Two IndexedDB databases, both via Dexie. Every key and database name is
registered in `frontend/src/lib/storage/keys.ts` — that file is the inventory,
and `clearAllLocalData()` there is the only correct way to wipe local state.

### `tcger-demo` — application state

Dexie v1 (native 1). Two stores:

- `records` (`&key`) — one row per *slice* of application state:
  `profile`, `preferences`, `collectionRows`, `wishlists`, `decks`, `trades`,
  `sealed`, `initialized`.
- `meta` (`&key`) — `schemaVersion` (currently **2**) and `legacyImport`.

`collectionRows` holds the collection as portable rows (`binders`,
`collectionEntries`, `cards`). Schema 1 stored it as the nested
`binders[].cards[].copies[]` array instead; see the migration below.

Behind `DemoPersistence` (`frontend/src/lib/storage/demo-persistence.ts`), a
four-method contract: `whenHydrated`, `snapshot`, `commit`, `clear`. Two
implementations ship — Dexie (`demo-db.ts`) and in-memory
(`createMemoryPersistence`), the latter used whenever IndexedDB is unavailable
so blocked storage degrades instead of breaking.

**Migration history.** Two steps, both exercised in a browser rather than
reasoned about.

*Pre-Dexie → schema 1.* A pre-Dexie release stored everything in one
`localStorage` key via `zustand/persist`. On first boot `demo-db.ts` imports
that payload, stamps it as schema 1, runs the normal migration path over it, and
only then deletes the localStorage key. An unreadable payload is left byte for
byte intact and the visitor gets a fresh demo rather than a broken one.

*Schema 1 → 2: nested collection to rows.* `migrateNestedCollection` converts
`binders[].cards[].copies[]` into rows with `toPortableRows`, preserving ids —
a binder id is in the collections URL and a copy id is what the REST contract
hands out as a card's id. Cards from before `copies` existed are expanded into
one row per copy. The old `binders` record is left in place rather than deleted.

The nested value can arrive by **two** routes and the migration reads both,
which is the part that is easy to get wrong:

| Route | Where the nested value is | Why |
|---|---|---|
| stored schema 1 | the `binders` record on disk | read with `db.records.get` **directly** — `readRecordRows` filters against `DEMO_SLICES`, which no longer contains `binders`, so going through the hydrated state would see nothing |
| localStorage import | in memory, in the imported state | the import never persists it, for the same slice-filter reason — so the in-memory value is preferred |

Reading only from disk was a real bug, caught by testing: a legacy visitor
migrated to an empty collection while the version stamp advanced to 2.

**Write granularity.** Slice-level: a slice is committed when its *reference*
stops matching what was last written. The collection is one slice, so a card
edit still rewrites the `collectionRows` record. `LocalPortableDb` already
tracks which *tables* a mutation touched (`onCommit` reports them), so making
the persistence layer write per table rather than per slice is now a change to
`demo-db.ts` alone — the information it needs is already there.

### `tcger-catalog` — downloaded card catalogs

Dexie `version(0.1)`, which maps to native IndexedDB version **1**. Two stores,
`packs` (keyPath `tcg`) and `cards` (keyPath `["tcg","id"]`, indexes `by-tcg`
and `by-tcg-set`).

Two Dexie behaviours make this file unusual and it is commented accordingly:

- Dexie opens at `Math.round(verno * 10)`, so `version(1)` would request native
  version **10** and force a one-way upgrade on every existing install. `0.1`
  maps to native 1 — what is already on disk.
- `stores()` derives index names from key paths and cannot name them, so the
  object stores are still created by a verbatim copy of the released
  `onupgradeneeded`. The Dexie block *describes* that schema rather than
  building a different one.

Up to ~20 MB per game. Reads degrade to empty with one warning; writes reject,
because `replaceCatalog` returns the installed pack and a swallowed failure
would report a successful install of a catalog that is not there.

### Other local keys

`theme` (next-themes), `keyval-store` (tesseract.js), the service worker's Cache
Storage buckets, and the scan cache (`use-video-scan-data.ts`, Dexie). All
registered in `keys.ts`.

## 3. How a request is served

Demo mode installs a `fetch` interceptor. Every API call in the app is answered
by `frontend/src/lib/api/demo-adapter.ts`, which speaks the same REST contract
the hosted site does — so UI components cannot tell the runtimes apart, and the
same fixture table can be run against both.

```
component → fetch → demo-adapter → demo-store (zustand) → DemoPersistence → Dexie
component → fetch → Express → Convex HTTP → bridge.ts → ctx.db          (hosted)
```

`handleDemoRequest` awaits hydration before answering anything, because
IndexedDB is asynchronous where localStorage was not: without it, the first
request after a cold load would answer from a store that is empty only because
the read has not landed, and `init()` could seed over a returning visitor's
collection.

## 4. The portable contract

`packages/api-types/src/portable-db.ts`. Six methods — `get`, `insert`, `patch`,
`delete`, `query`, `transaction` — plus `normalizeId`.

It is small because it was **measured, not designed**: across `convex/bridge.ts`
and `convex/lib/library.ts` the handlers use five `ctx.db` verbs, and every read
is an equality lookup on an index prefix. No range predicates, no server-side
filters, no pagination. `docs/portable-db-contract.md` records the counts.

`transaction` is in the contract because every Convex mutation path is atomic; a
half-applied quantity reconciliation leaves a collection in a state no rule
describes.

**Implementations:**

- `frontend/src/lib/storage/local-portable-db.ts` — working set in memory, row
  level write-through, buffered transactions. The same arrangement iOS
  `LocalStore` already uses, and what lets React selectors read synchronously
  above an async contract.
- Convex's own `ctx.db` satisfies the contract structurally; the adapter would
  be a translation layer, and has not been written yet.

## 5. The shared rules

`packages/api-types/src/collection-rules.ts` — add, update, move, remove,
written once against the contract. `collection-projection.ts` turns rows back
into the grouped REST shape (the logic that existed twice as `toLegacyBinder`
and a hand copy in the demo adapter).

`legacy-collection-rows.ts` converts between the shipped nested shape and rows,
in both directions, losslessly. Card rows are keyed by the **demo card id**, not
the external id: `DemoBinderCard.cardId` is what every ownership check compares
against, and it stops matching `externalId` once catalog enrichment attaches a
real printing id to a seeded card.

**These are live.** Every collection mutation in the local runtime goes through
`collection-rules.ts` over `LocalPortableDb`. `demo-store.ts` no longer
implements add, update, move or remove — the nested `binders` array is a
*derived* read model, regenerated after each mutation and never edited, so the
selectors, ownership checks and catalog enrichment keep reading a shape they
understand without being able to drift from the rows.

## 6. How the rules are pinned

`packages/api-types/src/collection-semantics.ts` is a table of eight
request→expected-response cases, data only. Three harnesses execute it:

| Harness | Runs against |
|---|---|
| `frontend/src/lib/api/collection-semantics.test.ts` | the demo REST adapter |
| `convex-backend/convex/collectionSemantics.test.ts` | the real Convex HTTP router |
| `frontend/src/lib/storage/portable-rules.test.ts` | the extracted rules over the local contract |

A rule only one side implements fails on the others. The table was checked for
teeth rather than assumed to have them: reverting any single rule fix turns
exactly one case red.

This is what makes the switchover in §7 safe to attempt — the specification is
executable before the implementation moves.

## 6a. How this was verified

The demo ships as a **static export** to GitHub Pages (`npm run build:demo`,
`output: 'export'`), so a dev-server-only check would not have covered the
artifact that actually deploys. Both were run.

| Suite | Dev server | Static export |
|---|---|---|
| storage + both migration routes (11 checks) | pass | pass |
| schema 1 → 2 against a seeded v1 database (6 checks) | pass | pass |
| interface regression (33 checks) | pass | — |
| unit / convex | 56 / 51 | — |

The two migration routes are the ones worth re-running after any change here:
a seeded schema 1 Dexie database, and a `tcg-demo-store` localStorage payload.
Harnesses live in the session scratchpad rather than the repo — they drive a
real browser through Playwright and are not part of CI.

Note on the fetch interceptor: every browser suite exercises it, because demo
mode answers *all* API calls through `maybeHandleDemoFetch` →
`handleDemoRequest`. There is no separate coverage of the URL-matching itself,
but no UI screen renders without it.

## 7. What is not done

**The Convex adapter.** `bridge.ts` still has its own copy of the rules. The
local runtime and the hosted one therefore run the same *semantics* — pinned by
the fixture table in §6 — but not the same *code*. Pointing `bridge.ts` at the
shared rules needs a `PortableDb` adapter over `ctx.db` (a translation layer, no
logic) and requires the Convex bundler to resolve a workspace package for the
first time: `convex-backend` currently imports nothing from `packages/`. That is
a deploy-time question that cannot be answered without a deployment. The fixture
table is imported only by tests and so carries none of that risk.

**Per-table persistence.** See the write-granularity note in §2: the plumbing is
in place, the persistence layer just does not use it yet.

**The rest of the local runtime.** Only the *collection* runs on the contract.
Wishlists, decks, trades and sealed are still nested slices in the demo store.
They have no server-side counterpart that has drifted, so they were not the
urgent case, but a general local runtime wants them on rows too — and the iOS
`LocalStore` already implements all of them by hand, which is the argument for
doing it.

**Known divergences left open**, from
`docs/stage4-shared-collection-semantics.md` §9: quantity validation (server
rejects, demo clamps), the condition vocabulary (enforced on neither live path),
and bulk add (no demo implementation).

**Ids are promotion-safe.** Locally created rows carry an `entityId`
(`packages/api-types/src/ids.ts`) — Crockford base32, time-sortable, unique
without coordination — rather than a value only one runtime could mint. A
Convex `_id` cannot be minted offline, so without this a row created locally
would have to be re-minted on promotion and every reference to it rewritten.
There is no promotion feature yet; this exists so that building one does not
also mean retrofitting identity, which is what societyer's own `ids.ts` header
warns about. Ids carried over by the schema 1 migration keep their original
values and still resolve, because `normalizeId` checks existence rather than
format.

**Moves say what they mean.** `updateCardSchema` carries an explicit `scope`
(`card` | `copy`). Omitted means `copy`, which is what the endpoint always did,
so no existing client changes behaviour; the collection table sends
`scope: "card"` because its UI promises to move the card. This is the fix for
the aliasing described below — the contract gained the expressiveness rather
than the server guessing.

**One product bug recorded rather than fixed.** The grouped response reports a
card's id as its first copy's id, so "move this card" from the collection table
and "move this copy" from the sandbox are byte-identical requests. The clients
disagree about which they mean, so it needs a contract change — an explicit
scope, or non-aliased ids. Moving a 3-copy card from the table currently moves
one copy.
