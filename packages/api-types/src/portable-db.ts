/**
 * The portable storage contract.
 *
 * TCGer runs the same application over two interchangeable storage runtimes: a
 * local one (on-device / PWA / desktop, and the web demo) and Convex for the
 * hosted site. Nothing is synced between them — one is selected at startup, the
 * societyer pattern described in `docs/data-layer-dexie-convex-plan.md` §9.
 *
 * For that to be worth anything the collection rules have to be written once,
 * against an interface rather than against `ctx.db`. This is that interface, and
 * it is deliberately the *smallest* one that the existing handlers need rather
 * than a general-purpose database abstraction. `docs/portable-db-contract.md`
 * records the measurement it is derived from: across `convex/bridge.ts` and
 * `convex/lib/library.ts` the handlers use five verbs, and every read is an
 * equality lookup on an index prefix — no range predicates, no server-side
 * filters, no pagination.
 *
 * Keeping it that small is the point. Every method added here has to be
 * implemented by every runtime, so the contract is the budget.
 */

/* ------------------------------------------------------------------ */
/*  Rows                                                               */
/* ------------------------------------------------------------------ */

/**
 * The two fields every row carries, named to match Convex so documents can move
 * between runtimes without a translation step.
 */
export interface PortableRow {
  _id: string;
  _creationTime: number;
}

/** A row as supplied to `insert` — the store mints `_id`/`_creationTime`. */
export type NewRow<T extends PortableRow> = Omit<T, "_id" | "_creationTime">;

export interface BinderRow extends PortableRow {
  userId: string;
  kind: "binder" | "library";
  name: string;
  description?: string;
  colorHex?: string;
  defaultCondition?: string;
  containerType?: string;
  imageUrl?: string;
  associatedTcg?: string;
  associatedSetCode?: string;
  associatedSetName?: string;
  createdAt: number;
  updatedAt: number;
}

/**
 * One physical copy. The nested `binders[].cards[].copies[]` shape the demo
 * store shipped with cannot back this contract — "the group of entries for
 * (binder, card)" has no representation there — which is why normalising the
 * local store is prerequisite work rather than cleanup.
 */
export interface CollectionEntryRow extends PortableRow {
  userId: string;
  binderId: string;
  cardId: string;
  quantity: number;
  condition?: string;
  language?: string;
  notes?: string;
  price?: number;
  acquisitionPrice?: number;
  serialNumber?: string;
  acquiredAt?: string;
  isFoil?: boolean;
  finishCode?: string;
  finishLabel?: string;
  edition?: string;
  stamp?: string;
  isSealedPromo?: boolean;
  isOversized?: boolean;
  isPeelOff?: boolean;
  isSigned?: boolean;
  isAltered?: boolean;
  gradingCompany?: string;
  gradingScore?: string;
  certNumber?: string;
  storageLocation?: string;
  imageUrls?: string[];
  createdAt: number;
  updatedAt: number;
}

/** A deduplicated printing. Many entries point at one of these. */
export interface CardRow extends PortableRow {
  tcg: string;
  externalId: string;
  printingKey?: string;
  name: string;
  setCode?: string;
  setName?: string;
  rarity?: string;
  collectorNumber?: string;
  imageUrl?: string;
  imageUrlSmall?: string;
  language?: string;
  releasedAt?: string;
  createdAt: number;
  updatedAt: number;
}

export interface PortableTables {
  binders: BinderRow;
  collectionEntries: CollectionEntryRow;
  cards: CardRow;
}

export type PortableTableName = keyof PortableTables;

/**
 * The indexes the rules read through, named as they are in
 * `convex-backend/convex/schema.ts` so both runtimes describe the same access
 * paths. A runtime that cannot serve one of these cannot host the rules.
 */
export const PORTABLE_INDEXES = {
  binders: {
    by_user: ["userId"],
  },
  collectionEntries: {
    by_binder: ["binderId"],
    by_binder_and_card: ["binderId", "cardId"],
    by_user: ["userId"],
  },
  cards: {
    by_tcg_external: ["tcg", "externalId"],
    by_tcg_printing_key: ["tcg", "printingKey"],
  },
} as const satisfies Record<
  PortableTableName,
  Record<string, readonly string[]>
>;

export type PortableIndexName<T extends PortableTableName> =
  keyof (typeof PORTABLE_INDEXES)[T] & string;

export interface PortableQueryOptions {
  /** Newest first when "desc". Ordered by `_creationTime`, as Convex does. */
  order?: "asc" | "desc";
  limit?: number;
}

/* ------------------------------------------------------------------ */
/*  The contract                                                       */
/* ------------------------------------------------------------------ */

export interface PortableDb {
  get<T extends PortableTableName>(
    table: T,
    id: string,
  ): Promise<PortableTables[T] | null>;

  insert<T extends PortableTableName>(
    table: T,
    doc: NewRow<PortableTables[T]>,
  ): Promise<string>;

  patch<T extends PortableTableName>(
    table: T,
    id: string,
    changes: Partial<NewRow<PortableTables[T]>>,
  ): Promise<void>;

  delete<T extends PortableTableName>(table: T, id: string): Promise<void>;

  /**
   * Equality on an index prefix — the only read shape the handlers use.
   *
   * `key` may name a prefix of the index rather than all of it (querying
   * `by_binder_and_card` with only `binderId` is legal), matching how Convex's
   * `withIndex` chains `.eq()` calls.
   */
  query<T extends PortableTableName>(
    table: T,
    index: PortableIndexName<T>,
    key: Partial<PortableTables[T]>,
    options?: PortableQueryOptions,
  ): Promise<PortableTables[T][]>;

  /**
   * Run `fn` atomically. Every mutation path in the Convex handlers is atomic,
   * so the rules cannot be shared safely without this: a partially applied
   * quantity reconciliation would leave a collection in a state no rule can
   * describe.
   */
  transaction<R>(
    tables: readonly PortableTableName[],
    fn: () => Promise<R>,
  ): Promise<R>;
}

/**
 * Does `id` look like an id for this table?
 *
 * Convex's `normalizeId` validates against its own id encoding; a local runtime
 * mints plain strings and has nothing to check beyond "is this a non-empty
 * string this store could have issued". Implementations return `null` for
 * anything they would not have minted, so callers can reject a bad path
 * parameter without a lookup.
 */
export type NormalizeId = (
  table: PortableTableName,
  id: string,
) => string | null;
