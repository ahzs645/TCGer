"use client";

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  BarChart3,
  TrendingUp,
  TrendingDown,
  DollarSign,
  Layers,
  Calendar,
} from "lucide-react";

import { AppShell } from "@/components/layout/app-shell";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  getCollectionValueHistory,
  getCollectionValueBreakdown,
  getCollectionDistribution,
} from "@/lib/api/analytics";
import { getPriceMovers } from "@/lib/api/pricing";
import { GAME_LABELS, type SupportedGame } from "@/lib/utils";
import { useAuthStore } from "@/stores/auth";
import { useModuleStore } from "@/stores/preferences";
import { useGameFilterStore } from "@/stores/game-filter";

/* ------------------------------------------------------------------ */
/*  Constants                                                           */
/* ------------------------------------------------------------------ */

const PERIODS = [
  { label: "7D", value: "7d", days: 7 },
  { label: "30D", value: "30d", days: 30 },
  { label: "90D", value: "90d", days: 90 },
  { label: "1Y", value: "1y", days: 365 },
] as const;

type PeriodValue = (typeof PERIODS)[number]["value"];

const TCG_BAR_COLORS: Record<string, string> = {
  yugioh: "#ef4444",
  magic: "#8b5cf6",
  pokemon: "#f59e0b",
};

function tcgLabel(tcg: string): string {
  return GAME_LABELS[tcg as SupportedGame] ?? tcg;
}

function currency(value: number): string {
  return `$${value.toFixed(2)}`;
}

/* ------------------------------------------------------------------ */
/*  Component                                                           */
/* ------------------------------------------------------------------ */

export default function AnalyticsPage() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const [period, setPeriod] = useState<PeriodValue>("30d");
  const periodDays =
    PERIODS.find((p) => p.value === period)?.days ?? 30;

  const { token, isAuthenticated } = useAuthStore();
  const selectedGame = useGameFilterStore((state) => state.selectedGame);
  const { enabledGames, showPricing } = useModuleStore((state) => ({
    enabledGames: state.enabledGames,
    showPricing: state.showPricing,
  }));

  const noGamesEnabled =
    !enabledGames.yugioh && !enabledGames.magic && !enabledGames.pokemon;

  const ready = mounted && isAuthenticated && !!token;

  const historyQuery = useQuery({
    queryKey: ["analytics", "value", period],
    queryFn: () => getCollectionValueHistory(token!, period),
    enabled: ready && showPricing,
    staleTime: 1000 * 60 * 5,
  });
  const breakdownQuery = useQuery({
    queryKey: ["analytics", "breakdown"],
    queryFn: () => getCollectionValueBreakdown(token!),
    enabled: ready,
    staleTime: 1000 * 60 * 5,
  });
  const rarityQuery = useQuery({
    queryKey: ["analytics", "distribution", "rarity"],
    queryFn: () => getCollectionDistribution(token!, "rarity"),
    enabled: ready,
    staleTime: 1000 * 60 * 5,
  });
  const moversQuery = useQuery({
    queryKey: ["analytics", "movers", selectedGame, periodDays],
    queryFn: () =>
      getPriceMovers(
        token!,
        selectedGame === "all" ? undefined : selectedGame,
        periodDays,
      ),
    enabled: ready && showPricing,
    staleTime: 1000 * 60 * 5,
  });

  /* ---------------- gate states ---------------- */

  if (!mounted) {
    return (
      <AppShell>
        <AnalyticsSkeleton />
      </AppShell>
    );
  }

  if (!isAuthenticated) {
    return (
      <AppShell>
        <PageHeader />
        <Card>
          <CardHeader>
            <CardTitle>Sign in required</CardTitle>
            <CardDescription>
              Sign in to view analytics for your collection.
            </CardDescription>
          </CardHeader>
        </Card>
      </AppShell>
    );
  }

  if (noGamesEnabled) {
    return (
      <AppShell>
        <PageHeader />
        <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
          All modules are disabled. Enable at least one trading card game in
          account settings to view analytics.
        </div>
      </AppShell>
    );
  }

  const isLoading =
    breakdownQuery.isLoading ||
    rarityQuery.isLoading ||
    (showPricing && historyQuery.isLoading);

  if (isLoading) {
    return (
      <AppShell>
        <PageHeader />
        <AnalyticsSkeleton />
      </AppShell>
    );
  }

  const loadError =
    breakdownQuery.error ?? rarityQuery.error ?? historyQuery.error;
  if (loadError) {
    return (
      <AppShell>
        <PageHeader />
        <Card>
          <CardHeader>
            <CardTitle>Couldn&apos;t load analytics</CardTitle>
            <CardDescription>
              {(loadError as Error).message ||
                "Something went wrong while fetching your analytics."}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                void breakdownQuery.refetch();
                void rarityQuery.refetch();
                void historyQuery.refetch();
                void moversQuery.refetch();
              }}
            >
              Try again
            </Button>
          </CardContent>
        </Card>
      </AppShell>
    );
  }

  /* ---------------- derive data ---------------- */

  const breakdown = breakdownQuery.data;
  const history = historyQuery.data;
  const rarity = rarityQuery.data;
  const movers = moversQuery.data;

  const visibleTcg = (breakdown?.byTcg ?? []).filter((entry) => {
    if (enabledGames[entry.tcg as keyof typeof enabledGames] === false)
      return false;
    if (selectedGame !== "all" && entry.tcg !== selectedGame) return false;
    return true;
  });

  const totalValue = visibleTcg.reduce((s, g) => s + g.value, 0);
  const totalCards = visibleTcg.reduce((s, g) => s + g.cardCount, 0);

  const hasNoCards = totalCards === 0;
  if (hasNoCards) {
    return (
      <AppShell>
        <PageHeader />
        <Card>
          <CardHeader>
            <CardTitle>No cards to analyze yet</CardTitle>
            <CardDescription>
              Add cards to a binder and your value trends, price movers, and
              distribution breakdowns will appear here.
            </CardDescription>
          </CardHeader>
        </Card>
      </AppShell>
    );
  }

  const maxBarValue = Math.max(1, ...(history?.history ?? []).map((m) => m.value));

  const gainers = (movers?.gainers ?? []).filter(
    (c) => enabledGames[c.tcg as keyof typeof enabledGames] !== false,
  );
  const losers = (movers?.losers ?? []).filter(
    (c) => enabledGames[c.tcg as keyof typeof enabledGames] !== false,
  );

  return (
    <AppShell>
      <div className="space-y-6">
        <PageHeader />

        {/* Summary stats */}
        <div className="grid grid-cols-2 gap-3 md:gap-6 xl:grid-cols-4">
          <StatCard
            title="Total Cards"
            value={totalCards.toLocaleString()}
            icon={<Layers className="h-5 w-5" />}
            sub={
              selectedGame === "all"
                ? "Across all games"
                : tcgLabel(selectedGame)
            }
          />
          {showPricing && (
            <StatCard
              title="Total Value"
              value={currency(totalValue)}
              icon={<DollarSign className="h-5 w-5" />}
              sub="Estimated collection value"
            />
          )}
          {showPricing && history && selectedGame === "all" && (
            <StatCard
              title={`${period.toUpperCase()} Change`}
              value={`${history.changePercent >= 0 ? "+" : ""}${history.changePercent.toFixed(1)}%`}
              icon={
                history.changePercent >= 0 ? (
                  <TrendingUp className="h-5 w-5" />
                ) : (
                  <TrendingDown className="h-5 w-5" />
                )
              }
              sub={`Now ${currency(history.currentValue)}`}
              positive={history.changePercent >= 0}
              negative={history.changePercent < 0}
            />
          )}
          {showPricing && (
            <StatCard
              title="Avg Card Value"
              value={currency(totalCards > 0 ? totalValue / totalCards : 0)}
              icon={<BarChart3 className="h-5 w-5" />}
              sub="Per card average"
            />
          )}
        </div>

        {!showPricing && (
          <div className="rounded-lg border bg-muted/40 p-4 text-sm text-muted-foreground">
            Pricing is hidden in your preferences, so value trends and price
            movers are not shown. Enable pricing from the account menu to see
            them.
          </div>
        )}

        {/* Value over time chart */}
        {showPricing && (
          <Card>
            <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <Calendar className="h-5 w-5" />
                  Collection Value Over Time
                </CardTitle>
                <CardDescription>
                  Estimated total value across the selected period.
                </CardDescription>
              </div>
              <div className="flex shrink-0 gap-1">
                {PERIODS.map((p) => (
                  <Button
                    key={p.value}
                    size="sm"
                    variant={period === p.value ? "default" : "ghost"}
                    className="h-7 px-2 text-xs"
                    onClick={() => setPeriod(p.value)}
                  >
                    {p.label}
                  </Button>
                ))}
              </div>
            </CardHeader>
            <CardContent>
              {history && history.history.length > 0 ? (
                <div
                  className="flex items-end gap-1.5 h-48"
                  role="img"
                  aria-label={`Collection value over the selected period, currently ${currency(history.currentValue)}`}
                >
                  {history.history.map((m) => (
                    <div
                      key={m.date}
                      className="flex flex-1 flex-col items-center gap-1"
                      title={`${new Date(m.date).toLocaleDateString()}: ${currency(m.value)}`}
                    >
                      <div
                        className="w-full rounded-t bg-primary/80 transition-all"
                        style={{
                          height: `${Math.max(2, (m.value / maxBarValue) * 100)}%`,
                        }}
                      />
                    </div>
                  ))}
                </div>
              ) : (
                <p className="py-8 text-center text-sm text-muted-foreground">
                  Not enough history yet to chart value over time.
                </p>
              )}
            </CardContent>
          </Card>
        )}

        {/* Movers */}
        {showPricing && (
          <div className="grid gap-6 lg:grid-cols-2">
            <MoverCard
              title="Top Gainers"
              period={periodDays}
              icon={<TrendingUp className="h-5 w-5 text-green-500" />}
              cards={gainers}
              positive
            />
            <MoverCard
              title="Top Losers"
              period={periodDays}
              icon={<TrendingDown className="h-5 w-5 text-red-500" />}
              cards={losers}
              positive={false}
            />
          </div>
        )}

        <div className="grid gap-6 lg:grid-cols-2">
          {/* Value by game */}
          {showPricing && (
            <Card>
              <CardHeader>
                <CardTitle>Value by Game</CardTitle>
                <CardDescription>
                  How your collection value is distributed across TCGs.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  {visibleTcg.map((g) => {
                    const pct =
                      totalValue > 0
                        ? Math.round((g.value / totalValue) * 100)
                        : 0;
                    return (
                      <div key={g.tcg} className="space-y-2">
                        <div className="flex items-center justify-between text-sm">
                          <span className="font-medium">{tcgLabel(g.tcg)}</span>
                          <span className="text-muted-foreground">
                            {currency(g.value)} ({pct}%)
                          </span>
                        </div>
                        <div className="h-3 rounded-full bg-muted">
                          <div
                            className="h-full rounded-full"
                            style={{
                              width: `${pct}%`,
                              backgroundColor:
                                TCG_BAR_COLORS[g.tcg] ?? "hsl(var(--primary))",
                            }}
                          />
                        </div>
                        <p className="text-xs text-muted-foreground">
                          {g.cardCount} cards
                        </p>
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Rarity distribution */}
          <Card>
            <CardHeader>
              <CardTitle>Rarity Distribution</CardTitle>
              <CardDescription>
                Breakdown of your collection by rarity.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {rarity && rarity.entries.length > 0 ? (
                <div className="space-y-4">
                  {rarity.entries.map((r) => (
                    <div key={r.label} className="space-y-2">
                      <div className="flex items-center justify-between text-sm">
                        <span className="font-medium capitalize">
                          {r.label || "Unknown"}
                        </span>
                        <span className="text-muted-foreground">
                          {r.count} cards ({Math.round(r.percentage)}%)
                        </span>
                      </div>
                      <div className="h-3 rounded-full bg-muted">
                        <div
                          className="h-full rounded-full bg-primary/70"
                          style={{ width: `${Math.round(r.percentage)}%` }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="py-8 text-center text-sm text-muted-foreground">
                  No rarity data available.
                </p>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </AppShell>
  );
}

/* ------------------------------------------------------------------ */
/*  Sub-components                                                      */
/* ------------------------------------------------------------------ */

function PageHeader() {
  return (
    <div>
      <h1 className="text-3xl font-heading font-semibold">Analytics</h1>
      <p className="text-sm text-muted-foreground">
        Collection value trends, price movers, and distribution breakdowns.
      </p>
    </div>
  );
}

function MoverCard({
  title,
  period,
  icon,
  cards,
  positive,
}: {
  title: string;
  period: number;
  icon: React.ReactNode;
  cards: Array<{
    externalId: string;
    tcg: string;
    name: string;
    percentChange: number;
    currentPrice: number;
  }>;
  positive: boolean;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          {icon}
          {title} ({period} days)
        </CardTitle>
      </CardHeader>
      <CardContent>
        {cards.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            No {positive ? "gainers" : "losers"} in this period.
          </p>
        ) : (
          <div className="space-y-3">
            {cards.slice(0, 5).map((c) => (
              <div
                key={`${c.tcg}:${c.externalId}`}
                className="flex items-center justify-between rounded-lg border p-3"
              >
                <div>
                  <p className="text-sm font-medium">{c.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {tcgLabel(c.tcg)}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-sm font-semibold">
                    {currency(c.currentPrice)}
                  </p>
                  <p
                    className={`text-xs ${positive ? "text-green-500" : "text-red-500"}`}
                  >
                    {c.percentChange >= 0 ? "+" : ""}
                    {c.percentChange.toFixed(1)}%
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function StatCard({
  title,
  value,
  icon,
  sub,
  positive,
  negative,
}: {
  title: string;
  value: string | number;
  icon: React.ReactNode;
  sub: string;
  positive?: boolean;
  negative?: boolean;
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 p-3 pb-1 md:p-6 md:pb-4">
        <CardTitle className="text-xs md:text-sm font-medium text-muted-foreground">
          {title}
        </CardTitle>
        <span className="text-muted-foreground">{icon}</span>
      </CardHeader>
      <CardContent className="p-3 pt-0 md:p-6 md:pt-0">
        <div
          className={`text-xl md:text-3xl font-semibold tracking-tight ${
            positive ? "text-green-500" : negative ? "text-red-500" : ""
          }`}
        >
          {value}
        </div>
        <p className="mt-1 md:mt-2 text-xs md:text-sm text-muted-foreground">
          {sub}
        </p>
      </CardContent>
    </Card>
  );
}

function AnalyticsSkeleton() {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 md:gap-6 xl:grid-cols-4">
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
      <Skeleton className="h-56 w-full" />
      <div className="grid gap-6 lg:grid-cols-2">
        <Skeleton className="h-64 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    </div>
  );
}
