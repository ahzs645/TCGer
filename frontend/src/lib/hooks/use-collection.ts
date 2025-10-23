import { useMemo } from 'react';

import { SAMPLE_COLLECTIONS } from '@/lib/data/sample-collections';
import type { CollectionCard, TcgCode } from '@/types/card';

interface UseCollectionOptions {
  collectionId: string;
  query: string;
  game: TcgCode | 'all';
  enabledGames: Record<'yugioh' | 'magic' | 'pokemon', boolean>;
}

export function useCollectionData({ collectionId, query, game, enabledGames }: UseCollectionOptions) {
  const collection = SAMPLE_COLLECTIONS.find((entry) => entry.id === collectionId) ?? SAMPLE_COLLECTIONS[0];
  const normalizedQuery = query.trim().toLowerCase();

  const items = useMemo<CollectionCard[]>(() => {
    if (!collection) {
      return [];
    }

    return collection.cards.filter((card) => {
      if (!enabledGames[card.tcg]) return false;
      if (game !== 'all' && card.tcg !== game) return false;
      if (!normalizedQuery) return true;
      const haystack = `${card.name} ${card.setName ?? ''} ${card.setCode ?? ''}`.toLowerCase();
      return haystack.includes(normalizedQuery);
    });
  }, [collection, enabledGames, game, normalizedQuery]);

  const maxPrice = useMemo(() => {
    return items.reduce((max, card) => (card.price && card.price > max ? card.price : max), 0);
  }, [items]);

  const totalQuantity = useMemo(() => items.reduce((sum, card) => sum + card.quantity, 0), [items]);
  const totalValue = useMemo(
    () => items.reduce((sum, card) => sum + (card.price ?? 0) * card.quantity, 0),
    [items]
  );

  return {
    collection,
    items,
    isLoading: false,
    maxPrice,
    totalQuantity,
    totalValue
  };
}
