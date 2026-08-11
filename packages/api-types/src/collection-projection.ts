/**
 * Rows → the grouped REST shape.
 *
 * The collection REST contract does not return entries; it returns one entry
 * per *card*, with the physical copies nested inside it. Turning normalised rows
 * into that shape is pure, and it was written twice — `toLegacyBinder` in
 * `convex-backend/convex/http.ts` and a divergent hand copy in
 * `frontend/src/lib/api/demo-adapter.ts`. This is the one implementation.
 *
 * The card-level `id` is deliberately the first copy's id, preserving the
 * released contract. It is also the sharpest edge in it: a client holding "the
 * id of this card" is holding a string indistinguishable from "the id of its
 * first copy", which is why move-a-card and move-a-copy are the same request
 * (`docs/stage4-shared-collection-semantics.md` §9).
 */

import type { BinderRow, CardRow, CollectionEntryRow } from "./portable-db";

export interface ProjectedCopy {
  id: string;
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
  imageUrls: string[];
  tags: unknown[];
}

export interface ProjectedCard extends Record<string, unknown> {
  id: string;
  cardId: string;
  externalId: string;
  name: string;
  tcg: string;
  quantity: number;
  copies: ProjectedCopy[];
}

export interface ProjectedBinder {
  id: string;
  name: string;
  description: string;
  colorHex?: string;
  cards: ProjectedCard[];
  createdAt: string;
  updatedAt: string;
}

const COPY_FIELDS = [
  "condition",
  "language",
  "notes",
  "price",
  "acquisitionPrice",
  "serialNumber",
  "acquiredAt",
  "isFoil",
  "finishCode",
  "finishLabel",
  "edition",
  "stamp",
  "isSealedPromo",
  "isOversized",
  "isPeelOff",
  "isSigned",
  "isAltered",
  "gradingCompany",
  "gradingScore",
  "certNumber",
  "storageLocation",
] as const;

function toCopy(entry: CollectionEntryRow): ProjectedCopy {
  const copy: Record<string, unknown> = {
    id: entry._id,
    imageUrls: entry.imageUrls ?? [],
    tags: [],
  };
  for (const field of COPY_FIELDS) copy[field] = entry[field];
  return copy as unknown as ProjectedCopy;
}

function iso(value: number): string {
  return new Date(value).toISOString();
}

/**
 * Group a binder's entries by card.
 *
 * Card-level scalars are taken from the first copy that has them, so a group of
 * mixed conditions still reports one — the same first-non-null rule the server
 * projection uses.
 */
export function projectBinder(
  binder: BinderRow,
  entries: CollectionEntryRow[],
  cards: ReadonlyMap<string, CardRow>,
): ProjectedBinder {
  const grouped = new Map<string, ProjectedCard>();

  // Oldest first, so the card-level id is stable as copies come and go.
  const ordered = [...entries].sort(
    (a, b) => a._creationTime - b._creationTime,
  );

  for (const entry of ordered) {
    const copy = toCopy(entry);
    const existing = grouped.get(entry.cardId);
    if (existing) {
      existing.quantity += 1;
      for (const field of COPY_FIELDS) {
        if (existing[field] === undefined) existing[field] = copy[field];
      }
      existing.copies.push(copy);
      continue;
    }

    const card = cards.get(entry.cardId);
    const projected: Record<string, unknown> = {
      ...(card ?? {}),
      id: entry._id,
      cardId: entry.cardId,
      externalId: card?.externalId ?? entry.cardId,
      name: card?.name ?? "",
      tcg: card?.tcg ?? "",
      languageCode: card?.language,
      quantity: 1,
      binderId: binder._id,
      binderName: binder.name,
      binderColorHex: binder.colorHex,
      copies: [copy],
    };
    for (const field of COPY_FIELDS) projected[field] = copy[field];
    // The card row carries `_id`/`_creationTime` of the *card*, which would
    // otherwise shadow the entry-level id spread above.
    delete projected._id;
    delete projected._creationTime;
    projected.id = entry._id;
    grouped.set(entry.cardId, projected as unknown as ProjectedCard);
  }

  return {
    id: binder._id,
    name: binder.name,
    description: binder.description ?? "",
    colorHex: binder.colorHex,
    cards: [...grouped.values()],
    createdAt: iso(binder.createdAt),
    updatedAt: iso(binder.updatedAt),
  };
}
