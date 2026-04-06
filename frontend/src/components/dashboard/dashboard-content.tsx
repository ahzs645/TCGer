"use client";

import { useEffect, useMemo } from "react";
import { ArrowUpRight, Coins, Library, Sparkles } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { getAppRoute } from "@/lib/app-routes";
import { GAME_LABELS } from "@/lib/utils";
import { useGameFilterStore } from "@/stores/game-filter";
import { useModuleStore } from "@/stores/preferences";
import { useCollectionsStore } from "@/stores/collections";
import { useAuthStore } from "@/stores/auth";
import type { CollectionCard, TcgCode } from "@/types/card";

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

function buildDashboardStats(
  cards: DashboardCard[],
  showPricing: boolean,
): DashboardStats {
  const stats: DashboardStats = {
    totalCopies: 0,
    totalValue: 0,
    byGame: {
      yugioh: { copies: 0, value: 0 },
      magic: { copies: 0, value: 0 },
      pokemon: { copies: 0, value: 0 },
    },
    recentActivity: [],
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
    const key = `${card.binderId ?? "global"}:${card.cardId}`;
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

export function DashboardContent() {
  const pathname = usePathname();
  const selectedGame = useGameFilterStore((state) => state.selectedGame);
  const { enabledGames, showPricing } = useModuleStore((state) => ({
    enabledGames: state.enabledGames,
    showPricing: state.showPricing,
  }));
  const { collections, fetchCollections, isLoading, hasFetched } =
    useCollectionsStore((state) => ({
      collections: state.collections,
      fetchCollections: state.fetchCollections,
      isLoading: state.isLoading,
      hasFetched: state.hasFetched,
    }));
  const { token, isAuthenticated } = useAuthStore();

  const noGamesEnabled =
    !enabledGames.yugioh && !enabledGames.magic && !enabledGames.pokemon;
  const selectedGameDisabled =
    selectedGame !== "all" &&
    !enabledGames[selectedGame as keyof typeof enabledGames];

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
          updatedAt: binder.updatedAt,
        })),
      ),
    [collections],
  );

  const filteredCards = useMemo(() => {
    return aggregatedCards.filter((card) => {
      if (!enabledGames[card.tcg as keyof typeof enabledGames]) return false;
      if (selectedGame !== "all" && card.tcg !== selectedGame) return false;
      return true;
    });
  }, [aggregatedCards, enabledGames, selectedGame]);

  const stats = useMemo(
    () => buildDashboardStats(filteredCards, showPricing),
    [filteredCards, showPricing],
  );
  const loading = isAuthenticated && !hasFetched;
  const hasNoCards = !loading && stats.totalCopies === 0;

  if (loading) {
    return (
      <div
        className="grid grid-cols-2 gap-3 md:gap-6 md:grid-cols-2 xl:grid-cols-4"
        data-oid="s0qun_z"
      >
        {Array.from({ length: 4 }).map((_, idx) => (
          <Card key={idx} data-oid="hjq2h:n">
            <CardHeader className="p-3 md:p-6" data-oid="7n5qcgw">
              <Skeleton className="h-4 w-20 md:w-32" data-oid="z.qhh-b" />
              <Skeleton
                className="h-6 md:h-8 w-16 md:w-24"
                data-oid="efr_ogm"
              />
            </CardHeader>
            <CardContent className="p-3 pt-0 md:p-6 md:pt-0" data-oid="_s7._qz">
              <Skeleton className="h-8 md:h-12 w-full" data-oid="fiam73:" />
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-6" data-oid="p0.l1lt">
      {noGamesEnabled && (
        <div
          className="rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive"
          data-oid="aebsc3q"
        >
          All modules are disabled. Enable at least one trading card game in
          account settings to view analytics.
        </div>
      )}

      {selectedGameDisabled && !noGamesEnabled && (
        <div
          className="rounded-lg border border-destructive/50 bg-destructive/10 p-4 text-sm text-destructive"
          data-oid="5sv8-:2"
        >
          {GAME_LABELS[selectedGame]} is disabled in your module preferences.
          Enable it from the account menu to bring back its analytics.
        </div>
      )}

      {hasNoCards && !noGamesEnabled ? (
        <Card data-oid="kfwfwwg">
          <CardHeader data-oid="-qmjorv">
            <CardTitle data-oid=":-yd9fk">Welcome to your dashboard</CardTitle>
            <CardDescription data-oid="2hq021j">
              Start by adding cards to a binder. Your collection analytics will
              appear here once cards are tracked.
            </CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <div
          className="grid grid-cols-2 gap-3 md:gap-6 md:grid-cols-2 xl:grid-cols-4"
          data-oid="g1sgkm_"
        >
          <StatCard
            title="Total Cards"
            value={stats.totalCopies.toLocaleString()}
            description="Across all tracked TCGs"
            icon={<Library className="h-5 w-5" data-oid=":yiulgw" />}
            data-oid="23ilwbn"
          />

          {showPricing ? (
            <StatCard
              title="Estimated Value"
              value={`$${stats.totalValue.toFixed(2)}`}
              description="Based on collection pricing"
              icon={<Coins className="h-5 w-5" data-oid="bg_ukgc" />}
              data-oid="lmka4i."
            />
          ) : null}
          <StatCard
            title="Active Games"
            value={
              Object.values(stats.byGame).filter((info) => info.copies > 0)
                .length
            }
            description="Games with cards in your library"
            icon={<Sparkles className="h-5 w-5" data-oid="nv1sv83" />}
            data-oid="4n71tpc"
          />

          <StatCard
            title="Recent Additions"
            value={`${stats.recentActivity.length} card${stats.recentActivity.length === 1 ? "" : "s"}`}
            description="Latest cards you've logged"
            icon={<ArrowUpRight className="h-5 w-5" data-oid="dj20-l6" />}
            data-oid="1bq2zrz"
          />
        </div>
      )}

      {!hasNoCards && (
        <GameBreakdown
          byGame={stats.byGame}
          totalCopies={stats.totalCopies}
          data-oid="dpq.rba"
        />
      )}

      {!hasNoCards && (
        <RecentActivity items={stats.recentActivity} data-oid="2rew8b1" />
      )}
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
    <Card data-oid="il2f8aq">
      <CardHeader
        className="flex flex-row items-center justify-between space-y-0 p-3 pb-1 md:p-6 md:pb-4"
        data-oid="8g-q629"
      >
        <CardTitle
          className="text-xs md:text-sm font-medium text-muted-foreground"
          data-oid="ohfv292"
        >
          {title}
        </CardTitle>
        <span className="text-muted-foreground" data-oid="brx0kmt">
          {icon}
        </span>
      </CardHeader>
      <CardContent className="p-3 pt-0 md:p-6 md:pt-0" data-oid="yueozv_">
        <div
          className="text-xl md:text-3xl font-semibold tracking-tight"
          data-oid="ojqdii0"
        >
          {value}
        </div>
        <p
          className="mt-1 md:mt-2 text-xs md:text-sm text-muted-foreground"
          data-oid="q73vo_b"
        >
          {description}
        </p>
      </CardContent>
    </Card>
  );
}

function GameBreakdown({
  byGame,
  totalCopies,
}: {
  byGame: Record<TcgCode, { copies: number; value: number }>;
  totalCopies: number;
}) {
  const total = totalCopies || 1;

  return (
    <Card data-oid="lzd3vso">
      <CardHeader data-oid="11lqgp4">
        <CardTitle data-oid="21c-75n">Card Distribution</CardTitle>
        <CardDescription data-oid="l_jnn:8">
          Your collection by trading card game.
        </CardDescription>
      </CardHeader>
      <CardContent data-oid="6hdte6l">
        <div className="grid gap-4 md:grid-cols-3" data-oid="o8nfv1r">
          {Object.entries(byGame).map(([game, info]) => {
            const percentage = Math.round((info.copies / total) * 100);
            return (
              <div
                key={game}
                className="space-y-2 rounded-lg border bg-card p-4"
                data-oid="tc8by55"
              >
                <div
                  className="flex items-center justify-between text-sm"
                  data-oid="dhdh532"
                >
                  <span className="font-medium" data-oid="sels9l:">
                    {GAME_LABELS[game as TcgCode]}
                  </span>
                  <span className="text-muted-foreground" data-oid="w2epbtk">
                    {info.copies}
                  </span>
                </div>
                <div className="h-2 rounded-full bg-muted" data-oid="g.-bdol">
                  <div
                    className="h-full rounded-full bg-primary"
                    style={{ width: `${percentage}%` }}
                    data-oid=".4cy61i"
                  />
                </div>
                <p className="text-xs text-muted-foreground" data-oid="8z80x5w">
                  {percentage}% of collection
                </p>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

function RecentActivity({
  items,
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
    <Card data-oid="k9fxn2m">
      <CardHeader data-oid="9wwl9ev">
        <CardTitle data-oid="n1gfrdt">Recent Activity</CardTitle>
        <CardDescription data-oid="p9q-pld">
          Latest updates across your binders.
        </CardDescription>
      </CardHeader>
      <CardContent data-oid=":ve3i25">
        <div className="space-y-4" data-oid="yn97if1">
          {items.length === 0 && (
            <p className="text-sm text-muted-foreground" data-oid="8rx7z29">
              No activity yet.
            </p>
          )}
          {items.map((item) => (
            <Link
              key={item.id}
              href={
                item.binderId
                  ? `${getAppRoute("/collections", pathname)}?binder=${encodeURIComponent(item.binderId)}`
                  : getAppRoute("/collections", pathname)
              }
              className="flex items-center justify-between gap-4 rounded-lg border bg-card p-4 transition hover:border-primary/50 hover:bg-muted/40"
              data-oid="uvihrii"
            >
              <div data-oid="v72i.i:">
                <p
                  className="text-sm font-semibold leading-none"
                  data-oid="q4sc83_"
                >
                  {item.name}
                </p>
                <p className="text-xs text-muted-foreground" data-oid="s8laehg">
                  {GAME_LABELS[item.tcg]}
                  {item.binderName ? ` • ${item.binderName}` : ""}
                  {item.quantity > 1 ? ` • ${item.quantity} copies` : ""}
                </p>
              </div>
              <time
                className="text-xs text-muted-foreground"
                data-oid="sb8ut6f"
              >
                {new Date(item.timestamp).toLocaleDateString(undefined, {
                  month: "short",
                  day: "numeric",
                })}
              </time>
            </Link>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
