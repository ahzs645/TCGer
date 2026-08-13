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

/* ------------------------------------------------------------------ */
/*  Wishlists                                                          */
/* ------------------------------------------------------------------ */

export interface WishlistRow extends PortableRow {
  userId: string;
  name: string;
  description?: string;
  colorHex?: string;
  /** A card counts as owned if *any* printing of it is, not just this one. */
  matchAnyPrinting?: boolean;
  createdAt: number;
  updatedAt: number;
}

/**
 * One wanted card.
 *
 * Unlike the collection there is no shared `cards` row behind this: a wishlist
 * entry is a *want*, and two wishlists wanting the same printing have nothing
 * to share — no quantity to reconcile, no group to keep consistent. Convex
 * models it the same way (`wishlistCards` carries its own printing fields
 * rather than referencing a card table).
 */
export interface WishlistCardRow extends PortableRow {
  wishlistId: string;
  externalId: string;
  tcg: string;
  name: string;
  desiredQuantity?: number;
  /**
   * The id a *local* catalog knows this printing by, when it differs from
   * `externalId`. The demo seeds cards as `ygo-7` and only learns the real
   * printing id once catalog enrichment runs, and every local ownership check
   * compares against the former — the same distinction `demoCardIdFromRow`
   * preserves for the collection. A hosted runtime has no second identity and
   * leaves this unset.
   */
  localCardId?: string;
  baseExternalId?: string;
  printingKey?: string;
  setCode?: string;
  setName?: string;
  rarity?: string;
  imageUrl?: string;
  imageUrlSmall?: string;
  collectorNumber?: string;
  releasedAt?: string;
  language?: string;
  notes?: string;
  /**
   * The card payload exactly as the client sent it, or absent when the card was
   * added without one.
   *
   * The columns above are denormalised out of this — they are what indexes and
   * rules read. This is what a client gets handed back, and it is kept whole
   * for two reasons: it carries a dozen structured fields (Pokédex entries,
   * format legality, provenance) that would otherwise need a dozen more
   * columns in a contract every runtime has to implement, and "no payload" is
   * a fact the demo's catalog matcher branches on, which a rebuilt-from-columns
   * payload could not express. Convex's `deckCards.cardData` is the same idea.
   */
  cardData?: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
}

/** A saved expansion rule — "every card in this set" — for a smart wishlist. */
export interface WishlistRuleRow extends PortableRow {
  wishlistId: string;
  type: "name" | "set" | "artist" | "tag";
  tcg?: string;
  query?: string;
  setCode?: string;
  setName?: string;
  includeAllPrintings: boolean;
  autoSync: boolean;
  lastSyncedAt?: number;
  lastMatchCount?: number;
  createdAt: number;
  updatedAt: number;
}

/* ------------------------------------------------------------------ */
/*  Decks                                                              */
/* ------------------------------------------------------------------ */

export interface DeckRow extends PortableRow {
  userId: string;
  name: string;
  description?: string;
  tcg: string;
  format?: string;
  colorHex?: string;
  isPublic: boolean;
  /** Demo-only: whether the list is finished. Convex has no counterpart. */
  isComplete?: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface DeckCardRow extends PortableRow {
  deckId: string;
  /**
   * Optional, unlike Convex's `deckCards.externalId`. A deck the local runtime
   * built from a pasted list names its cards and nothing else; requiring an id
   * here would mean inventing one, and an invented id is worse than none.
   */
  externalId?: string;
  tcg?: string;
  name: string;
  quantity: number;
  zone?: "main" | "extra" | "side";
  isCommander?: boolean;
  isSideboard?: boolean;
  imageUrl?: string;
  imageUrlSmall?: string;
  setCode?: string;
  setName?: string;
  rarity?: string;
  /** "Monster", "Spell", "Creature" — Convex keeps this inside `cardData`. */
  cardType?: string;
}

/* ------------------------------------------------------------------ */
/*  Trades                                                             */
/* ------------------------------------------------------------------ */

/**
 * One trade with another collector.
 *
 * Convex's `trades` has `senderId`/`receiverId`, both `v.id("users")`, because
 * the hosted runtime knows both parties. A local runtime has exactly one user
 * and the counterparty is a name typed into a box, so the second party is
 * `partner` rather than an id. The status vocabulary is the local one for the
 * same reason — nothing here is *offered* to a second account that could
 * cancel it.
 */
export interface TradeRow extends PortableRow {
  userId: string;
  partner: string;
  status: "pending" | "completed" | "declined";
  /** The calendar day the trade is filed under, `YYYY-MM-DD`. */
  tradedOn: string;
  createdAt: number;
  updatedAt: number;
}

export interface TradeCardRow extends PortableRow {
  tradeId: string;
  /** Which way the card moves, from this user's point of view. */
  side: "giving" | "receiving";
  name: string;
  tcg: string;
  quantity: number;
  externalId?: string;
  imageUrl?: string;
  estimatedValue?: number;
}

/* ------------------------------------------------------------------ */
/*  Sealed product                                                     */
/* ------------------------------------------------------------------ */

/**
 * A sealed product the user holds.
 *
 * Convex splits this in two — `sealedProducts` is a shared catalog keyed by
 * `catalogKey`, `sealedInventory` is one user's holding of one of them. A local
 * runtime has no shared catalog to point at, so the product's own fields are
 * denormalised onto the holding. An adapter over `ctx.db` would join the two;
 * the reverse (a catalog row per local purchase) would invent rows that the
 * hosted runtime would then have to deduplicate.
 */
export interface SealedInventoryRow extends PortableRow {
  userId: string;
  name: string;
  tcg: string;
  productType: string;
  setName?: string;
  quantity: number;
  purchasePrice: number;
  /** What it is worth now. Local valuation; Convex derives this from pricing. */
  currentValue: number;
  purchasedOn: string;
  createdAt: number;
  updatedAt: number;
}

export interface PortableTables {
  binders: BinderRow;
  collectionEntries: CollectionEntryRow;
  cards: CardRow;
  wishlists: WishlistRow;
  wishlistCards: WishlistCardRow;
  wishlistRules: WishlistRuleRow;
  decks: DeckRow;
  deckCards: DeckCardRow;
  trades: TradeRow;
  tradeCards: TradeCardRow;
  sealedInventory: SealedInventoryRow;
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
  wishlists: {
    by_user: ["userId"],
  },
  wishlistCards: {
    by_wishlist: ["wishlistId"],
    by_wishlist_external_tcg: ["wishlistId", "externalId", "tcg"],
  },
  wishlistRules: {
    by_wishlist: ["wishlistId"],
  },
  decks: {
    by_user: ["userId"],
  },
  deckCards: {
    by_deck: ["deckId"],
  },
  trades: {
    by_user: ["userId"],
  },
  tradeCards: {
    by_trade: ["tradeId"],
  },
  sealedInventory: {
    by_user: ["userId"],
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
