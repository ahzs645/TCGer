import { DEFAULT_API_BASE_URL } from '@/lib/utils';
import type { Card, CardPrintsResponse, SearchCardsResponse, TcgCode } from '@/types/card';

const API_BASE_URL = DEFAULT_API_BASE_URL.replace(/\/$/, '');

async function handleResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const errorPayload = await response.json().catch(() => ({}));
    const message = errorPayload?.message ?? response.statusText;
    throw new Error(message || 'API request failed');
  }
  return response.json() as Promise<T>;
}

export async function searchCardsApi(params: { query: string; tcg?: TcgCode | 'all' }): Promise<Card[]> {
  const { query, tcg } = params;
  const usp = new URLSearchParams({ query });
  if (tcg && tcg !== 'all') {
    usp.set('tcg', tcg);
  }
  const res = await fetch(`${API_BASE_URL}/cards/search?${usp.toString()}`, {
    next: { revalidate: 30 }
  });

  const data = await handleResponse<SearchCardsResponse>(res);
  return data.cards ?? [];
}

export async function fetchCardPrintsApi(params: { tcg: TcgCode; cardId: string }): Promise<CardPrintsResponse> {
  const { tcg, cardId } = params;
  const res = await fetch(`${API_BASE_URL}/cards/${tcg}/${cardId}/prints`, {
    next: { revalidate: 30 }
  });
  return handleResponse<CardPrintsResponse>(res);
}

export interface DashboardStats {
  totalCards: number;
  totalValue: number;
  byGame: Record<TcgCode, { count: number; estimatedValue: number }>;
  recentActivity: Array<{ id: string; name: string; tcg: TcgCode; timestamp: string }>;
}

export function calculateDashboardStats(cards: Card[]): DashboardStats {
  const initial: DashboardStats = {
    totalCards: cards.length,
    totalValue: 0,
    byGame: {
      yugioh: { count: 0, estimatedValue: 0 },
      magic: { count: 0, estimatedValue: 0 },
      pokemon: { count: 0, estimatedValue: 0 }
    },
    recentActivity: []
  };

  return cards.reduce<DashboardStats>((acc, card, index) => {
    const price = Number((card.attributes?.price ?? 0) as number) || Math.random() * 5 + 1;
    acc.totalValue += price;
    acc.byGame[card.tcg].count += 1;
    acc.byGame[card.tcg].estimatedValue += price;
    if (index < 5) {
      acc.recentActivity.push({
        id: card.id,
        name: card.name,
        tcg: card.tcg,
        timestamp: new Date(Date.now() - index * 86400000).toISOString()
      });
    }
    return acc;
  }, initial);
}
