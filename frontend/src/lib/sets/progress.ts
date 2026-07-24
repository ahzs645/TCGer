import type { Card, CollectionCard, TcgSet } from "@tcg/api-types";

type FuturePrintingFields = {
  baseExternalId?: string;
  baseId?: string;
  printingKey?: string;
  artworkId?: string;
};

export type SetCardLike = (
  | Card
  | CollectionCard
  | (Partial<Card> & {
      id?: string;
      cardId?: string;
      externalId?: string;
      name: string;
      tcg: Card["tcg"];
    })
) &
  FuturePrintingFields;

export interface SetProgress {
  owned: number;
  total: number;
  percent: number;
  complete: boolean;
  ownedPrintingKeys: Set<string>;
}

export interface IdentityProgress {
  owned: number;
  total: number;
  percent: number;
  complete: boolean;
}

function normalized(value: unknown): string {
  return typeof value === "string" ? value.trim().toLocaleLowerCase() : "";
}

function attributeString(
  card: SetCardLike,
  key: keyof FuturePrintingFields,
): string {
  const direct = card[key];
  if (typeof direct === "string" && direct.trim()) return direct.trim();

  const value = card.attributes?.[key];
  return typeof value === "string" ? value.trim() : "";
}

function sourceId(card: SetCardLike): string {
  const baseExternalId = attributeString(card, "baseExternalId");
  if (baseExternalId) return baseExternalId;
  if ("externalId" in card && card.externalId) return card.externalId;
  return (
    attributeString(card, "baseId") ||
    ("cardId" in card && card.cardId ? card.cardId : "") ||
    card.id ||
    ""
  );
}

function artworkIdentity(card: SetCardLike): string {
  return (
    attributeString(card, "artworkId") ||
    normalized(card.imageUrl) ||
    normalized(card.imageUrlSmall)
  );
}

function explicitArtworkIdentity(card: SetCardLike): string {
  return normalized(attributeString(card, "artworkId"));
}

export function normalizeSetCode(value: string | null | undefined): string {
  return normalized(value).replace(/\s+/g, "");
}

export function isCardInSet(card: SetCardLike, set: TcgSet): boolean {
  if (card.tcg !== set.tcg) return false;

  const cardCode = normalizeSetCode(card.setCode);
  const catalogCode = normalizeSetCode(set.code);
  if (cardCode && catalogCode) {
    if (cardCode === catalogCode) return true;
    if (set.tcg === "yugioh" && cardCode.startsWith(`${catalogCode}-`)) {
      return true;
    }
  }

  return Boolean(
    card.setName && normalized(card.setName) === normalized(set.name),
  );
}

export function getPrintingIdentity(card: SetCardLike): string {
  const explicitKey = attributeString(card, "printingKey");
  if (explicitKey) return `printing:${explicitKey}`;

  return [
    "derived",
    normalized(card.tcg),
    normalized(sourceId(card)),
    normalizeSetCode(card.setCode),
    normalized(card.collectorNumber),
    normalized(card.rarity),
    artworkIdentity(card),
    normalized(card.name),
  ].join("|");
}

export function getCardIdentity(card: SetCardLike): string {
  const baseId = normalized(sourceId(card));
  if (baseId) {
    return `identity:${normalized(card.tcg)}:${baseId}`;
  }
  return `identity:${normalized(card.tcg)}:name:${normalized(card.name)}`;
}

export function isSamePrinting(
  setCard: SetCardLike,
  ownedCard: SetCardLike,
): boolean {
  if (setCard.tcg !== ownedCard.tcg) return false;

  const setPrintingKey = attributeString(setCard, "printingKey");
  const ownedPrintingKey = attributeString(ownedCard, "printingKey");
  if (setPrintingKey && ownedPrintingKey) {
    return setPrintingKey === ownedPrintingKey;
  }

  const setCode = normalizeSetCode(setCard.setCode);
  const ownedSetCode = normalizeSetCode(ownedCard.setCode);
  if (setCode && ownedSetCode && setCode !== ownedSetCode) return false;

  const collectorNumber = normalized(setCard.collectorNumber);
  const ownedCollectorNumber = normalized(ownedCard.collectorNumber);
  if (
    collectorNumber &&
    ownedCollectorNumber &&
    collectorNumber !== ownedCollectorNumber
  ) {
    return false;
  }

  const rarity = normalized(setCard.rarity);
  const ownedRarity = normalized(ownedCard.rarity);
  if (rarity && ownedRarity && rarity !== ownedRarity) return false;

  const artwork = explicitArtworkIdentity(setCard);
  const ownedArtwork = explicitArtworkIdentity(ownedCard);
  if (artwork && ownedArtwork && artwork !== ownedArtwork) return false;

  const setSourceId = normalized(sourceId(setCard));
  const ownedSourceId = normalized(sourceId(ownedCard));
  if (setSourceId && ownedSourceId && setSourceId === ownedSourceId) {
    return !setCode || !ownedSetCode || setCode === ownedSetCode;
  }

  const sameName = normalized(setCard.name) === normalized(ownedCard.name);
  if (!sameName) return false;

  if (setCode && ownedSetCode && collectorNumber && ownedCollectorNumber) {
    return true;
  }

  return Boolean(setCode && ownedSetCode && (rarity || ownedRarity));
}

export function uniquePrintings<T extends SetCardLike>(cards: T[]): T[] {
  const printings = new Map<string, T>();
  for (const card of cards) {
    const key = getPrintingIdentity(card);
    if (!printings.has(key)) printings.set(key, card);
  }
  return Array.from(printings.values());
}

export function summarizeSetProgress(
  setCards: SetCardLike[],
  ownedCards: SetCardLike[],
): SetProgress {
  const printings = uniquePrintings(setCards);
  const ownedPrintingKeys = new Set<string>();

  for (const printing of printings) {
    if (ownedCards.some((ownedCard) => isSamePrinting(printing, ownedCard))) {
      ownedPrintingKeys.add(getPrintingIdentity(printing));
    }
  }

  const total = printings.length;
  const owned = ownedPrintingKeys.size;
  return {
    owned,
    total,
    percent: total > 0 ? Math.min(100, Math.round((owned / total) * 100)) : 0,
    complete: total > 0 && owned >= total,
    ownedPrintingKeys,
  };
}

export function summarizeIdentityProgress(
  setCards: SetCardLike[],
  ownedCards: SetCardLike[],
): IdentityProgress {
  const identities = new Set(setCards.map(getCardIdentity));
  const ownedIdentities = new Set(
    ownedCards
      .map(getCardIdentity)
      .filter((identity) => identities.has(identity)),
  );
  const total = identities.size;
  const owned = ownedIdentities.size;
  return {
    owned,
    total,
    percent: total > 0 ? Math.min(100, Math.round((owned / total) * 100)) : 0,
    complete: total > 0 && owned >= total,
  };
}

export function countOwnedPrintingsForSet(
  set: TcgSet,
  ownedCards: SetCardLike[],
): number {
  const cards = ownedCards.filter((card) => isCardInSet(card, set));
  return uniquePrintings(cards).length;
}

export function releaseYear(
  releaseDate: string | null | undefined,
): number | null {
  if (!releaseDate) return null;
  const year = new Date(releaseDate).getUTCFullYear();
  return Number.isFinite(year) ? year : null;
}
