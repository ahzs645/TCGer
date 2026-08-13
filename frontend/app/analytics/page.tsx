"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  BarChart3,
  TrendingUp,
  TrendingDown,
  DollarSign,
  Layers,
  Calendar,
  Copy,
  MapPin,
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
  ANALYTICS_PERIODS,
  getCollectionValueHistory,
  getCollectionValueBreakdown,
  getCollectionDistribution,
  getCollectionDuplicates,
  type AnalyticsPeriod,
} from "@/lib/api/analytics";
import { getPriceMovers } from "@/lib/api/pricing";
import { GAME_LABELS, type SupportedGame } from "@/lib/utils";
import { useAuthStore } from "@/stores/auth";
import { useModuleStore } from "@/stores/preferences";
import { useGameFilterStore } from "@/stores/game-filter";

import { useShallow } from "zustand/react/shallow";
/* ------------------------------------------------------------------ */
/*  Constants                                                           */
/* ------------------------------------------------------------------ */

const TCG_BAR_COLORS: Record<string, string> = {
  yugioh: "#ef4444",
  magic: "#8b5cf6",
  pokemon: "#f59e0b",
  onepiece: "#0ea5e9",
  lorcana: "#a855f7",
  dragonball: "#f97316",
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

  const [period, setPeriod] = useState<AnalyticsPeriod>("30d");
  const [keepCount, setKeepCount] = useState(1);
  const periodDays =
    ANALYTICS_PERIODS.find((p) => p.value === period)?.days ?? 30;

  const { token, isAuthenticated } = useAuthStore();
  const selectedGame = useGameFilterStore((state) => state.selectedGame);
  const { enabledGames, showPricing } = useModuleStore(useShallow((state) => ({
    enabledGames: state.enabledGames,
    showPricing: state.showPricing,
  })));

  const noGamesEnabled = Object.values(enabledGames).every(
    (enabled) => !enabled,
  );

  const ready = mounted && isAuthenticated && !!token;
  const selectedTcg = selectedGame === "all" ? undefined : selectedGame;

  const historyQuery = useQuery({
    queryKey: ["analytics", "value", period, selectedGame],
    queryFn: () => getCollectionValueHistory(token!, period, selectedTcg),
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
    queryKey: ["analytics", "distribution", "rarity", selectedGame],
    queryFn: () => getCollectionDistribution(token!, "rarity", selectedTcg),
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
  const duplicatesQuery = useQuery({
    queryKey: ["analytics", "duplicates", keepCount, selectedGame],
    queryFn: () => getCollectionDuplicates(token!, keepCount, selectedTcg),
    enabled: ready,
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
            <CardTitle asChild><h2>Sign in required</h2></CardTitle>
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
    duplicatesQuery.isLoading ||
    (showPricing && historyQuery.isLoading);

  if (isLoading) {
    return (
      <AppShell>
        <PageHeader />
        <div role="status" aria-label="Loading analytics" aria-busy="true">
          <AnalyticsSkeleton />
        </div>
      </AppShell>
    );
  }

  const loadError =
    breakdownQuery.error ??
    rarityQuery.error ??
    duplicatesQuery.error ??
    historyQuery.error;
  if (loadError) {
    return (
      <AppShell>
        <PageHeader />
        <Card role="alert">
          <CardHeader>
            <CardTitle asChild><h2>Couldn&apos;t load analytics</h2></CardTitle>
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
                void duplicatesQuery.refetch();
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
  const duplicates = duplicatesQuery.data;

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
            <CardTitle asChild><h2>No cards to analyze yet</h2></CardTitle>
            <CardDescription>
              Add cards to a binder and your value trends, price movers, and
              distribution breakdowns will appear here.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild size="sm">
              <Link href="/collections">Add cards</Link>
            </Button>
          </CardContent>
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
  const visibleDuplicates = (duplicates?.items ?? []).filter(
    (item) => enabledGames[item.tcg as keyof typeof enabledGames] !== false,
  );
  const duplicateCopies = visibleDuplicates.reduce(
    (sum, item) => sum + item.excessCopies,
    0,
  );
  const duplicateValue = visibleDuplicates.reduce(
    (sum, item) => sum + item.excessStoredValue,
    0,
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
          {showPricing && history && (
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

        <Card>
          <CardHeader className="gap-4 md:flex-row md:items-start md:justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Copy className="h-5 w-5" />
                Duplicate Finder
              </CardTitle>
              <CardDescription>
                Exact printings with more copies than you plan to keep.
              </CardDescription>
            </div>
            <div
              className="flex items-center gap-1 rounded-lg border p-1"
              role="group"
              aria-label="Copies to keep per printing"
            >
              <span className="px-2 text-xs text-muted-foreground">Keep</span>
              {[1, 2, 4].map((count) => (
                <Button
                  key={count}
                  type="button"
                  size="sm"
                  variant={keepCount === count ? "default" : "ghost"}
                  className="h-7 min-w-8 px-2"
                  aria-pressed={keepCount === count}
                  onClick={() => setKeepCount(count)}
                >
                  {count}
                </Button>
              ))}
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {visibleDuplicates.length === 0 ? (
              <div className="rounded-lg border border-dashed p-6 text-center">
                <p className="font-medium">No excess copies found</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Every exact printing is at or below your keep count of {keepCount}.
                </p>
              </div>
            ) : (
              <>
                <div className="grid gap-3 sm:grid-cols-3">
                  <DuplicateSummary
                    label="Duplicate printings"
                    value={visibleDuplicates.length.toLocaleString()}
                  />
                  <DuplicateSummary
                    label="Excess copies"
                    value={duplicateCopies.toLocaleString()}
                  />
                  {showPricing && (
                    <DuplicateSummary
                      label="Surplus stored value"
                      value={currency(duplicateValue)}
                    />
                  )}
                </div>
                <div className="divide-y rounded-lg border">
                  {visibleDuplicates.map((item) => (
                    <div
                      key={item.cardId}
                      className="grid gap-3 p-4 md:grid-cols-[minmax(0,1fr)_auto] md:items-center"
                    >
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                          <p className="font-medium">{item.name}</p>
                          <span className="text-xs text-muted-foreground">
                            {tcgLabel(item.tcg)}
                            {item.setName ? ` · ${item.setName}` : ""}
                            {item.collectorNumber ? ` #${item.collectorNumber}` : ""}
                          </span>
                        </div>
                        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                          <span className="inline-flex items-center gap-1">
                            <MapPin className="h-3.5 w-3.5" />
                            {item.binders
                              .map((binder) => `${binder.binderName} (${binder.quantity})`)
                              .join(", ")}
                          </span>
                          <span>
                            {item.conditions
                              .map((condition) => `${condition.condition} (${condition.quantity})`)
                              .join(", ")}
                          </span>
                        </div>
                      </div>
                      <div className="flex items-center justify-between gap-6 md:justify-end md:text-right">
                        <div>
                          <p className="text-lg font-semibold">
                            {item.excessCopies} excess
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {item.quantity} owned · keep {keepCount}
                          </p>
                        </div>
                        {showPricing && (
                          <div className="min-w-24">
                            <p className="font-medium">
                              {currency(item.excessStoredValue)}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {currency(item.storedValue)} stored
                            </p>
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
                {showPricing && (
                  <p className="text-xs text-muted-foreground">
                    Surplus value assumes you keep the highest-valued copies when
                    stored prices differ.
                  </p>
                )}
              </>
            )}
          </CardContent>
        </Card>

        {/* Value over time chart */}
        {showPricing && (
          <Card>
            <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
              <div>
                <CardTitle asChild className="flex items-center gap-2">
                  <h2>
                    <Calendar className="h-5 w-5" />
                    Collection Value Over Time
                  </h2>
                </CardTitle>
                <CardDescription>
                  Estimated {selectedGame === "all" ? "total" : tcgLabel(selectedGame)} value across the selected period.
                </CardDescription>
              </div>
              <div className="flex shrink-0 gap-1">
                {ANALYTICS_PERIODS.map((p) => (
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
                      className="flex h-full flex-1 items-end"
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
                <CardTitle asChild><h2>Value by Game</h2></CardTitle>
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
              <CardTitle asChild><h2>Rarity Distribution</h2></CardTitle>
              <CardDescription>
                Breakdown of {selectedGame === "all" ? "your collection" : `your ${tcgLabel(selectedGame)} cards`} by rarity.
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
        Collection value trends, duplicates, price movers, and distribution breakdowns.
      </p>
    </div>
  );
}

function DuplicateSummary({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border bg-muted/30 p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-xl font-semibold">{value}</p>
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
