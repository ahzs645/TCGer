import type { CollectionCard } from './collections';
import { getGameDefinitionOrDefault } from './game-definitions';

export interface ConsolidatedCollectionGroup {
  key: string;
  tcg: CollectionCard['tcg'];
  name: string;
  totalQuantity: number;
  totalValue?: number;
  printings: CollectionCard[];
}

function normalizedName(value: string): string {
  return value.trim().toLocaleLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

/** Stable gameplay identity while preserving exact-printing rows underneath. */
export function collectionIdentityKey(card: CollectionCard): string {
  const mode = getGameDefinitionOrDefault(card.tcg).collection.identityModes.find(
    (candidate) => candidate.id === 'consolidated',
  );
  const configured = mode?.key === 'baseExternalId' ? card.baseExternalId : card.printingKey;
  const functionalKey = card.functionalIdentity?.key;
  const providerIdentity = card.baseExternalId ?? card.externalId;
  return `${card.tcg}:${configured ?? functionalKey ?? providerIdentity ?? normalizedName(card.name)}`;
}

export function groupCollectionCards(
  cards: readonly CollectionCard[],
): ConsolidatedCollectionGroup[] {
  const groups = new Map<string, ConsolidatedCollectionGroup>();
  for (const card of cards) {
    const key = collectionIdentityKey(card);
    const existing = groups.get(key);
    const quantity = Math.max(0, card.quantity);
    const value = card.price === undefined ? undefined : card.price * quantity;
    if (existing) {
      existing.totalQuantity += quantity;
      if (value !== undefined) existing.totalValue = (existing.totalValue ?? 0) + value;
      existing.printings.push(card);
      continue;
    }
    groups.set(key, {
      key,
      tcg: card.tcg,
      name: card.name,
      totalQuantity: quantity,
      totalValue: value,
      printings: [card],
    });
  }
  return [...groups.values()].map((group) => ({
    ...group,
    printings: [...group.printings].sort((left, right) =>
      (left.releasedAt ?? '').localeCompare(right.releasedAt ?? '') ||
      (left.setCode ?? '').localeCompare(right.setCode ?? '', undefined, { numeric: true }),
    ),
  }));
}
