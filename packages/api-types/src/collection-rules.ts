/**
 * Collection mutation rules, written once against {@link PortableDb}.
 *
 * These are the semantics that were previously implemented separately in
 * `frontend/src/stores/demo-store.ts` and `convex-backend/convex/bridge.ts` and
 * had drifted nine ways by the time anyone counted
 * (`docs/stage4-shared-collection-semantics.md` §2–3). Written here they run
 * unchanged on either runtime: in the browser over the local row store, or
 * inside Convex over `ctx.db`.
 *
 * Every rule below is pinned by `collection-semantics.ts`, which both runtimes'
 * test harnesses execute. That table is the specification; this is one
 * implementation of it.
 *
 * Deliberately *not* here: authentication, price enrichment, the audit log, and
 * tag tables. Those differ per runtime — the hosted site audits every mutation
 * and the local one has no second party to audit against — so they stay with
 * their callers.
 */

import type {
  CardRow,
  CollectionEntryRow,
  NewRow,
  PortableDb,
  PortableTableName,
} from "./portable-db";

/** Tables every rule below touches, for the transaction wrapper. */
const COLLECTION_TABLES: readonly PortableTableName[] = [
  "binders",
  "collectionEntries",
  "cards",
];

/** Copy-level fields that a `null` clears and an absent value leaves alone. */
const CLEARABLE_FIELDS = [
  "condition",
  "language",
  "notes",
  "serialNumber",
  "acquiredAt",
  "finishCode",
  "finishLabel",
  "edition",
  "stamp",
  "gradingCompany",
  "gradingScore",
  "certNumber",
  "storageLocation",
] as const;

/** Copy-level booleans: supplied or kept, never cleared by null. */
const BOOLEAN_FIELDS = [
  "isSealedPromo",
  "isOversized",
  "isPeelOff",
  "isSigned",
  "isAltered",
] as const;

export interface CardIdentity {
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
}

export type CopyFields = Partial<
  Pick<
    CollectionEntryRow,
    | "condition"
    | "language"
    | "notes"
    | "price"
    | "acquisitionPrice"
    | "serialNumber"
    | "acquiredAt"
    | "isFoil"
    | "finishCode"
    | "finishLabel"
    | "edition"
    | "stamp"
    | "isSealedPromo"
    | "isOversized"
    | "isPeelOff"
    | "isSigned"
    | "isAltered"
    | "gradingCompany"
    | "gradingScore"
    | "certNumber"
    | "storageLocation"
  >
>;

/**
 * A PATCH body. `null` means "clear this field", absent means "leave it";
 * the distinction is load-bearing and is why this is not just `CopyFields`.
 */
export type UpdateFields = {
  [K in keyof CopyFields]: CopyFields[K] | null;
} & {
  quantity?: number;
  targetBinderId?: string;
  /** See `updateCardSchema.scope`. Defaults to moving the addressed copy. */
  scope?: "card" | "copy";
};

export class CollectionRuleError extends Error {
  constructor(
    readonly code: "BAD_REQUEST" | "NOT_FOUND",
    message: string,
  ) {
    super(message);
    this.name = "CollectionRuleError";
  }
}

/* ------------------------------------------------------------------ */
/*  Card resolution                                                    */
/* ------------------------------------------------------------------ */

/**
 * Find or create the `cards` row for a printing.
 *
 * Resolution is by `printingKey` first and `(tcg, externalId)` second, matching
 * `convex/lib/library.ts` `upsertCard`: two entries for the same printing must
 * land on one card row or the grouped response splits them into two cards.
 */
export async function resolveCard(
  db: PortableDb,
  identity: CardIdentity,
  now: number,
): Promise<string> {
  if (identity.printingKey) {
    const [existing] = await db.query("cards", "by_tcg_printing_key", {
      tcg: identity.tcg,
      printingKey: identity.printingKey,
    });
    if (existing) return existing._id;
  }

  const [byExternal] = await db.query("cards", "by_tcg_external", {
    tcg: identity.tcg,
    externalId: identity.externalId,
  });
  if (byExternal) return byExternal._id;

  const doc: NewRow<CardRow> = {
    ...identity,
    createdAt: now,
    updatedAt: now,
  };
  return db.insert("cards", doc);
}

/* ------------------------------------------------------------------ */
/*  Reads                                                              */
/* ------------------------------------------------------------------ */

/** Every entry for one card in one binder — "the group". */
export function groupEntries(
  db: PortableDb,
  binderId: string,
  cardId: string,
): Promise<CollectionEntryRow[]> {
  return db.query("collectionEntries", "by_binder_and_card", {
    binderId,
    cardId,
  });
}

export function binderEntries(
  db: PortableDb,
  binderId: string,
): Promise<CollectionEntryRow[]> {
  return db.query("collectionEntries", "by_binder", { binderId });
}

/* ------------------------------------------------------------------ */
/*  Mutations                                                          */
/* ------------------------------------------------------------------ */

export interface AddCopiesArgs {
  userId: string;
  binderId: string;
  card: CardIdentity;
  quantity: number;
  fields?: CopyFields;
  now?: number;
}

/**
 * Add `quantity` copies of a card to a binder.
 *
 * One row per physical copy, which is what makes "delete one copy" and
 * "move one copy" expressible at all.
 */
export async function addCopies(
  db: PortableDb,
  args: AddCopiesArgs,
): Promise<CollectionEntryRow[]> {
  const quantity = args.quantity;
  if (!Number.isInteger(quantity) || quantity < 1) {
    throw new CollectionRuleError(
      "BAD_REQUEST",
      "quantity must be a positive integer",
    );
  }

  const now = args.now ?? Date.now();
  return db.transaction(COLLECTION_TABLES, async () => {
    const binder = await db.get("binders", args.binderId);
    if (!binder || binder.userId !== args.userId) {
      throw new CollectionRuleError("NOT_FOUND", "Collection not found");
    }

    const cardId = await resolveCard(db, args.card, now);
    const created: CollectionEntryRow[] = [];
    for (let index = 0; index < quantity; index += 1) {
      const doc: NewRow<CollectionEntryRow> = {
        userId: args.userId,
        binderId: args.binderId,
        cardId,
        quantity: 1,
        ...(args.fields ?? {}),
        createdAt: now,
        updatedAt: now,
      };
      const id = await db.insert("collectionEntries", doc);
      const row = await db.get("collectionEntries", id);
      if (row) created.push(row);
    }
    await db.patch("binders", args.binderId, { updatedAt: now });
    return created;
  });
}

/**
 * Apply a PATCH to one copy, honouring the clear-on-null idiom.
 *
 * `isFoil` is coupled to `finishCode`: clearing the finish clears the foil flag
 * with it. That coupling existed on the server and not in the demo, and the
 * print-selection path sends `finishCode: null` without `isFoil`.
 */
export function applyUpdate(
  entry: CollectionEntryRow,
  updates: UpdateFields,
  now: number,
): Partial<NewRow<CollectionEntryRow>> {
  const changes: Record<string, unknown> = { updatedAt: now };

  for (const field of CLEARABLE_FIELDS) {
    const value = updates[field];
    if (value === undefined) continue;
    changes[field] = value === null ? undefined : value;
  }
  for (const field of BOOLEAN_FIELDS) {
    const value = updates[field];
    if (value !== undefined && value !== null) changes[field] = value;
  }
  if (updates.price !== undefined && updates.price !== null) {
    changes.price = updates.price;
  }
  if (
    updates.acquisitionPrice !== undefined &&
    updates.acquisitionPrice !== null
  ) {
    changes.acquisitionPrice = updates.acquisitionPrice;
  } else if (updates.acquisitionPrice === null) {
    changes.acquisitionPrice = undefined;
  }

  changes.isFoil =
    updates.isFoil ?? (updates.finishCode === null ? false : entry.isFoil);

  return changes as Partial<NewRow<CollectionEntryRow>>;
}

export interface UpdateEntryArgs {
  userId: string;
  entryId: string;
  updates: UpdateFields;
  now?: number;
}

/**
 * Update one copy, optionally moving it to another binder and reconciling the
 * destination group's size.
 *
 * An omitted `quantity` means "leave it alone". It previously defaulted to 1 on
 * the server, which the reconciliation below reads as "reduce this group to a
 * single copy" — so a PATCH that only changed a condition deleted the rest.
 */
export async function updateEntry(
  db: PortableDb,
  args: UpdateEntryArgs,
): Promise<CollectionEntryRow> {
  const now = args.now ?? Date.now();
  const { updates } = args;

  if (
    updates.quantity !== undefined &&
    (!Number.isInteger(updates.quantity) || updates.quantity < 1)
  ) {
    throw new CollectionRuleError(
      "BAD_REQUEST",
      "quantity must be a positive integer",
    );
  }

  return db.transaction(COLLECTION_TABLES, async () => {
    const entry = await db.get("collectionEntries", args.entryId);
    if (!entry || entry.userId !== args.userId) {
      throw new CollectionRuleError("NOT_FOUND", "Card not found");
    }

    const targetBinderId = updates.targetBinderId ?? entry.binderId;
    if (targetBinderId !== entry.binderId) {
      const destination = await db.get("binders", targetBinderId);
      if (!destination || destination.userId !== args.userId) {
        throw new CollectionRuleError("NOT_FOUND", "Collection not found");
      }
    }

    const movingBinder = targetBinderId !== entry.binderId;
    // A card-scoped move takes the whole group with it. Collected before the
    // patch, while the entries are all still in the source binder.
    const alsoMoving =
      movingBinder && updates.scope === "card"
        ? (await groupEntries(db, entry.binderId, entry.cardId)).filter(
            (row) => row._id !== args.entryId,
          )
        : [];

    await db.patch("collectionEntries", args.entryId, {
      ...applyUpdate(entry, updates, now),
      binderId: targetBinderId,
      quantity: 1,
    });
    for (const row of alsoMoving) {
      await db.patch("collectionEntries", row._id, {
        binderId: targetBinderId,
        updatedAt: now,
      });
    }

    const group = await groupEntries(db, targetBinderId, entry.cardId);
    const current = group.reduce((sum, row) => sum + row.quantity, 0);
    const desired = updates.quantity ?? current;

    if (desired > current) {
      const template = await db.get("collectionEntries", args.entryId);
      for (let index = current; index < desired; index += 1) {
        const doc: NewRow<CollectionEntryRow> = {
          ...(template as CollectionEntryRow),
          serialNumber: undefined,
          quantity: 1,
          createdAt: now,
          updatedAt: now,
        };
        delete (doc as Record<string, unknown>)._id;
        delete (doc as Record<string, unknown>)._creationTime;
        await db.insert("collectionEntries", doc);
      }
    } else if (desired < current) {
      // Trim the group from the other end, never the copy just edited.
      const removable = group.filter((row) => row._id !== args.entryId);
      let excess = current - desired;
      for (const row of removable) {
        if (excess <= 0) break;
        await db.delete("collectionEntries", row._id);
        excess -= row.quantity;
      }
    }

    if (targetBinderId !== entry.binderId) {
      await db.patch("binders", entry.binderId, { updatedAt: now });
    }
    await db.patch("binders", targetBinderId, { updatedAt: now });

    const refreshed = await db.get("collectionEntries", args.entryId);
    if (!refreshed) {
      throw new CollectionRuleError("NOT_FOUND", "Card not found");
    }
    return refreshed;
  });
}

export interface RemoveCardArgs {
  userId: string;
  entryId: string;
  now?: number;
}

/**
 * Remove the whole grouped card the entry belongs to.
 *
 * Not just the addressed row: the REST response reports a group's id as its
 * first copy's id, so the id a client holds for "this card" is the same string
 * as the id of its first copy, and every caller of the delete route means the
 * card. Deleting one row left the rest behind and the card reappeared on the
 * next refresh.
 */
export async function removeCard(
  db: PortableDb,
  args: RemoveCardArgs,
): Promise<CollectionEntryRow[]> {
  const now = args.now ?? Date.now();
  return db.transaction(COLLECTION_TABLES, async () => {
    const entry = await db.get("collectionEntries", args.entryId);
    if (!entry || entry.userId !== args.userId) {
      throw new CollectionRuleError("NOT_FOUND", "Card not found");
    }
    const group = await groupEntries(db, entry.binderId, entry.cardId);
    const doomed = group.length > 0 ? group : [entry];
    for (const row of doomed) {
      await db.delete("collectionEntries", row._id);
    }
    await db.patch("binders", entry.binderId, { updatedAt: now });
    return doomed;
  });
}
