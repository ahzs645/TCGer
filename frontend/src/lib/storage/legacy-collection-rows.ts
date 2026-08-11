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
  const externalId = card.cardData?.externalId ?? card.cardId;
  return `${card.tcg}:${externalId}`;
}

function toCardRow(card: DemoBinderCard, now: number): CardRow {
  const data = card.cardData;
  return {
    _id: `card_${cardKey(card)}`,
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
