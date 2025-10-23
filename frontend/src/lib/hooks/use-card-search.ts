'use client';

import { useQuery } from '@tanstack/react-query';

import { searchCardsApi } from '@/lib/api-client';
import type { TcgCode } from '@/types/card';

export function useCardSearch(query: string, tcg?: TcgCode | 'all') {
  return useQuery({
    queryKey: ['cards', { query, tcg }],
    queryFn: () => searchCardsApi({ query, tcg }),
    enabled: query.trim().length > 0,
    staleTime: 1000 * 60 * 5
  });
}
