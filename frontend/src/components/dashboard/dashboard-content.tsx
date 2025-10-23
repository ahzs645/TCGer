'use client';

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ArrowUpRight, Coins, Library, Sparkles } from 'lucide-react';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { GAME_LABELS } from '@/lib/utils';
import { calculateDashboardStats, searchCardsApi } from '@/lib/api-client';
import { useGameFilterStore } from '@/stores/game-filter';
import { useModuleStore } from '@/stores/preferences';
import type { Card as CardType } from '@/types/card';

const DEFAULT_DASHBOARD_QUERY = 'dragon';

export function DashboardContent() {
  const selectedGame = useGameFilterStore((state) => state.selectedGame);
  const enabledGames = useModuleStore((state) => state.enabledGames);
  const noGamesEnabled = !enabledGames.yugioh && !enabledGames.magic && !enabledGames.pokemon;
  const { data, isLoading } = useQuery({
    queryKey: ['dashboard', { selectedGame }],
    queryFn: () => searchCardsApi({ query: DEFAULT_DASHBOARD_QUERY, tcg: selectedGame })
  });

  const cards = (data ?? []).filter((card) => enabledGames[card.tcg as keyof typeof enabledGames]);
  const selectedGameDisabled = selectedGame !== 'all' && !enabledGames[selectedGame as keyof typeof enabledGames];
  const stats = useMemo(() => calculateDashboardStats(cards), [cards]);

  if (isLoading) {
    return (
      <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, idx) => (
          <Card key={idx}>
            <CardHeader>
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-8 w-24" />
            </CardHeader>
            <CardContent>
              <Skeleton className="h-12 w-full" />
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

      <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-4">
        <StatCard
          title="Total Cards"
          value={stats.totalCards.toLocaleString()}
          description="Across all tracked TCGs"
          icon={<Library className="h-5 w-5" />}
        />
        <StatCard
          title="Estimated Value"
          value={`$${stats.totalValue.toFixed(2)}`}
          description="Based on latest price snapshots"
          icon={<Coins className="h-5 w-5" />}
        />
        <StatCard
          title="Active Games"
          value={Object.entries(stats.byGame).filter(([, info]) => info.count > 0).length}
          description="Games with cards in your library"
          icon={<Sparkles className="h-5 w-5" />}
        />
        <StatCard
          title="Recent Additions"
          value={`${Math.min(stats.recentActivity.length, 5)} cards`}
          description="Latest cards synced from adapters"
          icon={<ArrowUpRight className="h-5 w-5" />}
        />
      </div>

      <GameBreakdown cards={cards} />

      <RecentActivity items={stats.recentActivity} />
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
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-4">
        <CardTitle className="text-sm font-medium text-muted-foreground">{title}</CardTitle>
        <span className="text-muted-foreground">{icon}</span>
      </CardHeader>
      <CardContent>
        <div className="text-3xl font-semibold tracking-tight">{value}</div>
        <p className="mt-2 text-sm text-muted-foreground">{description}</p>
      </CardContent>
    </Card>
  );
}

function GameBreakdown({ cards }: { cards: CardType[] }) {
  const byGame = useMemo(() => {
    return cards.reduce(
      (acc, card) => {
        acc[card.tcg] = (acc[card.tcg] ?? 0) + 1;
        return acc;
      },
      { yugioh: 0, magic: 0, pokemon: 0 } as Record<'yugioh' | 'magic' | 'pokemon', number>
    );
  }, [cards]);

  const total = cards.length || 1;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Card Distribution</CardTitle>
        <CardDescription>Your collection by trading card game.</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid gap-4 md:grid-cols-3">
          {Object.entries(byGame).map(([game, count]) => {
            const percentage = Math.round((count / total) * 100);
            return (
              <div key={game} className="space-y-2 rounded-lg border bg-card p-4">
                <div className="flex items-center justify-between text-sm">
                  <span className="font-medium">{GAME_LABELS[game]}</span>
                  <span className="text-muted-foreground">{count}</span>
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
  items: Array<{ id: string; name: string; tcg: 'yugioh' | 'magic' | 'pokemon'; timestamp: string }>;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Recent Activity</CardTitle>
        <CardDescription>Latest cards ingested from external APIs.</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {items.length === 0 && <p className="text-sm text-muted-foreground">No activity yet.</p>}
          {items.map((item) => (
            <div key={item.id} className="flex items-center justify-between gap-4 rounded-lg border bg-card p-4">
              <div>
                <p className="text-sm font-semibold leading-none">{item.name}</p>
                <p className="text-xs text-muted-foreground">{GAME_LABELS[item.tcg]}</p>
              </div>
              <time className="text-xs text-muted-foreground">
                {new Date(item.timestamp).toLocaleDateString(undefined, {
                  month: 'short',
                  day: 'numeric'
                })}
              </time>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
