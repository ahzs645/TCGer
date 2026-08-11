# The portable storage contract, measured

**Status:** Step 1 of the corrected Stage 5 sequencing
(`docs/data-layer-dexie-convex-plan.md` §9). Measurement and design only — no
application code changed.

**Why this exists.** The goal is one application over two interchangeable storage
runtimes: a local one for on-device / PWA / desktop, and Convex for the hosted
site. That requires the collection rules to be written against a storage
interface rather than against `ctx.db` directly. Both the original plan (§4) and
the Stage 4 analysis (§5 option (b)) estimated that work from the *size of the
handlers* — ~800 lines, "blast radius large and on the authenticated path" —
without ever measuring the interface those handlers actually need.

This measures it. **The surface is far smaller than either estimate assumed**,
which changes the cost of the whole exercise.

---

## 1. What the handlers actually use

Counted across `convex/bridge.ts` and `convex/lib/library.ts` — every collection,
wishlist, tag, binder-page and audit path in the Convex backend:

| Operation | Uses |
|---|---|
| `ctx.db.patch` | 34 |
| `ctx.db.get` | 24 |
| `ctx.db.insert` | 17 |
| `ctx.db.delete` | 10 |
| `ctx.db.normalizeId` | 1 |

Five verbs. Four of them are trivial key/value operations.

### Reads are narrower still

| Shape | Uses |
|---|---|
| `.withIndex(name, q => q.eq(…))` then `.collect()` | 19 |
| … then `.unique()` | 18 |
| … then `.first()` | 1 |
| `.order("desc").take(n)` | 1 |
| `.take(n)` alone | 1 |
| **Range predicates** (`q.gt` / `q.lt` / `q.gte` / `q.lte`) | **0** |
| **Convex query `.filter()` predicates** | **0** |
| `.paginate()` | 0 |

The six apparent `.filter()` calls are plain JavaScript array filters applied to
already-collected results (`bridge.ts:395`, `:445`, `:628`, `:1637`;
`library.ts:297`, `:619`) — they run *outside* the storage layer and need
nothing from it.

So every read is **an equality lookup on an index prefix**. There are no range
scans, no server-side predicates, no pagination, and exactly one ordered read
(`collectionMutationAudits` by user, newest first, limited — `bridge.ts:1768`).

## 2. The contract that follows

```ts
type Row = { _id: string; _creationTime: number } & Record<string, unknown>;

interface PortableDb {
  get<T extends Row>(table: string, id: string): Promise<T | null>;
  insert<T extends Row>(table: string, doc: Omit<T, "_id" | "_creationTime">): Promise<string>;
  patch<T extends Row>(table: string, id: string, changes: Partial<T>): Promise<void>;
  delete(table: string, id: string): Promise<void>;

  /** Equality on an index prefix. The only read shape the handlers use. */
  query<T extends Row>(
    table: string,
    index: string,
    key: Record<string, unknown>,
    options?: { order?: "asc" | "desc"; limit?: number },
  ): Promise<T[]>;

  /** Validate that a string is an id for this table, else null. */
  normalizeId(table: string, id: string): string | null;
}
```

Six methods. Convex's `ctx.db` satisfies this structurally today — the adapter is
a thin translation, not a reimplementation. Dexie satisfies it too: an equality
lookup on an index prefix is exactly `table.where(index).equals(key)`, and
`order`/`limit` map to `.reverse()`/`.limit()`.

## 3. What this changes about the estimate

The Stage 4 analysis rated option (b) at ~800 lines and rated the accessor
abstraction as the hard part, because it assumed the abstraction had to hide the
difference between one-card-row-with-N-copies and N-rows. That is true of an
abstraction over the *current demo shape* — and it is exactly why step 2
(normalising the local store to rows) is a prerequisite rather than optional.

But once both sides are row-shaped, the interface between the rules and storage
is the six methods above, and the adapters are small:

- **Convex adapter** — a translation layer over `ctx.db`, no logic.
- **Dexie adapter** — index lookups over row tables.

The expensive part of Stage 5 is therefore **not** the contract and **not** the
adapters. It is:

1. normalising the local store's stored data (a v1→v2 demo migration — see
   `docs/stage4-shared-collection-semantics.md` §6 for the three user
   populations and the hazards), and
2. re-pointing `bridge.ts`'s 232-line `updateEntry` — plus its audit
   snapshots — at the extracted rules without changing authenticated behaviour.

Both are real, and both are where the review attention belongs. Neither is the
Express bridge, which §8 of the plan spent its argument on and which does not
have to move at all.

## 4. What is not settled here

- **`normalizeId`** is used once (`bridge.ts:651`) to validate a card id. On
  Dexie there are no opaque ids to validate, so the local adapter's
  implementation is a format check at best. Worth deciding deliberately rather
  than emulating Convex's semantics by accident.
- **Ids.** Convex mints `_id`; the local runtime would mint its own. Anything
  that round-trips an id through the REST contract has to keep working — the
  card-level/copy-level aliasing recorded in `stage4-shared-collection-semantics.md`
  §9 already shows how sharp that edge is.
- **Transactions.** Every mutation path above is atomic in Convex. Dexie has
  transactions, but the contract as written does not express one; the rules need
  a `transaction(tables, fn)` wrapper before they can be shared safely.
- **The audit log.** `appendCollectionAudit` writes before/after snapshots on
  every collection mutation. Whether the local runtime keeps an audit log at all
  is a product decision, not a storage one.
- **This measurement covers the Convex backend only.** The iOS `LocalStore`
  (2,447 lines) is a third implementation of the same surface and is not
  analysed here; whether it converges on this contract is a separate question.
