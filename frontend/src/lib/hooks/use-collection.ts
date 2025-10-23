import { useMemo } from 'react';

import { useCardSearch } from '@/lib/hooks/use-card-search';
import type { CollectionCard, TcgCode } from '@/types/card';

interface UseCollectionOptions {
  query: string;
  game: TcgCode | 'all';
  enabledGames: Record<'yugioh' | 'magic' | 'pokemon', boolean>;
}

const CONDITIONS = ['Mint', 'Near Mint', 'Lightly Played', 'Played'] as const;

export function useCollectionData({ query, game, enabledGames }: UseCollectionOptions) {
  const { data, isLoading } = useCardSearch(query, game === 'all' ? undefined : game);

  const items = useMemo<CollectionCard[]>(() => {
    const source = (data ?? []).filter((card) => enabledGames[card.tcg]);
    return source.map((card, index) => {
      const quantity = (index % 4) + 1;
      const basePrice = resolvePrice(card);
      const acquisitionPrice = Number((basePrice * (0.8 + (index % 3) * 0.05)).toFixed(2));
      const history = new Array(6).fill(0).map((_, idx) => Number((basePrice * (0.9 + idx * 0.02)).toFixed(2)));

      return {
        ...card,
        quantity,
        condition: CONDITIONS[index % CONDITIONS.length],
        price: basePrice,
        acquisitionPrice,
        priceHistory: history
      } satisfies CollectionCard;
    });
  }, [data, enabledGames]);

  const maxPrice = useMemo(() => {
    return items.reduce((max, card) => (card.price && card.price > max ? card.price : max), 0);
  }, [items]);

  const totalQuantity = useMemo(() => items.reduce((sum, card) => sum + card.quantity, 0), [items]);
  const totalValue = useMemo(
    () => items.reduce((sum, card) => sum + (card.price ?? 0) * card.quantity, 0),
    [items]
  );

  return {
    items,
    isLoading,
    maxPrice,
    totalQuantity,
    totalValue
  };
}

function resolvePrice(card: { price?: number; attributes?: Record<string, unknown> }): number {
  if (typeof card.price === 'number' && !Number.isNaN(card.price)) {
    return Number(card.price.toFixed(2));
  }

  const attr = card.attributes ?? {};
  const possibleKeys = ['price_usd', 'usd', 'price', 'marketPrice'];
  for (const key of possibleKeys) {
    const value = attr[key];
    if (typeof value === 'number') {
      return Number(value.toFixed(2));
    }
    if (typeof value === 'string') {
      const parsed = Number.parseFloat(value);
      if (!Number.isNaN(parsed)) {
        return Number(parsed.toFixed(2));
      }
    }
  }

  // Fallback pseudo-random price
  return Number((Math.random() * 25 + 2).toFixed(2));
}
