import { useMemo } from 'react';

import type { Collection as CollectionEntity } from '@/lib/api/collections';
import { useCollectionsStore } from '@/stores/collections';
import type { CollectionCard, TcgCode } from '@/types/card';

export const ALL_COLLECTION_ID = '__all__';

interface UseCollectionOptions {
  collectionId: string;
  query: string;
  game: TcgCode | 'all';
  enabledGames: Record<'yugioh' | 'magic' | 'pokemon', boolean>;
}

export function useCollectionData({ collectionId, query, game, enabledGames }: UseCollectionOptions) {
  const collections = useCollectionsStore((state) => state.collections);
  const isAllCollections = collectionId === ALL_COLLECTION_ID;
  const aggregateCollection = useMemo<CollectionEntity | undefined>(() => {
    if (!collections.length) {
      return undefined;
    }

    const cards = collections.flatMap((entry) =>
      entry.cards.map((card) => ({
        ...card,
        binderId: card.binderId ?? entry.id,
        binderName: card.binderName ?? entry.name,
        binderColorHex: card.binderColorHex ?? entry.colorHex
      }))
    );

    const updatedTimestamps = collections
      .map((entry) => new Date(entry.updatedAt).getTime())
      .filter((value) => Number.isFinite(value));
    const createdTimestamps = collections
      .map((entry) => new Date(entry.createdAt).getTime())
      .filter((value) => Number.isFinite(value));

    const latestUpdated = updatedTimestamps.length ? Math.max(...updatedTimestamps) : Date.now();
    const earliestCreated = createdTimestamps.length ? Math.min(...createdTimestamps) : latestUpdated;

    return {
      id: ALL_COLLECTION_ID,
      name: 'All cards',
      description: 'Combined view of every binder.',
      cards,
      createdAt: new Date(earliestCreated).toISOString(),
      updatedAt: new Date(latestUpdated).toISOString()
    };
  }, [collections]);

  const collection = useMemo(() => {
    if (isAllCollections) {
      return aggregateCollection;
    }
    return collections.find((entry) => entry.id === collectionId) ?? (collections.length > 0 ? collections[0] : undefined);
  }, [aggregateCollection, collections, collectionId, isAllCollections]);
  const normalizedQuery = query.trim().toLowerCase();

  const items = useMemo<CollectionCard[]>(() => {
    if (!collection) {
      return [];
    }

    return collection.cards
      .filter((card) => {
        if (!enabledGames[card.tcg as keyof typeof enabledGames]) return false;
        if (game !== 'all' && card.tcg !== game) return false;
        if (!normalizedQuery) return true;
        const haystack = `${card.name} ${card.setName ?? ''} ${card.setCode ?? ''}`.toLowerCase();
        return haystack.includes(normalizedQuery);
      })
      .map((card) => {
        if (isAllCollections || card.binderId) {
          return card;
        }
        return {
          ...card,
          binderId: collection.id,
          binderName: collection.name,
          binderColorHex: collection.colorHex ?? card.binderColorHex
        };
      });
  }, [collection, enabledGames, game, isAllCollections, normalizedQuery]);

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
