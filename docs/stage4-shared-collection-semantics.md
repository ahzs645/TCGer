# Stage 4 — shared collection semantics: what it would actually cost now

**Status:** Analysis / decision document. No application code changed.
**Written against:** the tree at `/home/user/TCGer` after Stages 0–2 of
`docs/data-layer-dexie-convex-plan.md` shipped (commits `9166707`, `f8433e1`, `6d3ef66`).
**Question asked:** the plan (§7) claims that shipping Stage 2 with the *nested* demo shape
"closes the door" on Stage 4. Is that true, and what does Stage 4 cost now?

**Short answer:** the "closes the door" claim is **false, but for a worse reason than it being
wrong.** The door was never open, because the plan's Stage 4 (§4, `:470-492`) names the wrong
pair of functions. `demo-store.ts` does not mirror `convex/lib/library.ts`; it mirrors the
**HTTP bridge** (`convex/bridge.ts` + the `toLegacyBinder` projection in `convex/http.ts`),
which is a *different* implementation of the same rules that already disagrees with
`library.ts` on at least one rule the demo happens to get right. Extracting shared code
between `demo-store.ts` and `addEntryForViewer` would unify two implementations that do not
need to agree, and leave the two that do.

Every claim below points at a file and line that was read. Where something could not be
determined without running code, it says so.

---

## 0. TL;DR

- The duplication is real and **has already drifted**, in ways that are reachable from the
  shipped UI. Nine concrete divergences are itemised in §2. Two of them are severe: the same
  button produces opposite results in demo and production.
- Stage 2's nested shape is **not** the binding constraint. The binding constraint is that
  there are **four** implementations of collection-entry semantics in this repo, only two of
  which are on the browser's actual path, and the plan's Stage 4 targets neither pair
  correctly.
- Re-shaping the Dexie schema (option **c**) is now materially more expensive than the plan
  assumed — and it has a **latent correctness bug blocking it**: `demo-db.ts` stamps the
  current `DEMO_SCHEMA_VERSION` onto a legacy localStorage import *without running any
  migration on it* (`demo-db.ts:326-342`, `:386`). Today that is harmless because
  `DEMO_SCHEMA_VERSION === 1`. The first time it is bumped, it silently mislabels the data of
  exactly the users the Stage 2 migration was written to protect.
- **Recommendation: option (a)** — do not extract, pin the rules with tests on both sides, and
  fix the six divergences that are outright bugs. See §5 for what would change my mind.

---

## 1. Verification of the premises

Everything the brief asked me to verify rather than assume:

| Premise | Verdict | Evidence |
|---|---|---|
| Stages 0–2 shipped | **True.** Working tree clean; three commits present. | `git log` on `frontend/src/lib/storage/demo-db.ts` → `9166707`, `f8433e1`, `6d3ef66` |
| Demo store persists to IndexedDB via Dexie | **True.** DB name `tcger-demo`, dynamic `import("dexie")`. | `demo-db.ts:101-119`, `keys.ts:197` |
| Behind a contract in `demo-persistence.ts` | **True.** 4-method `DemoPersistence`. | `demo-persistence.ts:71-95` |
| `demo-store.ts` no longer uses `zustand/persist` | **True.** Hand-rolled slice diffing against a `persistBaseline` by reference identity. | `demo-store.ts:736-777` |
| Stage 2 shipped the **nested** shape | **True.** `records: "&key"`, one row per slice, `binders` is a single row holding the whole `DemoBinder[]`. | `demo-db.ts:111-114`; `DEMO_SLICES` = `profile, preferences, binders, wishlists, decks, trades, sealed, initialized` (`demo-persistence.ts:60-69`) |
| A released `schemaVersion` exists | **True.** `DEMO_SCHEMA_VERSION = 1`, stamped in `meta`. | `demo-persistence.ts:38`; `demo-db.ts:48`, `:505-511` |
| A live localStorage migration exists | **True**, and is one-way: the key is deleted after a successful import. | `demo-db.ts:357-421`, deletion at `:418` |
| The plan asserts this "closes the door" on Stage 4 | **True**, at `data-layer-dexie-convex-plan.md:679`. | — |

---

## 2. Finding 1 (the important one): the plan names the wrong pair

Stage 4 as scoped (`data-layer-dexie-convex-plan.md:470-492`) says the rules "exist twice":
`demo-store.ts:845+` `addCardToBinder` and `convex/lib/library.ts:405+` `addEntryForViewer`.

They exist **four** times, and `addEntryForViewer` is not the copy the demo shadows:

| # | Implementation | On the browser's path? | Lines |
|---|---|---|---|
| 1 | `frontend/src/stores/demo-store.ts` + `frontend/src/lib/api/demo-adapter.ts` | **Yes** — demo mode, via the `fetch` interceptor | ~420 |
| 2 | `convex-backend/convex/bridge.ts` (`addCardToBinder`, `updateEntry`, `removeEntry`) + `convex-backend/convex/http.ts` (`toLegacyBinder`, `expandLegacyCopies`) | **Yes** — this is what Express proxies to in `BACKEND_MODE=convex` | ~460 |
| 3 | `convex-backend/convex/lib/library.ts` (`addEntryForViewer`, `updateEntryForViewer`) + `convex-backend/convex/collections.ts` | **No** — reachable only from native Convex functions and the vitest suites; the frontend has no `convex/react` data calls | ~320 |
| 4 | `backend/src/api/routes/collections.router.ts` + Prisma | Only when `BACKEND_MODE !== 'convex'` and `COLLECTIONS_BACKEND !== 'convex'` | — |

The routing is at `backend/src/api/routes/index.ts:23-30`: in `convex` mode the collections
router is `convexCollectionsRouter`, which is a **pure proxy** (`collections.convex.router.ts`
is 27 lines: `requireAuth`, price enrichment, `proxyToConvexHttp`). All request shaping and
validation therefore happens in `convex/http.ts`, hand-rolled as `typeof body.x === "string"`
coercions (e.g. `http.ts:2053-2118`), and all the rules run in `convex/bridge.ts`.

**Implementation 3 partly overlaps 2** — `bridge.createCopiesForViewer` (`bridge.ts:690+`)
delegates to `addEntryForViewer`, and `bridge.listBinders`/`getBinder` (`bridge.ts:815-845`)
call `hydrateBinderDetail`. But `bridge.updateEntry` (`bridge.ts:1429-1660`, **232 lines**) is a
wholly separate rewrite of `updateEntryForViewer` (`library.ts:713-822`, 110 lines) with
group-level quantity reconciliation that `library.ts` does not have at all.

The clinching evidence that the demo shadows **2**, not **3**:

> `library.ts:766` — `condition: args.condition ?? entry.condition` — a `null` condition does
> **not** clear the field.
> `bridge.ts:1537` — `condition: args.condition === undefined ? entry.condition : args.condition ?? undefined` — a `null` condition **does** clear it.
> `demo-store.ts:1414-1417` — same idiom as the bridge; `null` clears.

The demo agrees with the bridge and disagrees with `library.ts`. Extracting a shared rule
between `demo-store.ts` and `addEntryForViewer`, as the plan proposes, would have to pick one
of these and would break whichever caller it did not pick.

**Consequence for the "closes the door" claim.** The claim is that Stage 2's nested shape made
Stage 4 uneconomic. It is not the shape that makes it uneconomic — it is that the extraction
target is misidentified, and that the pair which genuinely must agree (demo vs bridge) is
already 460 lines of server code carrying Convex `ctx.db`, `ConvexError`, `Id<...>`, an audit
log (`appendCollectionAudit`), and tag tables. That code cannot move into `packages/` without
first being made storage-agnostic — which is Stage 5's portable-`ctx.db` contract, the thing
§7 already argues against for independent and still-valid reasons.

---

## 3. Finding 2: the duplication, quantified, and how far it has already drifted

Rules that genuinely exist in both places. **Status** is what I could establish by reading both
implementations, not by assuming they match.

### 3.1 Drifted — reachable from the shipped UI

**D1 — `DELETE …/cards/:id` with a card-level id deletes different amounts of data.**
The UI's "set quantity to 0 → remove" path calls `removeCollectionCard(token, binderId, entryId)`
where `entryId = existingEntry?.id` (`card-preview.tsx:402`, `:415`) — the *card-level* id from
the grouped response.

- Server: that id is `copies[0].id`, i.e. one real `collectionEntries` row
  (`http.ts:255` — `id: copies[0]?.id ?? entry.id`). `removeEntry` deletes exactly that one
  row (`library.ts:824-845`). A card with 3 copies loses **1**; 2 remain.
- Demo: `removeCardFromBinder` filters on the `DemoBinderCard` id
  (`demo-store.ts:1520` — `cards: b.cards.filter((c) => c.id !== cardInstanceId)`), which
  removes the **whole grouped card and all of its copies**.

Same request, opposite outcome. Neither side is obviously the intended one; the UI copy says
"Card removed from binder." (`card-preview.tsx:419`), which matches the demo.

**D2 — `PATCH …/cards/:id` without a `quantity` field destroys copies on the server and does
nothing in the demo.**

- Server: `bridge.ts:1588` — `const desiredQuantity = args.quantity ?? 1;` — then
  `bridge.ts:1628-1648` deletes sibling entries in the group until the group is that size.
  The branch is **not** guarded by `isGroupMutation` (which is computed at `:1492-1495` and
  used only for the audit snapshot). So a condition-only PATCH on a card with 3 copies in a
  binder deletes 2 of them.
- Demo: `demo-store.ts:1469` — `if (updates.quantity !== undefined && targetsWholeCard)`.
  Omitted quantity → copies untouched.

This is reachable: `collection-view.tsx:693-739` `buildUpdatePayload()` never sets `quantity`,
and `handleSave` (`:751`), `handleMove` (`:799`) and `handleConfirmPrintSelection` (`:823`)
all send payloads built from it. No test on either side covers the quantity-omitted case —
every PATCH in `nativeArchitecture.test.ts` passes an explicit `quantity` (e.g. `:518`).

I did not run this, so I cannot state it as a confirmed production incident. But the code path
is unambiguous and unguarded, and it is the single strongest argument in this document: **the
duplication has already produced a divergence that looks like a server-side data-loss bug, and
the demo is the side that behaves as the UI describes.**

**D3 — Move-to-another-binder is a silent no-op in the demo.**
`targetBinderId` is in the shared contract (`packages/api-types/src/collections.ts:273`) and
implemented server-side (`bridge.ts:1491`, `:1532`). A repo-wide grep for `targetBinderId`
across `frontend/src/stores/demo-store.ts` and `frontend/src/lib/api/demo-adapter.ts` returns
**nothing**. The demo PATCH returns `200` with an unchanged card
(`demo-adapter.ts:818-832`), so the UI shows success and the card does not move.

### 3.2 Drifted — data quietly dropped in the demo

**D4 — Grading and storage fields are dropped on add.**
`demo-adapter.ts:884-887` passes `gradingCompany`, `gradingScore`, `certNumber`,
`storageLocation` into `addCardToBinder`. `makeDemoCopy` supports all four
(`demo-store.ts:195-198`). But the `copyInput` that `addCardToBinder` actually builds
(`demo-store.ts:1314-1330`) **omits them**, along with `serialNumber` and `acquiredAt`. The
server persists all six (`library.ts:461`, `:472-475`).

This is a bug caused by exactly the mechanism Stage 4 exists to prevent: a field list written
out twice, and one copy fell behind.

**D5 — `serialNumber`, `acquiredAt` and `tags` are dropped on update.**
All three are in `updateCardSchema` (`collections.ts:254-255`, `:271`) and handled by the
bridge (`bridge.ts:1541-1545`, `:1574-1583`). The demo's copy-update map
(`demo-store.ts:1410-1466`) has no branch for any of them.

**D6 — `isFoil` is not cleared when `finishCode` is cleared.**
Both server implementations couple them: `isFoil: args.isFoil ?? (args.finishCode === null ? false : entry.isFoil)` (`bridge.ts:1546-1548`, identically `library.ts:773-775`). The demo does
not: `isFoil: updates.isFoil ?? copy.isFoil` (`demo-store.ts:1426`). The sandbox editor happens
to send `isFoil` alongside `finishCode` (`collection-view.tsx:716-720`), which masks it — but
the print-selection path sends `finishCode: null` without `isFoil`
(`collection-view.tsx:823+`), where it does not.

### 3.3 Drifted — validation

**D7 — Quantity validation.** Server rejects: `!Number.isInteger(q) || q < 1` →
`BAD_REQUEST` (`library.ts:441-446`, `:756-761`; `bridge.ts:1222-1228`, `:1530-1535`;
`collections.ts:41-47`). Demo clamps: `Math.max(1, updates.quantity)`
(`demo-store.ts:1470`), and on add silently truncates via
`Array.from({ length: quantity })` (`demo-store.ts:1331`) — `2.5` becomes 2, `-1` becomes 0
copies with `quantity` still reported as `-1` on the new card row (`demo-store.ts:1377`).

**D8 — Condition vocabulary is defined once and enforced almost nowhere.**
`conditionValueSchema` restricts conditions to a 30-value list
(`collections.ts:28-72`). It is enforced **only** in the legacy Prisma router
(`collections.router.ts:393`, `:434`). In `BACKEND_MODE=convex` the request never passes
through a zod parse — `http.ts` does `typeof body.condition === "string"` and no more
(`http.ts:2058-2061`). The demo does not validate either. So this is a shared rule that
exists in `packages/` already and is dead on both live paths.

**D9 — Bulk-add has no demo implementation at all.** The server enforces 1–200 rows,
≤500 copies, per-row quantity 1–100, and "a serialised copy must be staged individually"
(`library.ts:585-616`). `/collections/bulk` falls through the demo router to `notFound()`
(`demo-adapter.ts:841`).

### 3.4 Not drifted — the rules that do still agree

Worth recording, because it bounds what an extraction would actually buy:

- **The nullable-clear idiom** for `finishCode`, `finishLabel`, `edition`, `stamp`,
  `gradingCompany`, `gradingScore`, `certNumber`, `storageLocation`: identical
  `x === undefined ? keep : (x ?? undefined)` in `demo-store.ts:1427-1464` and
  `bridge.ts:1548-1571`. ~18 fields × 3 lines, mechanically repeated in both.
- **The grouped response shape**: group by card, `quantity = copies.length`, card-level scalars
  taken from a representative copy. Both do this. They pick *different* representatives —
  server takes first-non-null across the group via `??=` (`http.ts:227-247`), demo takes
  `copies[0]` and rewrites the card row on every update (`demo-store.ts:1494-1495`) — so the
  displayed condition of a mixed-condition group can differ, but the *structure* agrees.

**Honest count:** roughly **6 rules genuinely shared and still in agreement**, against **9
divergences**, of which 3 are user-visible and 3 are silent data loss in the demo.

---

## 4. The real shape gap

### 4.1 What the shapes are

| | Demo (shipped Stage 2) | Convex |
|---|---|---|
| Storage | one Dexie row per *slice*: `records["binders"]` holds the entire `DemoBinder[]` (`demo-db.ts:111-114`, `demo-persistence.ts:60-69`) | `binders` / `collectionEntries` / `cards` / `tags` / `collectionEntryTags`, indexed `by_binder`, `by_binder_and_card` (`bridge.ts:624`) |
| Nesting | `binders[].cards[].copies[]` (`demo-store.ts:44-69`) | flat; one `collectionEntries` row per physical copy |
| Copy identity | real uid per copy (`makeDemoCopy`, `demo-store.ts:177-201`) | the entry `_id`; copies 2..N of a `quantity > 1` entry get **synthetic** ids `${entry.id}#${n}` (`http.ts:191-192`) which are *not* addressable — `asCollectionEntryId` would reject them at `http.ts:2055` |
| Card metadata | inlined per binder card as `cardData?: CardDataPayload`, **optional** (`demo-store.ts:56`) | a deduplicated `cards` row, upserted by `printingKey` then `(tcg, externalId)` (`library.ts:161-176`) |
| Tags | `copies[].tags` always `[]` (`demo-store.ts:199`); `GET /collections/tags` returns `[]` (`demo-adapter.ts:770`) | `tags` + `collectionEntryTags` join |

Note the write-amplification consequence of the shipped slice model: because
`persistChangedSlices` commits any slice whose *reference* changed
(`demo-store.ts:760-777`), adding one card rewrites the entire `binders` array as a single
Dexie row. Stage 2 removed the ~5 MB localStorage ceiling and gained atomicity and versioning,
but it did **not** make writes incremental. That is a fair thing to know before deciding
whether a row-shaped schema has independent value.

### 4.2 What `demo-adapter.ts` would have to do under a flat schema

The server's read path is two stages, and they are very different in difficulty:

**Stage A — `hydrateBinderDetail` (`library.ts:392-403`, plus `hydrateEntry` `:307-365` and
`hydrateTags` `:290-305`) — 97 lines.** A pure fan-out join: entries by binder, each entry's
card by id, each entry's tags by join table, then sort by `updatedAt` descending. There is no
Convex-specific logic in it beyond `ctx.db.get`/`withIndex`. **Fully client-side
reimplementable** over Dexie tables in ~40–60 lines, and cheaper in the demo because tags are
always empty.

**Stage B — `toLegacyBinder` + `expandLegacyCopies` + `toLegacyTags` + `findLegacyCardByCopyId`
(`http.ts:181-307`) — 127 lines.** This is the part that turns normalised entries into the
nested `cards[].copies[]` the REST contract actually returns, and it is the piece that
`demo-adapter.ts:171-226` (56 lines) is a divergent hand-written copy of. It is **pure**: it
takes a `NativeBinderDetail` and returns plain JSON. No `ctx`, no Convex imports, no `Id<>`.

**So the answer to "how much is client-side reimplementable" is: all of it, and Stage B does
not even need reimplementing — it needs *moving*.** `toLegacyBinder` is already a
storage-agnostic pure function. Lifting `http.ts:181-307` into `packages/` and having both the
HTTP layer and `demo-adapter.ts` call it is the single highest-value, lowest-risk piece of the
whole Stage 4 idea, and it is **independent of the Dexie schema** — see option (d).

---

## 5. Options, costed

Line counts are new/changed lines, estimated from the sizes of the functions each option
touches. "Blast radius" lists what can break.

### (a) Do nothing structural; pin the rules with tests on both sides, fix the bugs

**Work:**
- Fix D4/D5 (dropped fields) — ~25 lines in `demo-store.ts:1314-1330` and `:1410-1466`.
- Fix D6 (`isFoil`/`finishCode` coupling) — 2 lines.
- Fix D3 (`targetBinderId`) — ~20 lines in `demo-store.ts` + `demo-adapter.ts`.
- Decide and align D1 (delete semantics) and D2 (quantity-omitted) — ~15 lines, plus a
  decision about whether `bridge.ts:1588` is a bug. If it is, that is a server fix, not a demo
  fix.
- A shared **fixture table** of request→expected-response cases in `packages/api-types`
  (data only, no logic), exercised by `tsx --test` on the demo side and by `convex-test` on
  the server side. ~150 lines of fixtures + ~80 lines of two harnesses.

**Total: ~300 lines, ~250 of them tests/fixtures.**
**Blast radius:** demo only, plus optionally one server behaviour change (D2). Nothing in
`packages/` becomes a runtime dependency of the backend. Fully reversible.
**What it does not fix:** the field lists still exist twice. The next field added to
`updateCardSchema` still has to be added in two places — but now a fixture test fails if it
isn't.

### (b) Extract the rules to `packages/` without normalising, with a shape adapter

**Work:** define a `CollectionRules` module over an injected accessor
(`getGroup(binderId, cardId)`, `putCopy`, `deleteCopy`, …); implement the accessor twice — once
over the nested demo arrays, once over Convex `ctx.db`.

- Rules module: ~350 lines (the add/update/remove semantics, the ~18-field nullable-clear map,
  quantity reconciliation).
- Demo adapter over nested arrays: ~150 lines. Awkward, because the nested store has no
  concept of "the group of entries for (binder, card)" — it has *one* card row with a copies
  array, so `getGroupEntries` collapses to a lookup and `deleteCopy` becomes a splice.
- Convex adapter: ~120 lines, and it must be threaded through `bridge.ts:1429-1660`, replacing
  232 lines that also do auditing (`appendCollectionAudit`), tag replacement, and card upsert.
- Rewiring `bridge.ts` + `demo-store.ts`: ~200 lines changed.

**Total: ~800 lines new/changed.**
**Blast radius: large and on the authenticated path.** `bridge.ts` is what every real user's
collection mutations go through. It must keep `nativeArchitecture.test.ts`,
`bulkAdd.test.ts`, `collectionAudit.test.ts`, `collectionImport.test.ts` green, and the audit
log's before/after snapshots (`bridge.ts:1499-1507`, `:1651-1663`) are computed from group
membership — so the accessor abstraction has to expose group membership anyway, which is most
of what made the two shapes different in the first place.
**Assessment:** this is the option that sounds cheapest and is not. The adapter has to paper
over the *semantic* difference (one card row with N copies vs N rows), not just a field layout.

### (c) Re-shape the Dexie schema to the Convex row model, then extract

The plan's preferred sequencing (`data-layer-dexie-convex-plan.md:677-679`), now with a
released `schemaVersion` and a live migration underneath it.

**Work:**
1. Dexie `version(2).stores({ records: "&key, table, id", meta: "&key" })` — the shipped v1 is
   `records: "&key"` with no `table`/`id` index (`demo-db.ts:111-114`), so adding one requires
   a new version block and a full re-index of the store. ~10 lines.
2. Change the persistence granularity from slice-level to row-level: `pickSlices`,
   `toRecordRows`, `readRecordRows` (`demo-db.ts:606-647`), and on the store side
   `persistBaseline` / `persistChangedSlices` / `applyHydratedSnapshot`
   (`demo-store.ts:736-844`). This is the part the plan underestimates — the reference-identity
   diffing scheme is intrinsically per-slice. ~250 lines rewritten.
3. Rewrite the demo store's state model from `binders[].cards[].copies[]` to flat tables, and
   every selector over it. `demo-store.ts` has collection-derived selectors well past the
   mutations (e.g. the distinct-card-id counter at `:1702`). ~400 lines.
4. Reimplement `hydrateBinderDetail` client-side (~50 lines) and adopt a shared
   `toLegacyBinder` (~130 lines moved, see option (d)).
5. The v1→v2 data migration itself: ~150 lines (see §6).
6. Then the extraction from option (b): ~800 lines.

**Total: ~1,800 lines new/changed**, of which ~800 land before any duplication is removed.
**Blast radius:** the entire demo (every page reads it via `demo-adapter.ts`), plus every
returning demo visitor's stored data, plus — in step 6 — the authenticated path.
**Reversibility: poor.** Once `meta.schemaVersion = 2` is stamped, an older build hits the
"schema-from-the-future" guard (`demo-db.ts:311-317`), runs **in memory**, and shows the
visitor a freshly seeded demo. Their data is not destroyed — that guard is well built — but a
Pages rollback is user-visible as "my collection vanished".

### (d) Move only the pure projection; leave the mutation rules where they are

Not in the plan. Falls out of §4.2.

**Work:** lift `toLegacyTags` / `expandLegacyCopies` / `toLegacyBinder` /
`findLegacyCardByCopyId` (`http.ts:181-307`, 127 lines) into
`packages/api-types/src/collections-projection.ts` as pure functions over a declared input
type. Then:
- `http.ts` imports them instead of defining them (delete 127 lines, add 1 import).
- `demo-adapter.ts:171-226` builds the same input type from the nested demo store — a
  ~70-line shim that flattens `binders[].cards[].copies[]` into `{ entries: [...] }` — and
  calls the shared projection instead of its own `toCollectionCard`/`toBinder` (delete 56).

**Total: ~200 lines new/changed, ~130 of them a move.**
**Blast radius:** the response *shape* on both paths, which is exactly the thing both existing
test suites already assert on (`nativeArchitecture.test.ts:510-560`,
`demo-adapter.test.ts`). Nothing about storage, nothing about mutation semantics, no
Convex/Dexie coupling, no schema migration.
**What it buys:** removes the largest single block of genuinely duplicated *pure* logic; makes
the card-level-`id` question (D1) have exactly one answer; makes any future field added to the
grouped response appear on both sides automatically.
**What it does not buy:** none of the mutation drift (D2–D9). Those stay duplicated.

### Summary table

| | Lines | Touches authed path | Touches stored user data | Removes drift risk | Reversible |
|---|---|---|---|---|---|
| **(a)** tests + bug fixes | ~300 | only if D2 is fixed server-side | no | detects, does not remove | yes |
| **(b)** extract without normalising | ~800 | **yes**, `bridge.ts` core | no | partially | hard |
| **(c)** normalise then extract | ~1,800 | **yes** | **yes**, second migration | most | **no** |
| **(d)** share the pure projection | ~200 | shape only | no | removes ~127 lines of it | yes |

---

## 6. Option (c) in detail: what happens to a user who already has the v1 demo database

Three populations exist in the wild once Stage 2 has been served:

- **P1 — fresh Dexie v1.** Visited for the first time after Stage 2. `records` holds slice
  rows, `meta.schemaVersion = 1`.
- **P2 — imported Dexie v1.** Had a `tcg-demo-store` localStorage payload, visited after
  Stage 2; the import ran, `meta.legacyImport` is stamped, and the localStorage key was
  **deleted** (`demo-db.ts:418`).
- **P3 — still localStorage-only.** Used the demo before Stage 2 and has not returned since.
  Their `tcg-demo-store` key is intact and the import has not run yet.

Under option (c), `DEMO_SCHEMA_VERSION` becomes 2 and a v1→v2 row-shape migration is added at
`demo-db.ts:433-458`. P1 and P2 are straightforward: `hydrate()` reads
`storedVersion === 1 < 2`, calls `migrateStoredState`, and rewrites the rows in one
transaction. Fine.

**P3 is broken, and this is the finding that matters.** In `hydrate()`:

```
demo-db.ts:326   if (storedVersion === null && recordCount === 0) {
demo-db.ts:327     loaded = await this.importLegacyState(db);
...
demo-db.ts:331   if (!loaded) {
demo-db.ts:332     loaded = readRecordRows(await db.records.toArray());
demo-db.ts:337     if (loaded && storedVersion !== null && storedVersion < DEMO_SCHEMA_VERSION) {
demo-db.ts:339       loaded = await this.migrateStoredState(db, loaded, storedVersion);
```

A successful legacy import returns a truthy `loaded`, so the `if (!loaded)` at `:331` **skips
the migration entirely**. And `importLegacyState` has already stamped the *current* schema
version onto the imported rows:

```
demo-db.ts:386   { key: META_SCHEMA_VERSION_KEY, value: DEMO_SCHEMA_VERSION },
```

So a P3 user's nested localStorage payload gets written into `records` **in the nested shape**
and labelled **schema 2 (flat)**. Every subsequent boot reads `storedVersion === 2`, decides
nothing needs migrating, and hands nested data to code that expects flat rows. The failure is
silent and permanent, and the localStorage source has been deleted by then (`:418`).

This is harmless today only because `DEMO_SCHEMA_VERSION === 1` and the imported shape *is*
schema 1. It is a latent bug in shipped code that any future schema bump trips over — option
(c) is merely the first thing that would trip it.

**Fix required before (c):** the legacy payload must be treated as schema 1 explicitly —
either run `migrateStoredState(db, payload.state, 1)` on the import result, or stamp
`LEGACY_PAYLOAD_SCHEMA_VERSION = 1` at `:386` and let the normal migration path handle it on
the same boot. ~10 lines. It should arguably be fixed regardless of which option is chosen,
because it makes the *next* migration correct rather than the current one.

**Other P-population hazards specific to (c):**

- **Missing card metadata.** `DemoBinderCard.cardData` is optional (`demo-store.ts:56`), and
  `handleAddCard` passes `cardData: data.cardData` which may be `undefined`
  (`demo-adapter.ts:867`). A flat `cards` table needs a key per printing, so the migration must
  synthesise one — falling back to `cardId` for `externalId` and to the denormalised
  `name`/`setCode`/`setName`/`rarity` on the binder card. Cards seeded before the
  printing-code split landed (`demo-store.ts:287-295`) carry a combined `setCode` that
  `splitDemoPrintingCode` currently untangles at *read* time (`demo-adapter.ts:192-201`); a
  flat schema has to decide that at *migration* time, permanently.
- **Two migrations in one boot for P3.** localStorage → nested → flat, with the localStorage
  key deleted at the end. If the second step throws, `migrateStoredState`'s handler keeps the
  in-memory value and leaves the stored rows alone (`demo-db.ts:448-456`) — but the
  localStorage source is already gone, so the recovery path is "re-seed", not "retry from
  source".
- **Rollback is one-way.** As above: `demo-db.ts:311-317`.
- **Write granularity does not improve for free.** Flat rows only reduce write amplification if
  `persistChangedSlices` is also rewritten to diff per row rather than per slice
  (`demo-store.ts:760-777`). That rewrite is in the estimate above; skipping it means paying
  the migration cost and keeping the whole-array rewrite.

---

## 7. Recommendation

**Take option (a), and take the 130-line move in option (d) if there is appetite for it in the
same change.**

Reasoning, in order of weight:

1. **The stated goal of Stage 4 — "stop the two sides drifting" — is not achievable by
   extraction here, because the two sides that must agree are `demo-store.ts` and
   `bridge.ts`, and `bridge.ts` is 232 lines of Convex-coupled mutation logic with an audit
   log threaded through it.** Making it portable is Stage 5 under a different name, and §7 of
   the plan already rules Stage 5 out for reasons that remain correct (the browser does not
   call Convex; the HTTP seam is wider and is shared with the iOS app).
2. **The drift that exists is not the kind extraction prevents.** D4 and D5 are dropped fields;
   D3 is an unimplemented parameter; D9 is a missing endpoint. Those are *omissions*, and a
   fixture table catches omissions as reliably as a shared module does, for a fifth of the
   cost and none of the blast radius. D1 and D2 are genuine semantic disagreements where it is
   not clear the server is right — and a shared module would have had to encode one of them,
   silently propagating whichever was wrong to both sides.
3. **The demo is fixture data.** The plan's own §7 argument applies here at least as strongly
   as it did to Stage 5: paying 1,800 lines and an irreversible migration to protect
   resettable demo fixtures is the wrong trade. The asymmetry matters — a bug in `bridge.ts`
   costs a real user their collection; a bug in `demo-store.ts` costs a visitor a page reload.
4. **Option (c)'s premise is now false.** The plan said (`:679`) that normalisation "is a
   migration you were doing anyway". That was true before Stage 2 shipped. It is not true now:
   Stage 2 is done, `schemaVersion` 1 is released, and a second migration is pure additional
   cost with pure additional risk.

**Sequencing I would actually do:**

1. Fix `demo-db.ts`'s legacy-import version stamp (§6). ~10 lines. Correct regardless of
   everything else in this document.
2. Decide whether `bridge.ts:1588` is a bug. If yes, that is the highest-value fix in this
   entire analysis and it has nothing to do with the demo.
3. Fix D3–D6 in the demo. ~50 lines.
4. Add the shared fixture table + two harnesses. ~230 lines.
5. Optionally, later, option (d).

### What would change my mind

- **If `bridge.ts` and `library.ts` were consolidated first.** If the HTTP bridge stopped
  reimplementing `updateEntryForViewer` and delegated to it, there would be *one* server
  implementation, and the demo-vs-server pair would be well defined. Option (b) becomes
  plausible at that point — still ~600 lines, but against a single target.
- **If the demo stops being a demo.** The plan notes (`:326-328`) that demo data is never
  promoted anywhere. If "turn my demo collection into a real account" ever ships, the demo's
  data becomes authoritative, the asymmetry in point 3 disappears, and option (c)'s
  normalisation becomes prerequisite work rather than optional cleanup.
- **If the fixture table from (a) turns out to be unmaintainable** — specifically, if adding a
  field to `updateCardSchema` requires touching more than the schema plus one fixture. That
  would be evidence that the field lists really do need to be one list, and (d) followed by a
  narrow field-map extraction (the ~18-field nullable-clear block, `demo-store.ts:1427-1464`
  vs `bridge.ts:1548-1571`, and nothing else) would be worth ~120 lines.
- **If a second non-browser client appears** that needs the grouped projection. That makes (d)
  mandatory rather than optional.

---

## 8. What I could not determine

Stated explicitly so nothing is inferred from silence.

- **Whether `bridge.ts:1588`'s `args.quantity ?? 1` is intentional.** No comment explains it,
  no test covers the quantity-omitted case, and no git archaeology was done. It reads as a bug
  and the code path is unguarded, but I did not execute it. **This should be confirmed by
  running `convex-test` with a PATCH that omits `quantity` against a 3-copy group before it is
  cited as a defect.**
- **Whether D1 (delete-one-copy vs delete-the-card) has ever produced a user report.** No
  telemetry in the repo.
- **Real-world demo database sizes.** Same reason as the plan's §6 — no telemetry. The
  write-amplification argument in §4.1 is structural, not measured.
- **Whether `upsertCard`'s `printingKey`-then-`externalId` resolution (`library.ts:161-176`)
  can split one demo card across two `cards` rows** under option (c)'s migration. It depends on
  what is already in a given user's `cards` table and cannot be settled by reading.
- **The legacy Prisma path's semantics** (`backend/src/api/routes/collections.router.ts` +
  its Prisma service). I confirmed it is a fourth implementation and that it is the only place
  the zod schemas are enforced, but I did not read its add/update/remove rules. If
  `BACKEND_MODE=hybrid` is still used anywhere in practice, that is a fifth set of behaviours
  to reconcile and it would make options (b) and (c) worse, not better.
- **`mobile-apps/`** — not read, per the plan's own scope note. If the iOS client consumes the
  same grouped REST shape, option (d) gets more valuable and option (c) gets no better.

---

## 9. Outcome — what was actually done

Written after implementing the recommendation. The document above is the
analysis as it stood before any code changed; this section records what was
decided, what was built, and what was deliberately left.

### Shipped

**The sequencing in §7, steps 1–4.**

1. **`demo-db.ts`'s legacy-import version stamp** (§6) — fixed. `importLegacyState`
   now stamps `LEGACY_PAYLOAD_SCHEMA_VERSION = 1` and lets the normal migration
   path run on the same boot, instead of labelling nested data with the current
   version. Verified in a browser: a seeded pre-Stage-2 `tcg-demo-store` payload
   imports and lands with `meta.schemaVersion = 1`.

2. **`bridge.ts:1588`'s `args.quantity ?? 1`** — confirmed a bug by executing it,
   then fixed. `convex/quantityOmitted.test.ts` failed with "expected 1 to be 3"
   before the change: a condition-only PATCH on a 3-copy card deleted 2 copies.
   It is now `args.quantity ?? currentQuantity`, so an omitted quantity means
   "leave it alone", like every other field in the handler.

3. **D3–D6 in the demo** — fixed, and D1 resolved server-side:
   - **D4** — `addCardToBinder` now passes `gradingCompany`, `gradingScore`,
     `certNumber`, `storageLocation` (and `serialNumber`/`acquiredAt`, added to
     `DemoCopyInput` and `makeDemoCopy`) into the copy it builds.
   - **D5** — the copy-update map gained `serialNumber` and `acquiredAt`.
   - **D6** — `isFoil` is now cleared when `finishCode` is cleared, matching
     `bridge.ts`.
   - **D3** — `targetBinderId` is implemented. The demo no longer answers 200
     with an unmoved card.
   - **D1** — resolved by fixing the *server*, not the demo. See below.

4. **The shared fixture table** — `packages/api-types/src/collection-semantics.ts`,
   eight cases, data only. Driven by two harnesses over the same REST contract:
   `frontend/src/lib/api/collection-semantics.test.ts` (`tsx --test`, through
   `handleDemoRequest`) and `convex-backend/convex/collectionSemantics.test.ts`
   (`convex-test`, through the real HTTP router). Both green.

   The table was checked for teeth rather than assumed to have them: reverting
   the D6 fix turns exactly one case red (`clearing-finish-clears-foil`) and
   leaves the other seven green.

### D1 resolved: DELETE removes the whole card

§3.1 recorded that "neither side is obviously the intended one". Reading the
clients settles it — every caller means *the card*:

| Caller | Id sent | What it does next |
|---|---|---|
| `card-preview.tsx:415` (web) | card-level | only fires at quantity 0; reports "Card removed from binder." |
| `CollectionDetailView.swift:694` (iOS) | `card.id` | `cards.removeAll { $0.id == card.id }` |
| `CollectionDetailView.swift:967` (iOS bulk) | `cardId` | same |
| `CollectionDetailView.swift:1087` (iOS sold) | `card.id` | sells `card.quantity` — every copy — then deletes |

Nothing deletes an individual copy through this route; quantity reductions go
through PATCH. Confirmed by execution first (`convex/removeCardLevelId.test.ts`
logged "2 copies remain" against a 3-copy card), then fixed in
`bridge.removeEntry`, which now removes the whole group and writes one audit
entry naming the copy count.

**This is the one change here that alters authenticated-path behaviour
destructively, and it is worth a reviewer's attention.** The bug it replaces was
not data loss — it was a deleted card reappearing on the next refresh — whereas
the fix makes DELETE delete more. It is guarded by the argument above (no client
deletes a copy) and by the audit log, which snapshots every removed entry.

### Found while building: two things §2 did not have

- **D10 — the demo had no `GET /collections/:id`.** The server serves it; the
  demo fell through to a generic 404. Found because the fixture harness needed
  to read one binder. Implemented (~8 lines).
- **"Move card" and "move copy" are the same request on the wire.** The REST
  response reports the group's id as `copies[0].id` (`http.ts toLegacyBinder`),
  so `collection-table.tsx:160` moving a *card* and `collection-view.tsx:802`
  moving a *copy* send byte-identical PATCHes. Unlike D1 the clients do **not**
  agree, so this cannot be resolved by picking a server behaviour — it needs a
  contract change (an explicit scope, or non-aliased ids) and none was invented
  here. The demo was made to match the server (move the addressed copy), and the
  fixture pins that, so at least the two sides no longer disagree. **The
  underlying product bug remains: moving a 3-copy card from the collection table
  moves one copy.**

### Not done, and why

- **Option (b), (c) and Stage 5** — unchanged from §5/§7. Option (c)'s premise
  is still false now that `schemaVersion` 1 is released, and Stage 5 remains
  prerequisite-blocked on the browser talking to Convex directly.
- **Option (d)** (moving `toLegacyBinder` into `packages/`) — not done. §5 rates
  its blast radius as "shape only", but `convex-backend` currently imports
  *nothing* from `packages/`, so this would make the Convex deployment bundle a
  workspace package for the first time — a build/deploy change, not just a code
  move. The fixture table above is imported only by tests, so it carries none of
  that risk. Worth doing, but as its own change with a deploy verified.
- **D7 (quantity validation), D8 (condition vocabulary), D9 (bulk add)** — still
  divergent, as scoped. §7 step 3 covers D3–D6 only. D9 in particular is a whole
  endpoint the demo does not implement.
