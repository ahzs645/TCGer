'use client';

import { useMemo } from 'react';

import { calculateDashboardStats } from '@/lib/api-client';
import { useGameFilterStore } from '@/stores/game-filter';
import type { Card } from '@/types/card';

export function useDashboard(cards: Card[]) {
  const selectedGame = useGameFilterStore((state) => state.selectedGame);

  const filteredCards = useMemo(() => {
    if (selectedGame === 'all') {
      return cards;
    }
    return cards.filter((card) => card.tcg === selectedGame);
  }, [cards, selectedGame]);

  const stats = useMemo(() => calculateDashboardStats(filteredCards), [filteredCards]);

  return { stats, filteredCards };
}
