import type { CollectionCard, TcgCode } from "@/types/card";

export type DashboardCard = CollectionCard & {
  updatedAt?: string;
  binderName?: string;
};

export interface DashboardStats {
  totalCopies: number;
  totalValue: number;
  byGame: Record<string, { copies: number; value: number }>;
  recentActivity: Array<{
    id: string;
    name: string;
    tcg: TcgCode;
    quantity: number;
    binderName?: string;
    binderId?: string;
    timestamp: string;
  }>;
}

export function buildDashboardStats(
  cards: DashboardCard[],
  showPricing: boolean,
): DashboardStats {
  const stats: DashboardStats = {
    totalCopies: 0,
    totalValue: 0,
    byGame: {},
    recentActivity: [],
  };

  cards.forEach((card) => {
    const copies = Math.max(card.quantity ?? 0, 0);
    const breakdown = (stats.byGame[card.tcg] ??= { copies: 0, value: 0 });
    breakdown.copies += copies;
    stats.totalCopies += copies;

    if (showPricing) {
      const value = (card.price ?? 0) * copies;
      breakdown.value += value;
      stats.totalValue += value;
    }
  });

  const sorted = [...cards].sort((a, b) => {
    const getTime = (value?: string) => (value ? new Date(value).getTime() : 0);
    return getTime(b.updatedAt) - getTime(a.updatedAt);
  });

  const seen = new Set<string>();
  for (const card of sorted) {
    const key = `${card.binderId ?? "global"}:${card.tcg}:${card.cardId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    stats.recentActivity.push({
      id: key,
      name: card.name,
      tcg: card.tcg,
      quantity: Math.max(card.quantity ?? 0, 0),
      binderName: card.binderName,
      binderId: card.binderId,
      timestamp: card.updatedAt ?? new Date().toISOString(),
    });
    if (stats.recentActivity.length >= 5) break;
  }

  stats.totalValue = Number(stats.totalValue.toFixed(2));

  return stats;
}
