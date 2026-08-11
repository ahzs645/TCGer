# The local runtime, as it stands

**Status:** Description of the system as built. Written after Stages 0–4 of
`docs/data-layer-dexie-convex-plan.md` and steps 1 and 3 of the corrected
Stage 5 sequencing (§9 of that document).

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
  `profile`, `preferences`, `binders`, `wishlists`, `decks`, `trades`,
  `sealed`, `initialized`.
- `meta` (`&key`) — `schemaVersion` (currently **1**) and `legacyImport`.

Behind `DemoPersistence` (`frontend/src/lib/storage/demo-persistence.ts`), a
four-method contract: `whenHydrated`, `snapshot`, `commit`, `clear`. Two
implementations ship — Dexie (`demo-db.ts`) and in-memory
(`createMemoryPersistence`), the latter used whenever IndexedDB is unavailable
so blocked storage degrades instead of breaking.

**Migration history.** A pre-Dexie release stored everything in one
`localStorage` key via `zustand/persist`. On first boot `demo-db.ts` imports
that payload, stamps it as schema 1, runs the normal migration path over it, and
only then deletes the localStorage key. An unreadable payload is left byte for
byte intact and the visitor gets a fresh demo rather than a broken one.

**Write granularity.** Slice-level. A slice is committed when its *reference*
stops matching what was last written. Adding one card therefore rewrites the
entire `binders` array as a single row. This is the write amplification the row
model is meant to remove; see §5.

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

**These are built and tested but not yet wired in.** `demo-store.ts` and
`demo-adapter.ts` still read and write the nested arrays. See §7.

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

## 7. What is not done

**The switchover.** The rules, the contract, the local runtime and the
conversions all exist and are tested, but nothing calls them in anger. The demo
still mutates nested arrays.

It is one atomic change and cannot be split: `DEMO_SCHEMA_VERSION` must go to 2,
`demo-store.ts` must mutate rows, `demo-adapter.ts` must call the rules, and
`demo-db.ts` must migrate v1 → v2, all together. Bumping the version alone would
stamp returning visitors as v2 with data nothing reads, and the
schema-from-the-future guard would then show them a freshly seeded demo.

### The trap in that change, confirmed

`DEMO_SLICES` in `demo-persistence.ts` needs `binders` replaced by
`collectionRows`. **Doing only that silently discards every returning visitor's
collection**, and the mechanism is verified rather than suspected:

```
demo-db.ts:661   const known = new Set<string>(DEMO_SLICES);
demo-db.ts:667   if (!row || typeof row.key !== "string" || !known.has(row.key)) continue;
```

`readRecordRows` filters stored rows against `DEMO_SLICES`. Drop `"binders"`
from that list and the stored `binders` row stops being read at all — so
`migrateStoredState` receives a state with no `binders`, converts nothing,
writes an empty `collectionRows`, and stamps schema 2. The nested row is still
on disk (rows for unknown slices are deliberately left in place, `demo-db.ts:665`)
but nothing will ever read it again, and the visitor sees an empty collection.

The fix is for the v1→v2 step to read the row directly rather than through the
slice filter — `await db.records.get("binders")` inside `migrateStoredState` —
so the conversion does not depend on `binders` still being a known slice. That
also keeps the migration honest if the slice list changes again later.

Everything needed for the step itself already exists and is tested:
`toPortableRows` converts the stored nested value, and `migrateStoredState`
(`demo-db.ts:459`) already has the transaction, the version stamp and the
keep-the-old-rows-on-failure handling — its body is still
`const migrated = state; // no steps registered yet`.

**The Convex adapter.** `bridge.ts` still has its own copy of the rules. Pointing
it at the shared ones also requires the Convex bundler to resolve a workspace
package for the first time — `convex-backend` currently imports nothing from
`packages/` — which is a deploy-time question that cannot be answered without a
deployment. The fixture table is imported only by tests and so carries none of
that risk.

**Known divergences left open**, from
`docs/stage4-shared-collection-semantics.md` §9: quantity validation (server
rejects, demo clamps), the condition vocabulary (enforced on neither live path),
and bulk add (no demo implementation).

**One product bug recorded rather than fixed.** The grouped response reports a
card's id as its first copy's id, so "move this card" from the collection table
and "move this copy" from the sandbox are byte-identical requests. The clients
disagree about which they mean, so it needs a contract change — an explicit
scope, or non-aliased ids. Moving a 3-copy card from the table currently moves
one copy.
