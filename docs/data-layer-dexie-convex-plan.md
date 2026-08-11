# Data layer: what TCGer would look like if it followed societyer's Dexie + Convex pattern

**Status:** Research / proposal. No code changed.
**Reference repo read for this document:** `ahzs645/societyer` (checked out at `/workspace/ahzs645/societyer`).
**Scope:** persistence only — IndexedDB, localStorage, the Convex backend, and the seam that
picks between them. Not UI, not the card-scan pipeline, not the cache services.

Every claim below points at a file that was actually read. Where something could not be
determined from the code it says so explicitly rather than guessing.

---

## 0. TL;DR

societyer's pattern is **not** "Dexie is a local cache that syncs to Convex." It is the
opposite: **Dexie and Convex are two interchangeable implementations of the same database
contract**, selected once at startup, and the app's business logic is written once against a
bounded `ctx.db` interface that both implement. Its own architecture doc states this in the
first three lines and explicitly rules out two-way sync.

TCGer already has the same *shape* of problem (a real backend, plus a fully client-side demo
that must work with no server on GitHub Pages) but has solved it a layer higher up: it swaps
the **HTTP transport** (`fetch` interception) rather than the **database**, and its local store
is zustand `persist` into localStorage rather than IndexedDB.

**Recommendation in one line:** adopt the *Dexie* half (replace the localStorage demo store
with a versioned Dexie store, and consider folding the two hand-rolled `indexedDB` modules into
it); do **not** adopt the *portable-functions/`ctx.db`* half. See §7 for why.

---

## 1. How societyer does it

### 1.1 The stated architecture

`docs/database-runtime-architecture.md:3` opens with:

> The app does not connect Convex and IndexedDB together. It selects one database runtime at startup.

and `:19-24` spells out the consequences:

- Convex mode stores data in the Convex backend.
- Local mode stores data in the browser's IndexedDB through Dexie.
- **IndexedDB is not a Convex cache, and the `changes` table is not a sync queue.**
- Both modes reuse the same React hooks and the same business handlers.

`docs/database-runtime-architecture.md:158-164` ("Sync stance (decided)") makes it a decision,
not an omission: local mode is "an island"; snapshot export/import is the supported way to move
a workspace; the planned upgrade path is *one-way* promotion into Convex; **two-way sync is
explicitly out of scope**. That promotion design (`docs/local-to-convex-promotion.md`) is marked
**Status: Proposed** — it is a design document, not shipped code.

So: **no offline queue, no optimistic-update reconciliation, no conflict resolution, no sync
engine.** Searching for one and not finding it is the single most important result of this
research.

### 1.2 Runtime selection

- `src/lib/runtimeMode.ts:1-5` defines four modes: `convex-cloud`, `convex-self-hosted`,
  `local-indexeddb`, `electron-local`. `isLocalRuntimeMode()` (`:108`) groups the last two.
- `src/lib/staticRuntime.ts` adds the demo route: `isLocalDataRuntime()` is true for the
  `/demo` path, either local runtime mode, or a browser-local workspace.
- `src/main.tsx:202-227` (`AsyncAppProviders`) dynamically imports **one of two modules** and
  hands the result to the ordinary `ConvexProvider`:
  - `src/lib/convex.ts:13` — `new ConvexReactClient(resolvedConvexUrl())`, or
  - `src/lib/localDataClient.ts` — `createLocalWorkspaceAdapter().client`.
- `src/lib/convexApi.ts` is three lines: `export const api = anyApi as any`. Function
  references are resolved as **strings** (`"deadlines:list"`), which is what makes a
  non-Convex client able to impersonate the real one.

### 1.3 The local client

`src/lib/staticConvexClient.ts:47-263` is a `ConvexReactClient`-shaped shim: it implements
`watchQuery`, `watchPaginatedQuery`, `query`, `mutation`, `action`, `connectionState`,
`setAuth`, `close`, `logger`. React never knows which one it got.

Dispatch (`:136-207`): if the function name is in the portable registry, run the **real**
handler; otherwise fall back to a hand-written demo mock in `staticLegacyDispatch.ts` and log a
one-time `legacy demo fallback` warning.

`src/lib/portableQueryCache.ts` bridges async→sync: Convex's `useQuery` reads
`localQueryResult()` synchronously, but a portable handler is async, so results are cached by
`query+args` at the client level and subscribers are re-notified on resolve.

### 1.4 Dexie setup

`src/lib/localDexieRowStore.ts`:

- `LocalDexieDatabase extends Dexie` (`:69-97`) with **three schema versions** declared in one
  place — `version(1)` (`meetings`, `minutes`), `version(2)` (adds generic `records`),
  `version(3)` (adds `meta`, `changes`, `attachments` and widens the `records` index list).
  Old versions are retained so an existing browser database upgrades rather than breaking.
- Almost all domain data lives in **one generic `records` store** with an envelope
  `{key, table, id, societyId, updatedAtISO, deletedAtISO, value}` (`:9-17`). `meetings` and
  `minutes` remain as legacy typed stores for compatibility.
- A **separate application-level schema version** (`CURRENT_LOCAL_WORKSPACE_SCHEMA_VERSION = 3`,
  `:63`) is stored in the `meta` store and used to run *data* migrations on hydrate
  (`:466-484`, calling `migrateLocalWorkspaceSnapshotTables` at `:670`). Dexie's store version
  and the row-shape version are deliberately different things.
- **Hydration is in-memory-first** (`hydrate()`, `:444-502`): seed → cache, Dexie rows read
  asynchronously and merged in, queries read the cache. `whenHydrated()` (`:151`) exists because
  anything that branches on emptiness must not act on a workspace that only *looks* empty.
- Writes that land while the first read is in flight are buffered in `preHydrationOps`
  (`:111-118`, replayed `:488-495`) — a real bug they hit and fixed.
- `commitBatch(ops)` (`:252-315`) applies a whole mutation in **one Dexie `rw` transaction**
  across `records`/`changes`/`meetings`/`minutes`, and rolls the in-memory cache back if the
  persist throws. The comment at `:246-251` says plainly that the older per-row
  `void db.records.put(...)` path was a correctness bug.
- Deletes are **tombstones** (`localDeletedRecord`, used at `:205` and `:296`), not row removal.
- `exportSnapshot()` / `importSnapshot()` (`:316-380`) give the local workspace a portable
  backup format, `kind: "societyer.localWorkspaceSnapshot"`.
- Workspace isolation is by **Dexie database name**, derived in
  `src/lib/localWorkspaceAdapter.ts:24-56` — the demo, a browser-local workspace, and an
  Electron workspace each get their own IndexedDB database. `:60-98` contains an explicit
  legacy-database-name binding stored in localStorage so existing desktop installs keep
  pointing at the database they already have.

### 1.5 The portable contract (the part that makes one handler serve both)

`shared/portable/` imports no Convex, no Dexie, no domain code:

| File | Role |
|---|---|
| `ctx.ts` (162 lines) | The bounded `ctx.db`: `get`, `query(table).withIndex(...).filter(pred).order().collect()/first/unique/take/paginate`, `withSearchIndex`, `insert/patch/replace/delete`, `TransactionalDb.transaction`. Also `PortablePrincipal` (`:39-68`) — caller identity with no roles and no credentials. |
| `capabilities.ts` | Injected `ctx.capabilities` (email/sms/storage/llm). Missing ones throw a structured `CAPABILITY_UNAVAILABLE` instead of silently no-op'ing. |
| `ids.ts` (119 lines) | `entityId` — a ULID-ish, sortable, runtime-independent id. The header explains why: a Convex `_id` cannot be minted offline, so an offline-created row otherwise has no identity that can survive promotion. |
| `memoryDb.ts` | `MemoryDb`, the reference engine used as a differential-test oracle. |
| `localRowStore.ts` (312 lines) | `LocalStoreDb` — the browser/Electron `ctx.db`, over a 3-method `LocalRowStore` interface (`rows`, `tableNames`, `commitBatch`). Transactional overlay = read-your-writes + atomic flush (`:239-258`), with transactions **serialised** through a promise queue after a data-loss bug from concurrent mutations sharing an overlay. |
| `define.ts` (319 lines) | `definePortableQuery`/`definePortableMutation` + `PortableRuntime`, which registers handlers, runs them, and wraps every mutation in `db.transaction` (`:317`). |

Adapters:

- **Convex:** `convex/lib/portable.ts` — `ConvexPortableDb` passes `withIndex`/`withSearchIndex`
  straight through to the real index; only the engine-agnostic `filter(predicate)` degrades to
  collect-then-filter (`:48-62`). `transaction(body)` just runs the body because a Convex
  mutation is already atomic (`:132-135`).
- **Local:** `shared/portable/localRowStore.ts` — `withIndex` names are *advisory*; constraints
  are applied in JS by the same evaluator the oracle uses.

Worked example, `deadlines`:

- `convex/deadlines.ts:20-24` — `handler: async (ctx, args) => listPortable(await toPortableQueryCtx(ctx), args)`
- `shared/functions/deadlines.ts` — the actual logic, `ctx.db` only.
- `shared/functions/registry.ts` (1,243 lines) — registers it as `deadlines:list` for the local
  runtime.

`docs/portable-functions-architecture.md` records the payoff and the cost: ~796 functions across
~90 domains ported over four phases, replacing a ~10,900-line hand-written offline mirror that
had drifted (76 writes were once tracked as unmirrored). Fidelity limits are documented
(`:68-84`): local `withIndex` scans, so a bad index name passes locally and fails on Convex;
local full-text search matches Convex on *membership* but not on BM25 ranking.

Correctness is held by a **three-engine conformance harness** — `MemoryDb`, `LocalStoreDb`, and
`convex-test` against a real Convex `ctx.db` — run in CI by
`.github/workflows/portable-conformance.yml` and via `npm run test:portable-*`
(`package.json:113-116`).

### 1.6 Convex side

- `convex/schema.ts` (475 lines) is a thin composition file; the ~191 tables live in
  `convex/tables/*.ts` modules imported at `:3-31`.
- Auth is Better Auth via a custom JWT provider (`convex/auth.config.ts`), verified in-handler:
  `hostedPrincipal()` in `convex/lib/portable.ts:140-156` turns `ctx.auth.getUserIdentity()`
  into a `PortablePrincipal` with `assurance: "verified-jwt"`. The local client mints
  `assurance: "trusted-workspace"` instead, bound to a row from the local database, never to
  request arguments (`src/lib/staticConvexClient.ts:88-109`; `STAGE2-PLAN.md:35` states this as
  a hard rule).
- The frontend calls Convex **directly** via `useQuery`/`useMutation`. There is no server-side
  API layer between them.

---

## 2. How TCGer does it today

### 2.1 The transport, not the database, is the swap point

TCGer's client contract is **REST over `fetch`**, not Convex function references:

- `frontend/src/lib/api/*.ts` (18 modules: `collections.ts`, `wishlists.ts`, `decks.ts`,
  `sealed.ts`, `trading.ts`, `analytics.ts`, `guides.ts`, `pricing.ts`, `scan.ts`,
  `settings.ts`, `user.ts`, `user-preferences.ts`, `auth.ts`, `cards.ts`, `health.ts`, …) all
  build URLs from `API_BASE_URL` (`frontend/src/lib/api/base-url.ts`) and call `fetch` with a
  bearer token.
- `frontend/src/lib/demo-mode.ts` monkey-patches `globalThis.fetch` (`installInterceptor`,
  `:139-146`) so that any URL starting with `API_BASE_URL` is answered locally by
  `handleDemoRequest`. Its own header comment states the design intent: "the API files … don't
  need any demo-mode awareness at all."
- `frontend/src/lib/api/demo-adapter.ts:469-525` is the local router — it splits the path into
  segments and dispatches to `handleAuth` / `handleCollections` / `handleWishlists` /
  `handleGuides` / `handleUsers` / `handleSettings` / `handleCards`, returning real `Response`
  objects.
- Better Auth requests to `/api/auth/*` are separately stubbed (`demo-mode.ts:81-93`,
  `handleBetterAuthDemo` `:117-134`) because `app/api/` is deleted for the static export
  (`frontend/package.json` — `prebuild:demo` runs `rm -rf app/api`, `postbuild:demo` restores it
  with `git checkout`).

**This is structurally the same trick as societyer's `StaticConvexClient` — one function name
dispatched to either a network client or a local implementation — just performed one layer
higher, on HTTP instead of on `ctx.db`.**

### 2.2 What persists where

| Where | Key / DB name | Written by | Contents |
|---|---|---|---|
| localStorage | `tcg-demo-store` | `frontend/src/stores/demo-store.ts:1210-1213` (zustand `persist`) | **Entire demo state**: profile, preferences, binders (with per-card `cardData` and `copies[]`), wishlists + rules, decks, trades, sealed inventory |
| localStorage | `tcg-auth-store` | `frontend/src/stores/auth.ts:230` | `partialize`d to `user`, `token`, `isAuthenticated`, `setupRequired` (`:248-253`) |
| localStorage | `tcg-demo-mode` | `frontend/src/lib/demo-mode.ts:18` | `"true"` flag that arms the fetch interceptor |
| localStorage | `tcger:catalog-prompt-dismissed:<tcg>:v<version>` | `frontend/src/components/catalog/catalog-download-prompt.tsx:32-34` | Per-game, per-catalog-version prompt dismissal |
| IndexedDB | `tcger-catalog` v1 | `frontend/src/lib/catalog/catalog-db.ts:3-8` | `packs` (keyPath `tcg`) and `cards` (keyPath `["tcg","id"]`, indexes `by-tcg`, `by-tcg-set`) — the offline card catalogs |
| IndexedDB | `tcger-scan-cache` v2 | `frontend/src/components/scan/use-video-scan-data.ts:21-25` | `hashEntries`, `artworkDb`, `embeddingIndex` — scanner artifacts |
| Convex (server) | — | `convex-backend/convex/schema.ts` (514 lines) | `users`, `appSettings`, `binders`, `cards`, `collectionEntries`, tags, decks, sealed, trades, guides, audit |
| Postgres (server, `hybrid` only) | — | `backend/` + Prisma | The legacy routers |

Three notable properties of `tcg-demo-store`:

1. **No `version` and no `migrate`.** The persist options object is literally
   `{ name: "tcg-demo-store" }` (`demo-store.ts:1211-1213`). zustand's default merge is a
   shallow spread of persisted state over the fresh state, so any change to the nested shape of
   `binders[].cards[].copies[]` is applied to whatever a returning user already has, with no
   migration hook and no version gate.
2. **No `partialize`.** Everything in the store is serialised, including `decks`, `trades` and
   `sealed`, which are static seed constants (`DEMO_DECKS`, `DEMO_TRADES`,
   `DEMO_SEALED_PRODUCTS` from `frontend/src/lib/data/demo-portfolio.ts`) that are re-imported
   at startup anyway.
3. **Unbounded growth into a ~5 MB store.** The seed is small (61 cards in
   `frontend/src/lib/data/demo-cards.ts`), but demo mode is wired to the offline catalogs: the
   demo adapter searches the installed catalog (`demo-adapter.ts` imports `searchCatalog`,
   `getCardsInSet`, `getSets` from `catalog-search.ts`), and
   `demo-store.ts` `enrichCardsFromCatalog` writes catalog-derived image URLs and card data
   **back into the persisted binder rows**. A user can add arbitrarily many of Magic's ~106k
   catalog cards to a demo binder; each one is another JSON object in a single localStorage key
   that is rewritten in full on every mutation.

### 2.3 The offline catalog (`catalog-db.ts`)

Raw `indexedDB`, not Dexie, and deliberately simple: 262 lines, one `openCatalogDatabase()`
promise singleton (`:96-147`), hand-rolled `requestResult`/`transactionComplete` promise
wrappers (`:149-169`), `DB_VERSION = 1` with a create-if-missing `onupgradeneeded` (`:111-125`).
`replaceCatalog` (`:220-251`) does a range-delete of a game's cards plus a `put` per card plus
the pack row in **one readwrite transaction** — correct, and awaited via `transactionComplete`.

There is no schema-evolution story, but there does not need to be one: catalogs are replaced
wholesale by version (`InstalledCatalogPack.version`, checked in
`frontend/src/lib/catalog/use-catalog.ts` to compute `update-available`). The install path is
`catalog-client.ts` → `replaceCatalog`; the query path is `catalog-search.ts` over
`getCatalogCards`/`getCatalogCardsForSet`.

**This module is fine.** It is the one piece of TCGer persistence that is already doing the
right thing.

### 2.4 The Convex backend

`convex-backend/convex/` — 16.7k lines. Real Convex queries and mutations exist
(`collections.ts:25-33` `listForBinder`, `:36+` `addToBinder`, plus `decks.ts` 1,136 lines,
`sealed.ts` 757, `guides.ts` 488, `analytics.ts` 492, `trades.ts` 357), with domain logic
factored into `convex/lib/library.ts` (845 lines), `collectionAudit.ts`, `collectionImport.ts`,
`cardMetadata.ts`, `validators.ts`. Schema is normalised: `binders` → `collectionEntries` →
`cards`, with per-user indexes (`schema.ts:59-80`).

But **the browser never calls it.** The only Convex client in the frontend is
`frontend/src/components/providers/convex-client-provider.tsx:70-72`, and it exists solely to
satisfy `ConvexBetterAuthProvider`. A repo-wide grep for `convex/react` returns exactly that one
file. Everything else goes:

```
browser fetch → Express (backend/) → HTTP bridge → convex-backend/convex/http.ts
```

`convex/http.ts` (2,216 lines) + `convex/bridge.ts` (2,604 lines) are the HTTP surface;
`convex/lib/httpBridge.ts` supplies `requireBridgeIdentity` / `requireBridgeKey`, authenticated
by the shared `TCGER_BRIDGE_SECRET`. Express routers such as
`backend/src/api/routes/collections.convex.router.ts` are thin: `requireAuth`, then optional
price enrichment, then `proxyToConvexHttp`. The README is explicit that browsers must not call
Convex HTTP routes directly or send `X-TCGER-*` headers.

### 2.5 `BACKEND_MODE`

A **server-side** switch, not a client one. `backend/src/config/env.ts:23` defines
`BACKEND_MODE: 'hybrid' | 'convex'` (default `hybrid`; Compose defaults it to `convex` —
`docker/docker-compose.yml:169`). `backend/src/api/routes/index.ts` uses it to choose routers:
`:23-38` pick Convex vs Prisma collections/wishlists (independently overridable via
`COLLECTIONS_BACKEND`/`WISHLISTS_BACKEND`), `:104-115` mount Convex-native decks/finance/sealed/
analytics/trades and `501 Not Implemented` stubs for notifications/alerts/shops/automations/
shipments, `:117-119` load the legacy Prisma routers only when not in `convex` mode. Clients are
expected to capability-gate off `GET /health`'s `features` object.

The frontend has no equivalent of societyer's `runtimeMode.ts`. Its only runtime branch is
demo-vs-not, spread across `isDemoMode()` (`demo-mode.ts:36-39`), path checks for `/demo`
(`demo-mode.ts:20-22`, `convex-client-provider.tsx:28-35`,
`catalog-download-prompt.tsx:36`), `NEXT_PUBLIC_DEMO_EXPORT` (`next.config.mjs:16`), and
`isSingleUserModeEnabled()` (`src/lib/single-user-mode.ts`).

---

## 3. Gap analysis

### 3.1 What TCGer already does as well as, or better than, the reference

| Thing | Verdict |
|---|---|
| **A single runtime seam with no per-feature demo awareness** | Already achieved, via `fetch` interception. Arguably cleaner than societyer's, which still carries a `staticLegacyDispatch.ts` fallback with a "legacy demo fallback" warning for unported functions (`staticConvexClient.ts:30-44`). |
| **Offline catalog storage** | `catalog-db.ts` is correct, transactional, versioned-by-pack. Leave it alone. |
| **Server-side domain logic factoring** | `convex-backend/convex/lib/library.ts` etc. is already the "one place the real logic lives" for the authenticated app. |
| **Static-export demo with zero backend** | Works today and is CI-verified (`.github/workflows/pages.yml`, the "Verify demo runtime files" step). societyer's `/demo` is the same idea. |
| **Convex schema quality** | Normalised with real indexes; nothing to import from the reference here. |

### 3.2 What is genuinely worse than the reference

| Gap | Evidence | Consequence |
|---|---|---|
| **Demo state lives in localStorage** | `demo-store.ts:1210-1213` | ~5 MB quota shared with everything else on the origin; whole-state JSON serialise on every mutation; a `QuotaExceededError` inside zustand's persist is swallowed and the user silently loses writes. |
| **No version/migration on persisted demo state** | same | Shape changes are applied to old data with a shallow merge. A renamed or restructured field means undefined reads in a returning user's browser. |
| **No atomicity** | localStorage `setItem` is per-key, and multi-step demo mutations (`addCardToBinder` + `enrichCardsFromCatalog`) are separate `set()` calls | A tab close mid-sequence can leave a half-applied change. societyer treated exactly this as a correctness bug and fixed it with `commitBatch` (`localDexieRowStore.ts:246-251`). |
| **Business logic duplicated between demo and server** | `demo-store.ts:845+` `addCardToBinder` vs `convex-backend/convex/lib/library.ts:405+` `addEntryForViewer` — both implement copy/condition/quantity/tag semantics | Drift. This is precisely the failure societyer describes: "the offline runtime began as a ~10,900-line hand-written mirror … guarded by a name-coverage ledger" (`docs/portable-functions-architecture.md:18-32`). TCGer's mirror is ~2,700 lines (`demo-adapter.ts` 1,218 + `demo-store.ts` 1,456) and has one test file of 100 lines. |
| **The two data shapes are different** | Demo is denormalised (`binders[].cards[].copies[]`); Convex is normalised (`binders` / `collectionEntries` / `cards`) | Any future "one handler, both runtimes" plan has to reconcile these first. This is the real cost driver and the reason §7 says don't. |
| **Three separate hand-rolled IndexedDB/localStorage idioms** | `catalog-db.ts` (raw idb), `use-video-scan-data.ts` (raw idb), zustand persist | Not harmful today, but there is no shared story for quota, eviction, or "clear my local data". |
| **No local-data export/import** | not found | societyer's snapshot export/import (`localDexieRowStore.ts:316-380`) is what makes a local-only workspace defensible. TCGer's demo has `resetDemo()` (`demo-store.ts:608`) and nothing else. |

### 3.3 What does *not* transfer

- **The portable `ctx.db` contract.** It buys "one handler runs on Convex and on Dexie." TCGer's
  frontend does not call Convex functions at all — it calls REST. To get the benefit you would
  first have to delete the Express bridge from the browser's path, which is a much larger
  change than the data layer.
- **`entityId`.** societyer needs runtime-independent ids because it plans to promote a local
  workspace into the cloud (`shared/portable/ids.ts:1-17`). TCGer's demo data is seeded fixture
  data that is never promoted anywhere. Adding a ULID scheme buys nothing until someone wants
  "turn my demo collection into a real account", which is not in the code today.
- **Capabilities (`CAPABILITY_UNAVAILABLE`).** TCGer's equivalent already exists server-side and
  is better placed: `createNotImplementedRouter` returning `501` plus the `/health` `features`
  object (`backend/src/api/routes/index.ts:105-111`, `health.router.ts`).
- **The three-engine conformance harness.** It only makes sense once there is one handler with
  multiple engines. Without the portable contract there is nothing to differentially test.

---

## 4. Staged migration plan

Each stage ships on its own and leaves the app working. For each, the three surfaces are called
out explicitly:
**(a)** the live authenticated app (Express → Convex/Postgres);
**(b)** the offline catalog (`tcger-catalog` IndexedDB);
**(c)** demo mode (static export to GitHub Pages, no backend at all).

Stages 1–3 are the recommended scope. Stages 4–5 are written down so the option is legible, but
§7 argues against them.

---

### Stage 0 — Inventory + a persistence-key registry (no behaviour change)

**Do:** add `frontend/src/lib/storage/keys.ts` exporting every localStorage key and IndexedDB
database name as named constants, and have `demo-mode.ts`, `demo-store.ts`, `auth.ts`,
`catalog-db.ts`, `use-video-scan-data.ts`, and `catalog-download-prompt.tsx` import from it.
Add a `clearAllLocalData()` helper that enumerates them.

**Why first:** every later stage needs to know what is already in users' browsers, and a
"reset local data" affordance is the escape hatch for every migration hazard in §5.

- (a) live app: no change.
- (b) catalog: no change (constants only).
- (c) demo: no change.

**Ships independently:** yes. **Reversible:** trivially.

---

### Stage 1 — Introduce Dexie behind a `DemoDataStore` interface (still localStorage)

**Do:**

1. `npm i dexie` in `frontend/`.
2. Define the persistence interface the demo store needs — modelled on societyer's
   `LocalRowStore` (`shared/portable/localRowStore.ts:41-46`), which is only three methods:
   `rows(table)`, `tableNames()`, `commitBatch(ops)`.
3. Extract the *persistence* concern out of `demo-store.ts` behind that interface, keeping the
   existing localStorage implementation as the default. The zustand store keeps its current API
   so `demo-adapter.ts` and every component are untouched.

**Why this shape:** societyer's `LocalDexieRowStore` is 796 lines because it also carries a
change journal, attachments, snapshot export/import and legacy typed stores. TCGer needs the
`commitBatch` + hydrate + versioned-migrate core and nothing else. Copy the *contract*, not the
file.

- (a) live app: no change — the authenticated app does not read the demo store.
- (b) catalog: no change.
- (c) demo: no change; same storage, same data, refactor only.

**Ships independently:** yes. **Reversible:** yes (single interface, one implementation).

---

### Stage 2 — Dexie-backed demo store, with a one-time localStorage import

**Do:**

1. Add `frontend/src/lib/storage/demo-db.ts`:
   ```
   class DemoDatabase extends Dexie {
     version(1).stores({
       records: "&key, table, id",   // generic envelope, per societyer's records store
       meta:    "&key",              // schemaVersion + migration bookkeeping
     });
   }
   ```
   Follow `localDexieRowStore.ts:69-97`: declare each version explicitly and never edit a
   released `version(n)` block.
2. Hydrate in-memory first, then merge Dexie rows in (`hydrate()`, `:444-502`), and expose a
   `whenHydrated()` promise. Anything that branches on "is the demo empty" — notably
   `init()`/`resetDemo()` in `demo-store.ts:597-619` — must await it, or a returning user gets
   re-seeded over their own data. Buffer writes that land during hydration
   (`preHydrationOps`, `:111-118`).
3. Persist mutations through a single `commitBatch(ops)` in one Dexie `rw` transaction
   (`:252-315`), rolling the in-memory cache back on failure.
4. **Migration on first boot:** if `localStorage["tcg-demo-store"]` exists and the Dexie `meta`
   store has no `schemaVersion`, parse it, write it into Dexie in one transaction, stamp
   `schemaVersion`, and only then remove the localStorage key. If parsing fails, keep the
   localStorage value untouched and fall back to seeding — never delete data you failed to read.
5. Keep an application-level `DEMO_SCHEMA_VERSION` in `meta`, separate from the Dexie store
   version (societyer keeps both — `localDexieRowStore.ts:63` vs `:79-95`), and run row-shape
   migrations on hydrate.
6. Stop persisting `decks`, `trades`, `sealed` unless the user has mutated them — they are
   re-imported from `demo-portfolio.ts` on every boot anyway. (`partialize` equivalent.)

- (a) live app: **no change.** The demo store is not in the authenticated path. Verify by
  confirming `useDemoStore` importers are limited to `demo-adapter.ts`, `use-catalog.ts` and
  demo components.
- (b) catalog: **no change** — separate database (`tcger-catalog`). Note that demo mode reads
  the catalog (`demo-adapter.ts` imports `catalog-search.ts`), so the demo store gaining
  Dexie does not change how catalogs are read.
- (c) demo: **must keep working with no backend.** Dexie is a pure client-side dependency with
  no network calls, so the static export is unaffected beyond bundle size (~25 kB min+gz).
  Add a manual check to the Pages workflow's verification step, or at minimum verify locally:
  load `/demo`, add a card, hard-reload, confirm it persists; then load with IndexedDB blocked
  (private mode in some browsers) and confirm the app still runs in memory —
  `localDexieRowStore.ts:131-142` shows the reference's approach: catch the failure, log once,
  continue in memory, never crash.

**Ships independently:** yes. **Reversible:** yes, until the localStorage key is deleted — so
keep the key for one release (read Dexie, ignore localStorage) before removing it.

**This stage is the whole point of the exercise.** Everything after it is optional.

---

### Stage 3 — Fold the two raw-IndexedDB modules in (optional, low priority)

**Do:** reimplement `catalog-db.ts` and `use-video-scan-data.ts`'s cache on Dexie, keeping the
**same database names and the same object-store names**, and bumping Dexie's declared version
above the current raw version (`tcger-catalog` v1 → declare `version(1)` matching today's
schema exactly, then any new version; `tcger-scan-cache` is at v2, so declare `version(1)` and
`version(2)` to match before adding `version(3)`).

**Do not** rename a database or a store. An existing user's `tcger-catalog` contains a
downloaded ~20 MB Magic catalog; a rename means a silent re-download.

**Value:** one idiom, one quota story, one place to implement "clear local data". **Cost:**
touching two working modules. This is a cleanup, not a fix.

- (a) live app: no change.
- (b) catalog: **highest-risk stage for the catalog.** Gate it behind a manual test matrix:
  fresh install, upgrade-from-installed, update-available, remove, and quota-exceeded.
- (c) demo: demo mode reads the catalog, so a catalog regression is a demo regression.

**Ships independently:** yes. **Recommendation:** defer. Do it only if Stage 2 proves Dexie is
carrying its weight.

---

### Stage 4 — Extract shared collection semantics (**not recommended as scoped; see §7**)

The honest version of "make TCGer look like societyer" without adopting the whole contract:
move the copy/entry/quantity/condition rules that exist twice — `demo-store.ts:845+`
`addCardToBinder` and `convex-backend/convex/lib/library.ts:405+` `addEntryForViewer` — into a
shared package under `packages/`, and have both call it.

The blocker is real and should be stated plainly: **the two sides do not share a data shape.**
Demo is `binders[].cards[].copies[]`; Convex is `binders` / `collectionEntries` / `cards`.
Extracting shared logic requires first normalising the demo store to the Convex row model, which
means rewriting `demo-adapter.ts`'s response assembly to hydrate the nested API shape from flat
rows — essentially reimplementing `hydrateBinderDetail` (`convex/lib/library.ts`) client-side.

If pursued, scope it to **binders + entries + copies only**, and only after Stage 2 has already
moved the demo store to a row-shaped Dexie schema (at which point the normalisation is a
migration you were doing anyway).

- (a) live app: changes server code. Needs the existing `convex-backend` vitest suites green
  (`nativeArchitecture.test.ts`, `bulkAdd.test.ts`, `collectionAudit.test.ts`,
  `collectionImport.test.ts`).
- (b) catalog: no change.
- (c) demo: high risk — this is a rewrite of the demo data model.

---

### Stage 5 — Portable `ctx.db` contract (**not recommended; see §7**)

Full societyer parity: define a bounded `ctx.db`, write handlers once, adapt to Convex and to
Dexie, add a differential harness. Recorded here only so the decision is explicit. This is
prerequisite-blocked on the browser talking to Convex directly, which would mean removing the
Express bridge from the browser's path — a change to auth, pricing enrichment, external card
API proxying, and the `BACKEND_MODE`/`hybrid` story all at once.

---

## 5. Risks and migration hazards

Ordered by expected damage.

### R1 — Silently destroying demo collections that already exist in users' browsers

`tcg-demo-store` is live on the public GitHub Pages demo today. Anyone who used it has binder
state there. Hazards:

- **Reading it wrong.** It has no `version` field, so there is no way to distinguish "current
  shape" from "shape from three releases ago." Any importer must be defensive: validate, and on
  failure keep the raw string (e.g. copy it to `tcg-demo-store.backup.<timestamp>`) rather than
  drop it. societyer's snapshot validators are similarly permissive and are called out in
  `docs/local-to-convex-promotion.md:2.3` as *not* enforcing field types — a known limitation,
  documented rather than assumed away.
- **Deleting it too early.** Keep the localStorage key for at least one release after Dexie
  becomes the source of truth. Delete only after a boot that successfully hydrated from Dexie.
- **Double-import.** The import must be guarded by a marker in the Dexie `meta` store, not by
  the absence of the localStorage key, or a failed-then-retried migration duplicates rows.

**Mitigation:** implement import as: read → validate → write Dexie + stamp `meta.importedFrom`
in one transaction → (next boot) delete localStorage key.

### R2 — Re-seeding over a returning user's data because hydration is async

localStorage is synchronous; IndexedDB is not. `demo-store.ts:597-607` `init()` checks
`get().initialized` and seeds if false. With Dexie, `initialized` is false during the first
render, so an unguarded `init()` seeds *over* persisted data.

This is exactly why societyer has `whenHydrated()` and documents it at
`localDexieRowStore.ts:145-153`: "anything that *branches* on emptiness … has to wait for this
or it will act on a workspace that only looks empty."

**Mitigation:** `init()`/`resetDemo()` must await hydration; add a loading state to the demo
shell; add a test that asserts a hydrated store is not re-seeded.

### R3 — Breaking the offline catalog on upgrade (Stage 3)

`tcger-catalog` holds up to ~20 MB of downloaded Magic data. Dexie's `version().stores()`
declarations must **exactly reproduce** the raw schema created in `catalog-db.ts:111-125`
(`packs` keyPath `tcg`; `cards` keyPath `["tcg","id"]` with `by-tcg` and `by-tcg-set`) for
`version(1)`, or Dexie will try to restructure a populated database. Compound keyPaths and
compound indexes are the specific area where a hand-translated Dexie schema string most easily
diverges from a hand-written `createObjectStore`/`createIndex` pair.

**Mitigation:** don't do Stage 3, or do it with an explicit upgrade test against a database
populated by the current code.

### R4 — IndexedDB unavailability and quota

IndexedDB is absent or throws in some private-browsing configurations and in some embedded
webviews. Today the demo degrades gracefully because localStorage is more widely available and
`catalog-db.ts:98-103` throws a clear error that the catalog UI surfaces as `unavailable`.

**Mitigation:** copy societyer's stance (`localDexieRowStore.ts:131-142`) — construct the store,
attempt to open, and on failure null out the database, warn once, and run **in memory for the
session**. The demo must never white-screen; it is the marketing surface.

Also note the two competing consumers: the demo store and a 20 MB catalog now share an origin
quota with the scan cache. A quota failure in one can present as data loss in another.

### R5 — Static export constraints

`build:demo` runs `rm -rf app/api` (`frontend/package.json`) and `next.config.mjs:39-45` sets
`output: 'export'`, `trailingSlash: true`, `basePath: process.env.BASE_PATH`. Anything added to
the data layer must be **client-only** and must tolerate a non-root `basePath`. Dexie qualifies
(no network, no server component). Any code that runs during prerender must be guarded — the
existing code already does this via `typeof window === "undefined"` checks
(`demo-mode.ts:26-28`, `:36-39`).

The Pages workflow copies `frontend/out/demo`, `_next`, `icons`, `card-backs` and the PWA
manifest into the marketing site and then asserts specific files exist. **Adding a new top-level
output directory would need a matching `cp` line.** Nothing in this plan does, but it is the
kind of thing that fails only in CI.

### R6 — Bundle size / SSR in the authenticated app

`demo-store.ts` is imported by `use-catalog.ts`, which is imported by non-demo pages. If Dexie
is pulled into that module graph it lands in the main bundle. Import it lazily (dynamic
`import("dexie")` inside the store implementation, mirroring societyer's dynamic
`import("./lib/localDataClient")` at `src/main.tsx:208-210`) or move the Dexie implementation
behind the interface from Stage 1 so only the demo path resolves it.

### R7 — Auth state is *not* in scope and should stay that way

`tcg-auth-store` holds a bearer token in localStorage (`auth.ts:230, 248-253`). Moving a
credential into IndexedDB changes nothing about its security properties (both are
same-origin, both readable by any script on the origin) and adds an async read to the auth
critical path, which `setup-guard.tsx:42-45, 81` already treats as delicate. **Leave it.**

---

## 6. What "not found" means here

Stated so nothing is inferred from silence:

- **No sync engine, offline queue, conflict resolution, or optimistic-update reconciliation in
  societyer.** Actively ruled out at `docs/database-runtime-architecture.md:158-164`. The
  `changes` table is a capped (2,000-entry) diagnostic journal, explicitly "not an audit log"
  and "not a sync queue" (`:163`).
- **No Dexie in TCGer today.** No `dexie` entry in any `package.json` in the repo.
- **No `dexie-react-hooks` / `liveQuery` in societyer.** Reactivity comes from its own listener
  set plus `PortableQueryCache`, not from Dexie's observability APIs.
- **No frontend Convex data calls in TCGer.** The only `convex/react` import is the auth
  provider.
- **No local-data export/import in TCGer.** No snapshot equivalent found.
- **Not determined from code:** how large real `tcg-demo-store` payloads get in the wild (no
  telemetry in the repo); whether any TCGer user has actually hit the localStorage quota; and
  whether the iOS app under `mobile-apps/` shares any of these storage conventions (not read —
  out of scope for this document).

---

## 7. Honest recommendation

### Do this

**Stage 0, 1 and 2 — move the demo store off localStorage onto a versioned Dexie store.**
Roughly 300–500 lines of new code plus a focused refactor of `demo-store.ts`'s persistence.
It fixes four concrete problems that exist today: the ~5 MB ceiling on a store that is wired
to a 106k-card catalog, the whole-state rewrite on every mutation, the absence of any
versioning or migration path for shape changes, and the lack of write atomicity. Those are
real, and they get worse as the demo gets better.

Take these specific patterns from the reference and nothing else:

1. Declare every Dexie version explicitly and never edit a released one
   (`localDexieRowStore.ts:79-95`).
2. Keep an application-level schema version in a `meta` store, separate from Dexie's
   (`:63`, `:466-484`).
3. Hydrate in-memory-first, expose `whenHydrated()`, and buffer writes that land during
   hydration (`:111-118`, `:145-153`, `:488-495`).
4. Persist a mutation as one `commitBatch` in one `rw` transaction, with in-memory rollback on
   failure (`:252-315`).
5. Degrade to in-memory when IndexedDB is unavailable rather than failing
   (`:131-142`).
6. Add snapshot export/import once you have a row-shaped store (`:316-380`) — cheap at that
   point, and it is the answer to every "I lost my demo collection" report.

### Don't do this

**Stage 5 (the portable `ctx.db` contract) is not worth it for TCGer.** Three reasons, in order
of weight:

1. **The seam is in a different place, and TCGer's is arguably better.** societyer's contract
   exists because its React components call Convex functions directly, so the *only* place to
   substitute a local backend is `ctx.db`. TCGer substitutes at HTTP, which is a wider, more
   stable, already-tested interface — and it is the same interface the iOS app and any future
   client use. Rewriting to `ctx.db` would mean deleting the Express bridge from the browser's
   path, which also owns auth, pricing enrichment, external card-API proxying, and the whole
   `BACKEND_MODE` hybrid story.
2. **The cost is enormous and is documented in the reference itself.** Four phases, ~796
   functions across ~90 domains, a generated registry, a three-engine differential harness, and
   a dedicated CI workflow — and the reference *still* carries a legacy fallback path with a
   runtime warning for unported functions (`staticConvexClient.ts:30-44`), plus documented
   fidelity divergences where local `withIndex` and local full-text search do not match Convex
   (`docs/portable-functions-architecture.md:68-84`).
3. **The payoff does not apply.** societyer needs it because it ships an **Electron desktop
   app** where the local database holds a real organisation's records of record — data that
   must be correct, exportable, and eventually promotable to the cloud. TCGer's local data is
   a **demo**: seeded fixtures, resettable, never promoted, never authoritative. Paying for
   handler-level cross-runtime conformance to protect fixture data is the wrong trade.

**Stage 3 (folding `catalog-db.ts` into Dexie) is optional and should be deferred.** The module
works, is transactional, and its "migration story" (replace wholesale by pack version) is
correct for what it stores. The only reason to touch it is aesthetic consistency, and the
downside — silently invalidating a 20 MB download for every existing user — is worse than the
inconsistency.

**Stage 4 (shared collection semantics) is worth wanting but not worth forcing.** The
duplication between `demo-store.ts` and `convex/lib/library.ts` is real and will drift. But the
two sides don't share a data shape, so extraction is blocked on normalising the demo store
first. The right sequencing is: do Stage 2 with a row-shaped Dexie schema that mirrors the
Convex table layout (`binders` / `collectionEntries` / `cards`), and then reassess. If Stage 2
is done with the *current* nested shape, Stage 4 becomes permanently uneconomic.

### The one thing to decide before starting

**Does Stage 2's Dexie schema mirror the Convex table layout, or the current nested demo
shape?** Mirroring Convex costs more now (the demo adapter must hydrate nested API responses
from flat rows, ~the job `hydrateBinderDetail` does server-side) and is the only path that
leaves Stage 4 open. Mirroring the current shape is faster and closes that door. Both are
defensible; picking accidentally is not.

---

## Appendix A — File index

**Reference (`/workspace/ahzs645/societyer`)**

| File | Lines | Role |
|---|---|---|
| `docs/database-runtime-architecture.md` | 174 | The architecture, stated directly |
| `docs/portable-functions-architecture.md` | 258 | The `ctx.db` contract design + phases |
| `docs/local-to-convex-promotion.md` | 852 | One-way promotion design (**Status: Proposed**) |
| `CONTRIBUTING.md` | 135 | `:25`, `:37` name Dexie as the demo/desktop adapter |
| `src/lib/runtimeMode.ts` | 145 | Four runtime modes + capability matrix |
| `src/main.tsx` | — | `AsyncAppProviders` at `:202-227` picks the client |
| `src/lib/convex.ts` / `src/lib/localDataClient.ts` | 13 / 13 | The two clients |
| `src/lib/staticConvexClient.ts` | 264 | Convex-shaped local client |
| `src/lib/portableQueryCache.ts` | — | async→sync query bridge |
| `src/lib/localDexieRowStore.ts` | 796 | Dexie schema, hydrate, `commitBatch`, snapshots |
| `src/lib/localWorkspaceAdapter.ts` | 120 | Dexie database naming / workspace isolation |
| `src/lib/localCapabilities.ts` | 60 | Local capability policy |
| `shared/portable/ctx.ts` | 162 | The contract |
| `shared/portable/localRowStore.ts` | 312 | `LocalStoreDb` + `LocalRowStore` |
| `shared/portable/define.ts` | 319 | `PortableRuntime` |
| `shared/portable/ids.ts` | 119 | `entityId` |
| `convex/lib/portable.ts` | 185 | Convex adapter |
| `shared/functions/registry.ts` | 1,243 | Ported-function registry |
| `.github/workflows/portable-conformance.yml` | — | CI gate |

**Target (`/home/user/TCGer`)**

| File | Lines | Role |
|---|---|---|
| `frontend/src/stores/demo-store.ts` | 1,456 | zustand + persist → `tcg-demo-store` |
| `frontend/src/lib/api/demo-adapter.ts` | 1,218 | Local REST router for demo mode |
| `frontend/src/lib/api/demo-adapter.test.ts` | 100 | The only test over that surface |
| `frontend/src/lib/demo-mode.ts` | — | `fetch` interceptor + demo flag |
| `frontend/src/lib/catalog/catalog-db.ts` | 262 | Raw IndexedDB, `tcger-catalog` v1 |
| `frontend/src/lib/catalog/catalog-client.ts` | 392 | Manifest fetch + install |
| `frontend/src/lib/catalog/catalog-search.ts` | 455 | Query layer over the catalog |
| `frontend/src/components/scan/use-video-scan-data.ts` | — | Raw IndexedDB, `tcger-scan-cache` v2 |
| `frontend/src/stores/auth.ts` | — | zustand + persist → `tcg-auth-store` |
| `frontend/src/components/providers/convex-client-provider.tsx` | 85 | The only `convex/react` usage (auth only) |
| `frontend/next.config.mjs` | — | `DEMO_EXPORT` → `output: 'export'` |
| `backend/src/config/env.ts` | — | `BACKEND_MODE` definition (`:23`) |
| `backend/src/api/routes/index.ts` | — | `BACKEND_MODE` routing (`:23-38`, `:104-119`) |
| `convex-backend/convex/schema.ts` | 514 | Normalised collection schema |
| `convex-backend/convex/lib/library.ts` | 845 | Server-side entry/copy semantics |
| `convex-backend/convex/http.ts` + `bridge.ts` | 2,216 + 2,604 | The Express↔Convex HTTP bridge |
| `.github/workflows/pages.yml` | — | Static demo build + file assertions |

---

## 8. Stage 5 revisited — the prerequisite, verified

Added after Stages 0–3 shipped and Stage 4 was implemented (see
`docs/stage4-shared-collection-semantics.md` §9). Stage 4's analysis found that
§4's *scoping* of Stage 4 named the wrong pair of functions, so Stage 5's
"not recommended" was re-checked against the code rather than inherited.

**The verdict stands, and the blocker is larger than §4 stated.**

What §4 got wrong, in Stage 5's favour: the browser is **already** connected to
Convex. `frontend/src/components/providers/convex-client-provider.tsx:71`
constructs a `ConvexReactClient` and `convex` is a direct frontend dependency.
So "prerequisite-blocked on the browser talking to Convex directly" is too
strong as written — the connection exists.

What it is used for, though, is **auth only** (`ConvexBetterAuthProvider`). A
repo-wide search for `useQuery(api.`, `useMutation(api.`, `useAction(api.` and
`useConvex()` across `frontend/src` and `frontend/app` returns **nothing**.
Every byte of application data still goes REST → Express → Convex HTTP →
`bridge.ts`.

What removing Express from the browser's path would actually cost: even with
`BACKEND_MODE=convex`, only some routers are swapped for Convex proxies
(collections, wishlists, decks, finance, sealed, analytics, trades, guides —
`backend/src/api/routes/index.ts:23-110`). The rest are still real Express
implementations with no Convex counterpart, and the browser calls them:

| Router | Lines | What it does |
|---|---|---|
| `scan.router.ts` + `modules/card-scan/` | 587 + 5,397 | card scanning |
| `cards.router.ts` | 105 | external card-API proxying |
| `users`, `settings`, `prices`, `shops`, `alerts`, `automations`, `shipments`, `news`, `setup` | ~300 | assorted |

Against ~32.5k lines of Express source in total. Stage 5 is therefore not "write
the handlers once and adapt them" — it is a port of the card-scan pipeline and a
dozen routers into Convex or into the browser, on top of the auth, pricing
enrichment and `hybrid`-mode changes §4 already listed.

**And the goal it was meant to serve has been met another way.** Stage 5 existed
to stop the demo and the server implementing the same rules differently. That is
now done by `packages/api-types/src/collection-semantics.ts` — a fixture table
driven by a harness on each side — at roughly 500 lines, no change to the
authenticated path, and no architecture change at all. Reverting any single rule
fix turns exactly one fixture red.

Stage 5 should be reopened only if the browser starts making real Convex data
calls for its own reasons. It is not worth doing for the demo.
