/**
 * The shipped nested collection shape → portable rows.
 *
 * `demo-store.ts` stores `binders[].cards[].copies[]`. The portable contract
 * needs `binders` / `collectionEntries` / `cards` as flat rows, because "the
 * group of entries for (binder, card)" — the thing every quantity, move and
 * delete rule is expressed in terms of — has no representation in the nested
 * shape.
 *
 * **Ids are preserved, never re-minted.** A binder id appears in the URL
 * (`/collections?binder=…`), and a copy id is what the REST contract hands
 * clients as a card's id. Re-minting would break a returning visitor's links
 * and any id already in flight.
 *
 * Two shapes have to be handled, because both are in the wild:
 *
 *  - cards with a real `copies` array (everything written since copies landed);
 *  - cards with only `quantity` and card-level `condition`/`price`, from before
 *    that. Those get synthesised copies, exactly as the store's own read path
 *    already does when `copies` is absent.
 */

import type {
  BinderRow,
  CardRow,
  CollectionCardCopy,
  CollectionEntryRow,
} from "@tcg/api-types";
import type { PortableSnapshot } from "./local-portable-db";
import type { DemoBinder, DemoBinderCard } from "@/stores/demo-store";

/** The local runtime has one user; the rules still scope every row by id. */
export const LOCAL_USER_ID = "demo-user-001";

function epoch(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? fallback : parsed;
}

/**
 * The key a card row is deduplicated by.
 *
 * `cardData.externalId` is the real printing id when catalog enrichment has
 * run; before that the store only has its own `cardId`, so that is the
 * fallback — the same resolution order `resolveCard` uses.
 */
function cardKey(card: DemoBinderCard): string {
  return `${card.tcg}:${card.cardId}`;
}

/** The row id for a printing. Deterministic, so the demo card id survives. */
export function cardRowId(tcg: string, demoCardId: string): string {
  return `${CARD_ROW_PREFIX}${tcg}:${demoCardId}`;
}

const CARD_ROW_PREFIX = "card:";

/**
 * Recover the demo card id a row was built from.
 *
 * `DemoBinderCard.cardId` is what every ownership check compares against
 * (`isCardInCollection`, `getOwnedQuantity`, and the owned badges they feed),
 * and it is *not* the same as `externalId` once catalog enrichment has attached
 * a real printing id to a seeded card. Carrying it in the row id keeps those
 * checks answering exactly as they did before rows existed.
 */
export function demoCardIdFromRow(row: CardRow): string {
  if (!row._id.startsWith(CARD_ROW_PREFIX)) return row.externalId;
  const rest = row._id.slice(CARD_ROW_PREFIX.length);
  const separator = rest.indexOf(":");
  return separator < 0 ? row.externalId : rest.slice(separator + 1);
}

function toCardRow(card: DemoBinderCard, now: number): CardRow {
  const data = card.cardData;
  return {
    _id: cardRowId(card.tcg, card.cardId),
    _creationTime: epoch(card.addedAt, now),
    tcg: card.tcg,
    externalId: data?.externalId ?? card.cardId,
    printingKey: data?.printingKey,
    name: data?.name ?? card.name,
    setCode: data?.setCode ?? card.setCode,
    setName: data?.setName ?? card.setName,
    rarity: data?.rarity ?? card.rarity,
    collectorNumber: data?.collectorNumber,
    imageUrl: data?.imageUrl,
    imageUrlSmall: data?.imageUrlSmall,
    language: data?.language,
    releasedAt: data?.releasedAt,
    createdAt: epoch(card.addedAt, now),
    updatedAt: epoch(card.addedAt, now),
  };
}

/**
 * Copies for one card, in a stable order.
 *
 * `_creationTime` is nudged by index so the projection's "oldest first" sort is
 * deterministic — otherwise every copy of a card added in the same millisecond
 * ties, and which one becomes the card-level id could change between reads.
 */
function toEntryRows(
  card: DemoBinderCard,
  binderId: string,
  cardRowId: string,
  now: number,
): CollectionEntryRow[] {
  const addedAt = epoch(card.addedAt, now);
  const copies: CollectionCardCopy[] =
    card.copies && card.copies.length > 0
      ? card.copies
      : Array.from({ length: Math.max(1, card.quantity) }, (_, index) => ({
          id: `${card.id}-copy-${index + 1}`,
          condition: card.condition,
          price: card.price,
          tags: [],
        }));

  return copies.map((copy, index) => ({
    _id: copy.id,
    _creationTime: addedAt + index,
    userId: LOCAL_USER_ID,
    binderId,
    cardId: cardRowId,
    quantity: 1,
    condition: copy.condition ?? card.condition,
    language: copy.language,
    notes: copy.notes,
    price: copy.price ?? card.price,
    acquisitionPrice: copy.acquisitionPrice,
    serialNumber: copy.serialNumber,
    acquiredAt: copy.acquiredAt ?? card.addedAt,
    isFoil: copy.isFoil,
    finishCode: copy.finishCode,
    finishLabel: copy.finishLabel,
    edition: copy.edition,
    stamp: copy.stamp,
    isSealedPromo: copy.isSealedPromo,
    isOversized: copy.isOversized,
    isPeelOff: copy.isPeelOff,
    isSigned: copy.isSigned,
    isAltered: copy.isAltered,
    gradingCompany: copy.gradingCompany,
    gradingScore: copy.gradingScore,
    certNumber: copy.certNumber,
    storageLocation: copy.storageLocation,
    createdAt: addedAt,
    updatedAt: addedAt,
  }));
}

/** Convert the whole nested collection into rows. Pure. */
export function toPortableRows(
  binders: DemoBinder[],
  now = Date.now(),
): PortableSnapshot {
  const binderRows: BinderRow[] = [];
  const entryRows: CollectionEntryRow[] = [];
  const cardRows = new Map<string, CardRow>();

  for (const binder of binders) {
    const created = epoch(binder.createdAt, now);
    binderRows.push({
      _id: binder.id,
      _creationTime: created,
      userId: LOCAL_USER_ID,
      kind: "binder",
      name: binder.name,
      // Stored with a leading '#', but the REST contract carries it without.
      colorHex: binder.color?.replace(/^#/, ""),
      createdAt: created,
      updatedAt: epoch(binder.updatedAt, created),
    });

    for (const card of binder.cards) {
      const key = cardKey(card);
      let row = cardRows.get(key);
      if (!row) {
        row = toCardRow(card, now);
        cardRows.set(key, row);
      } else if (!row.imageUrl && card.cardData?.imageUrl) {
        // A later copy of the same printing may carry enrichment the first did
        // not; keep the richer row rather than the first one seen.
        cardRows.set(key, { ...row, imageUrl: card.cardData.imageUrl });
      }
      entryRows.push(...toEntryRows(card, binder.id, row._id, now));
    }
  }

  return {
    binders: binderRows,
    collectionEntries: entryRows,
    cards: [...cardRows.values()],
  };
}

/* ------------------------------------------------------------------ */
/*  Rows → the nested read model                                       */
/* ------------------------------------------------------------------ */

/**
 * Rebuild the nested shape from rows.
 *
 * The rows are the truth and this is a *derived* read model, not a second copy
 * that can drift: it is regenerated from the rows after every mutation and is
 * never edited in place. It exists so the collection selectors — totals, game
 * and rarity breakdowns, ownership checks, catalog enrichment — keep reading
 * synchronously off a shape they already understand, while the mutations
 * beneath them run through the shared rules.
 */
export function toDemoBinders(
  rows: PortableSnapshot,
  demoCards?: ReadonlyMap<string, DemoBinderCard>,
): DemoBinder[] {
  const cardsById = new Map(rows.cards.map((card) => [card._id, card]));
  const byBinder = new Map<string, CollectionEntryRow[]>();
  for (const entry of rows.collectionEntries) {
    const list = byBinder.get(entry.binderId);
    if (list) list.push(entry);
    else byBinder.set(entry.binderId, [entry]);
  }

  return rows.binders.map((binder) => {
    const entries = (byBinder.get(binder._id) ?? [])
      .slice()
      .sort((a, b) => a._creationTime - b._creationTime);

    const grouped = new Map<string, DemoBinderCard>();
    for (const entry of entries) {
      const card = cardsById.get(entry.cardId);
      const copy = {
        id: entry._id,
        condition: entry.condition,
        language: entry.language,
        notes: entry.notes,
        price: entry.price,
        acquisitionPrice: entry.acquisitionPrice,
        serialNumber: entry.serialNumber,
        acquiredAt: entry.acquiredAt,
        isFoil: entry.isFoil,
        finishCode: entry.finishCode,
        finishLabel: entry.finishLabel,
        edition: entry.edition,
        stamp: entry.stamp,
        isSealedPromo: entry.isSealedPromo,
        isOversized: entry.isOversized,
        isPeelOff: entry.isPeelOff,
        isSigned: entry.isSigned,
        isAltered: entry.isAltered,
        gradingCompany: entry.gradingCompany,
        gradingScore: entry.gradingScore,
        certNumber: entry.certNumber,
        storageLocation: entry.storageLocation,
        tags: [],
      } satisfies CollectionCardCopy;

      const existing = grouped.get(entry.cardId);
      if (existing) {
        existing.copies!.push(copy);
        existing.quantity = existing.copies!.length;
        continue;
      }

      const demoCardId = card ? demoCardIdFromRow(card) : entry.cardId;
      // Preserve whatever the previous nested card carried that rows do not
      // model — chiefly `cardData`, which catalog enrichment writes back.
      const previous = demoCards?.get(`${binder._id}:${demoCardId}`);
      grouped.set(entry.cardId, {
        id: entry._id,
        cardId: demoCardId,
        name: card?.name ?? previous?.name ?? "",
        tcg: (card?.tcg ?? previous?.tcg ?? "magic") as DemoBinderCard["tcg"],
        setCode: card?.setCode ?? previous?.setCode ?? "",
        setName: card?.setName ?? previous?.setName ?? "",
        rarity: card?.rarity ?? previous?.rarity ?? "",
        condition: entry.condition ?? previous?.condition ?? "Near Mint",
        price: entry.price ?? previous?.price ?? 0,
        quantity: 1,
        addedAt: entry.acquiredAt ?? new Date(entry.createdAt).toISOString(),
        cardData: previous?.cardData,
        copies: [copy],
      });
    }

    return {
      id: binder._id,
      name: binder.name,
      color: binder.colorHex ? `#${binder.colorHex}` : "#3b82f6",
      cards: [...grouped.values()],
      createdAt: new Date(binder.createdAt).toISOString(),
      updatedAt: new Date(binder.updatedAt).toISOString(),
    };
  });
}

/** Key `toDemoBinders` uses to carry non-row fields across a rebuild. */
export function demoCardKey(binderId: string, demoCardId: string): string {
  return `${binderId}:${demoCardId}`;
}

/** Index the current nested cards so a rebuild can preserve `cardData`. */
export function indexDemoCards(
  binders: DemoBinder[],
): Map<string, DemoBinderCard> {
  const index = new Map<string, DemoBinderCard>();
  for (const binder of binders) {
    for (const card of binder.cards) {
      index.set(demoCardKey(binder.id, card.cardId), card);
    }
  }
  return index;
}
