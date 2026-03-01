'use client';

import { useEffect, useMemo } from 'react';
import { ArrowUpRight, Coins, Library, Sparkles } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { getAppRoute } from '@/lib/app-routes';
import { GAME_LABELS } from '@/lib/utils';
import { useGameFilterStore } from '@/stores/game-filter';
import { useModuleStore } from '@/stores/preferences';
import { useCollectionsStore } from '@/stores/collections';
import { useAuthStore } from '@/stores/auth';
import type { CollectionCard, TcgCode } from '@/types/card';

type DashboardCard = CollectionCard & {
  updatedAt?: string;
  binderName?: string;
};

interface DashboardStats {
  totalCopies: number;
  totalValue: number;
  byGame: Record<TcgCode, { copies: number; value: number }>;
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

function buildDashboardStats(cards: DashboardCard[], showPricing: boolean): DashboardStats {
  const stats: DashboardStats = {
    totalCopies: 0,
    totalValue: 0,
    byGame: {
      yugioh: { copies: 0, value: 0 },
      magic: { copies: 0, value: 0 },
      pokemon: { copies: 0, value: 0 }
    },
    recentActivity: []
  };

  cards.forEach((card) => {
    const copies = Math.max(card.quantity ?? 0, 0);
    const breakdown = stats.byGame[card.tcg];
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
    const key = `${card.binderId ?? 'global'}:${card.cardId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    stats.recentActivity.push({
      id: key,
      name: card.name,
      tcg: card.tcg,
      quantity: Math.max(card.quantity ?? 0, 0),
      binderName: card.binderName,
      binderId: card.binderId,
      timestamp: card.updatedAt ?? new Date().toISOString()
    });
    if (stats.recentActivity.length >= 5) break;
  }

  stats.totalValue = Number(stats.totalValue.toFixed(2));

  return stats;
}

export function DashboardContent() {
  const pathname = usePathname();
  const selectedGame = useGameFilterStore((state) => state.selectedGame);
  const { enabledGames, showPricing } = useModuleStore((state) => ({
    enabledGames: state.enabledGames,
    showPricing: state.showPricing
  }));
  const { collections, fetchCollections, isLoading, hasFetched } = useCollectionsStore((state) => ({
    collections: state.collections,
    fetchCollections: state.fetchCollections,
    isLoading: state.isLoading,
    hasFetched: state.hasFetched
  }));
  const { token, isAuthenticated } = useAuthStore();

  const noGamesEnabled = !enabledGames.yugioh && !enabledGames.magic && !enabledGames.pokemon;
  const selectedGameDisabled = selectedGame !== 'all' && !enabledGames[selectedGame as keyof typeof enabledGames];

  useEffect(() => {
    if (!isAuthenticated || !token) {
      return;
    }
    if (!hasFetched && !isLoading) {
      void fetchCollections(token);
    }
  }, [fetchCollections, hasFetched, isAuthenticated, isLoading, token]);

  const aggregatedCards = useMemo<DashboardCard[]>(
    () =>
      collections.flatMap((binder) =>
        binder.cards.map((card) => ({
          ...card,
          binderId: card.binderId ?? binder.id,
          binderName: card.binderName ?? binder.name,
          binderColorHex: card.binderColorHex ?? binder.colorHex,
          updatedAt: binder.updatedAt
        }))
      ),
    [collections]
  );

  const filteredCards = useMemo(() => {
    return aggregatedCards.filter((card) => {
      if (!enabledGames[card.tcg as keyof typeof enabledGames]) return false;
      if (selectedGame !== 'all' && card.tcg !== selectedGame) return false;
      return true;
    });
  }, [aggregatedCards, enabledGames, selectedGame]);

  const stats = useMemo(() => buildDashboardStats(filteredCards, showPricing), [filteredCards, showPricing]);
  const loading = isAuthenticated && !hasFetched;
  const hasNoCards = !loading && stats.totalCopies === 0;

  if (loading) {
    return (
      <div className="grid grid-cols-2 gap-3 md:gap-6 md:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, idx) => (
          <Card key={idx}>
            <CardHeader className="p-3 md:p-6">
              <Skeleton className="h-4 w-20 md:w-32" />
              <Skeleton className="h-6 md:h-8 w-16 md:w-24" />
            </CardHeader>
            <CardContent className="p-3 pt-0 md:p-6 md:pt-0">
              <Skeleton className="h-8 md:h-12 w-full" />
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {noGamesEnabled && (
        <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
          All modules are disabled. Enable at least one trading card game in account settings to view analytics.
        </div>
      )}

      {selectedGameDisabled && !noGamesEnabled && (
        <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-4 text-sm text-destructive">
          {GAME_LABELS[selectedGame]} is disabled in your module preferences. Enable it from the account menu to bring back
          its analytics.
        </div>
      )}

      {hasNoCards && !noGamesEnabled ? (
        <Card>
          <CardHeader>
            <CardTitle>Welcome to your dashboard</CardTitle>
            <CardDescription>
              Start by adding cards to a binder. Your collection analytics will appear here once cards are tracked.
            </CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <div className="grid grid-cols-2 gap-3 md:gap-6 md:grid-cols-2 xl:grid-cols-4">
          <StatCard
            title="Total Cards"
            value={stats.totalCopies.toLocaleString()}
            description="Across all tracked TCGs"
            icon={<Library className="h-5 w-5" />}
          />
          {showPricing ? (
            <StatCard
              title="Estimated Value"
              value={`$${stats.totalValue.toFixed(2)}`}
              description="Based on collection pricing"
              icon={<Coins className="h-5 w-5" />}
            />
          ) : null}
          <StatCard
            title="Active Games"
            value={Object.values(stats.byGame).filter((info) => info.copies > 0).length}
            description="Games with cards in your library"
            icon={<Sparkles className="h-5 w-5" />}
          />
          <StatCard
            title="Recent Additions"
            value={`${stats.recentActivity.length} card${stats.recentActivity.length === 1 ? '' : 's'}`}
            description="Latest cards you've logged"
            icon={<ArrowUpRight className="h-5 w-5" />}
          />
        </div>
      )}

      {!hasNoCards && <GameBreakdown byGame={stats.byGame} totalCopies={stats.totalCopies} />}

      {!hasNoCards && <RecentActivity items={stats.recentActivity} />}
    </div>
  );
}

interface StatCardProps {
  title: string;
  value: string | number;
  description: string;
  icon: React.ReactNode;
}

function StatCard({ title, value, description, icon }: StatCardProps) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 p-3 pb-1 md:p-6 md:pb-4">
        <CardTitle className="text-xs md:text-sm font-medium text-muted-foreground">{title}</CardTitle>
        <span className="text-muted-foreground">{icon}</span>
      </CardHeader>
      <CardContent className="p-3 pt-0 md:p-6 md:pt-0">
        <div className="text-xl md:text-3xl font-semibold tracking-tight">{value}</div>
        <p className="mt-1 md:mt-2 text-xs md:text-sm text-muted-foreground">{description}</p>
      </CardContent>
    </Card>
  );
}

function GameBreakdown({
  byGame,
  totalCopies
}: {
  byGame: Record<TcgCode, { copies: number; value: number }>;
  totalCopies: number;
}) {
  const total = totalCopies || 1;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Card Distribution</CardTitle>
        <CardDescription>Your collection by trading card game.</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid gap-4 md:grid-cols-3">
          {Object.entries(byGame).map(([game, info]) => {
            const percentage = Math.round((info.copies / total) * 100);
            return (
              <div key={game} className="space-y-2 rounded-lg border bg-card p-4">
                <div className="flex items-center justify-between text-sm">
                  <span className="font-medium">{GAME_LABELS[game as TcgCode]}</span>
                  <span className="text-muted-foreground">{info.copies}</span>
                </div>
                <div className="h-2 rounded-full bg-muted">
                  <div className="h-full rounded-full bg-primary" style={{ width: `${percentage}%` }} />
                </div>
                <p className="text-xs text-muted-foreground">{percentage}% of collection</p>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

function RecentActivity({
  items
}: {
  items: Array<{
    id: string;
    name: string;
    tcg: TcgCode;
    quantity: number;
    binderName?: string;
    binderId?: string;
    timestamp: string;
  }>;
}) {
  const pathname = usePathname();
  return (
    <Card>
      <CardHeader>
        <CardTitle>Recent Activity</CardTitle>
        <CardDescription>Latest updates across your binders.</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {items.length === 0 && <p className="text-sm text-muted-foreground">No activity yet.</p>}
          {items.map((item) => (
            <Link
              key={item.id}
              href={item.binderId
                ? `${getAppRoute('/collections', pathname)}?binder=${encodeURIComponent(item.binderId)}`
                : getAppRoute('/collections', pathname)}
              className="flex items-center justify-between gap-4 rounded-lg border bg-card p-4 transition hover:border-primary/50 hover:bg-muted/40"
            >
              <div>
                <p className="text-sm font-semibold leading-none">{item.name}</p>
                <p className="text-xs text-muted-foreground">
                  {GAME_LABELS[item.tcg]}
                  {item.binderName ? ` • ${item.binderName}` : ''}
                  {item.quantity > 1 ? ` • ${item.quantity} copies` : ''}
                </p>
              </div>
              <time className="text-xs text-muted-foreground">
                {new Date(item.timestamp).toLocaleDateString(undefined, {
                  month: 'short',
                  day: 'numeric'
                })}
              </time>
            </Link>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
