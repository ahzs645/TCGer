"use client";

import { useEffect, useMemo, useState } from "react";
import { Search, ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import { useQuery } from "@tanstack/react-query";

import { AppShell } from "@/components/layout/app-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { getPriceMovers } from "@/lib/api/pricing";
import { GAME_LABELS, type SupportedGame } from "@/lib/utils";
import { useAuthStore } from "@/stores/auth";
import { useCollectionsStore } from "@/stores/collections";
import { useGameFilterStore } from "@/stores/game-filter";
import { useModuleStore } from "@/stores/preferences";

const TCG_COLORS: Record<string, string> = {
  pokemon: "#f59e0b",
  magic: "#8b5cf6",
  yugioh: "#ef4444",
};

type SortKey = "price" | "30d" | "owned";

interface OwnedPrice {
  key: string;
  name: string;
  tcg: string;
  setName?: string;
  rarity?: string;
  price: number;
  owned: number;
  change30d: number | null;
}

function tcgLabel(tcg: string): string {
  return GAME_LABELS[tcg as SupportedGame] ?? tcg;
}

export default function PricesPage() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState<SortKey>("price");
  const [sortAsc, setSortAsc] = useState(false);

  const { token, isAuthenticated } = useAuthStore();
  const selectedGame = useGameFilterStore((state) => state.selectedGame);
  const { enabledGames, showPricing } = useModuleStore((state) => ({
    enabledGames: state.enabledGames,
    showPricing: state.showPricing,
  }));

  const { collections, fetchCollections, isLoading, hasFetched, error } =
    useCollectionsStore((state) => ({
      collections: state.collections,
      fetchCollections: state.fetchCollections,
      isLoading: state.isLoading,
      hasFetched: state.hasFetched,
      error: state.error,
    }));

  useEffect(() => {
    if (!isAuthenticated || !token) return;
    if (!hasFetched && !isLoading) void fetchCollections(token);
  }, [fetchCollections, hasFetched, isAuthenticated, isLoading, token]);

  const moversQuery = useQuery({
    queryKey: ["prices", "movers", selectedGame],
    queryFn: () =>
      getPriceMovers(
        token!,
        selectedGame === "all" ? undefined : selectedGame,
        30,
      ),
    enabled: mounted && isAuthenticated && !!token && showPricing,
    staleTime: 1000 * 60 * 5,
  });

  const changeByCard = useMemo(() => {
    const map = new Map<string, number>();
    const movers = moversQuery.data;
    if (!movers) return map;
    for (const c of [...movers.gainers, ...movers.losers]) {
      map.set(`${c.tcg}:${c.externalId}`, c.percentChange);
    }
    return map;
  }, [moversQuery.data]);

  const owned = useMemo<OwnedPrice[]>(() => {
    const byKey = new Map<string, OwnedPrice>();
    for (const binder of collections) {
      for (const card of binder.cards) {
        if (enabledGames[card.tcg as keyof typeof enabledGames] === false)
          continue;
        if (selectedGame !== "all" && card.tcg !== selectedGame) continue;
        const externalId = card.externalId ?? card.cardId;
        const key = `${card.tcg}:${externalId}`;
        const existing = byKey.get(key);
        if (existing) {
          existing.owned += card.quantity ?? 0;
        } else {
          byKey.set(key, {
            key,
            name: card.name,
            tcg: card.tcg,
            setName: card.setName,
            rarity: card.rarity,
            price: card.price ?? 0,
            owned: card.quantity ?? 0,
            change30d: changeByCard.get(key) ?? null,
          });
        }
      }
    }
    return Array.from(byKey.values());
  }, [collections, enabledGames, selectedGame, changeByCard]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = owned.filter((p) => {
      if (!q) return true;
      return (
        p.name.toLowerCase().includes(q) ||
        (p.setName ?? "").toLowerCase().includes(q) ||
        tcgLabel(p.tcg).toLowerCase().includes(q)
      );
    });
    return list.sort((a, b) => {
      let diff = 0;
      if (sortBy === "price") diff = b.price - a.price;
      else if (sortBy === "owned") diff = b.owned - a.owned;
      else diff = (b.change30d ?? -Infinity) - (a.change30d ?? -Infinity);
      return sortAsc ? -diff : diff;
    });
  }, [owned, search, sortBy, sortAsc]);

  const portfolioValue = owned.reduce((s, p) => s + p.price * p.owned, 0);
  const changedCards = owned.filter((p) => p.change30d !== null);
  const avgChange =
    changedCards.length > 0
      ? changedCards.reduce((s, p) => s + (p.change30d ?? 0), 0) /
        changedCards.length
      : null;
  const mostValuable = owned.reduce<OwnedPrice | null>(
    (best, p) => (!best || p.price > best.price ? p : best),
    null,
  );

  const handleSort = (key: SortKey) => {
    if (sortBy === key) setSortAsc((v) => !v);
    else {
      setSortBy(key);
      setSortAsc(false);
    }
  };

  const sortIndicator = (key: SortKey) => {
    if (sortBy !== key)
      return <ArrowUpDown className="h-3 w-3 opacity-50" aria-hidden />;
    return sortAsc ? (
      <ArrowUp className="h-3 w-3" aria-hidden />
    ) : (
      <ArrowDown className="h-3 w-3" aria-hidden />
    );
  };
  const ariaSort = (key: SortKey): "ascending" | "descending" | "none" =>
    sortBy !== key ? "none" : sortAsc ? "ascending" : "descending";

  const loading = mounted && isAuthenticated && !hasFetched;

  return (
    <AppShell>
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-heading font-semibold">Price Tracker</h1>
          <p className="text-sm text-muted-foreground">
            Market prices and trends for cards in your collection.
          </p>
        </div>

        {mounted && !isAuthenticated ? (
          <Card>
            <CardHeader>
              <CardTitle>Sign in required</CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">
              Sign in to track prices for cards in your collection.
            </CardContent>
          </Card>
        ) : !showPricing ? (
          <div className="rounded-lg border bg-muted/40 p-4 text-sm text-muted-foreground">
            Pricing is hidden in your preferences. Enable pricing from the
            account menu to use the price tracker.
          </div>
        ) : error ? (
          <Card>
            <CardHeader>
              <CardTitle>Couldn&apos;t load your collection</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm text-muted-foreground">
              <p>{error}</p>
              <Button
                variant="outline"
                size="sm"
                onClick={() => token && void fetchCollections(token)}
              >
                Try again
              </Button>
            </CardContent>
          </Card>
        ) : loading ? (
          <PricesSkeleton />
        ) : owned.length === 0 ? (
          <Card>
            <CardHeader>
              <CardTitle>No tracked cards yet</CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">
              Add cards to a binder
              {selectedGame !== "all" ? ` for ${tcgLabel(selectedGame)}` : ""} to
              start tracking their prices here.
            </CardContent>
          </Card>
        ) : (
          <>
            {/* Summary */}
            <div className="grid grid-cols-2 gap-3 md:gap-6 xl:grid-cols-4">
              <SummaryCard title="Portfolio Value">
                <div className="text-xl md:text-3xl font-semibold">
                  ${portfolioValue.toFixed(2)}
                </div>
              </SummaryCard>
              <SummaryCard title="Tracked Cards">
                <div className="text-xl md:text-3xl font-semibold">
                  {owned.length}
                </div>
              </SummaryCard>
              <SummaryCard title="Avg 30d Change">
                <div
                  className={`text-xl md:text-3xl font-semibold ${
                    avgChange === null
                      ? ""
                      : avgChange >= 0
                        ? "text-green-500"
                        : "text-red-500"
                  }`}
                >
                  {avgChange === null
                    ? "—"
                    : `${avgChange >= 0 ? "+" : ""}${avgChange.toFixed(1)}%`}
                </div>
              </SummaryCard>
              <SummaryCard title="Most Valuable">
                <div className="text-sm md:text-lg font-semibold truncate">
                  {mostValuable?.name ?? "—"}
                </div>
                {mostValuable && (
                  <p className="text-xs text-muted-foreground">
                    ${mostValuable.price.toFixed(2)}
                  </p>
                )}
              </SummaryCard>
            </div>

            {/* Search */}
            <div className="relative max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search cards..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9"
                aria-label="Search tracked cards"
              />
            </div>

            {/* Price table */}
            <Card>
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b bg-muted/50">
                        <th className="p-3 text-left font-medium text-muted-foreground">
                          Card
                        </th>
                        <th className="p-3 text-left font-medium text-muted-foreground">
                          Game
                        </th>
                        <th className="p-3 text-left font-medium text-muted-foreground hidden md:table-cell">
                          Set
                        </th>
                        <SortableTh
                          label="Owned"
                          align="center"
                          className="hidden sm:table-cell"
                          ariaSort={ariaSort("owned")}
                          onClick={() => handleSort("owned")}
                          indicator={sortIndicator("owned")}
                        />
                        <SortableTh
                          label="Price"
                          align="right"
                          ariaSort={ariaSort("price")}
                          onClick={() => handleSort("price")}
                          indicator={sortIndicator("price")}
                        />
                        <SortableTh
                          label="30d"
                          align="right"
                          ariaSort={ariaSort("30d")}
                          onClick={() => handleSort("30d")}
                          indicator={sortIndicator("30d")}
                        />
                      </tr>
                    </thead>
                    <tbody>
                      {filtered.map((p) => (
                        <tr
                          key={p.key}
                          className="border-b last:border-0 hover:bg-muted/30 transition-colors"
                        >
                          <td className="p-3">
                            <span className="font-medium">{p.name}</span>
                            {p.rarity && (
                              <span className="ml-2 text-xs text-muted-foreground hidden xl:inline">
                                {p.rarity}
                              </span>
                            )}
                          </td>
                          <td className="p-3">
                            <Badge
                              variant="outline"
                              className="text-xs"
                              style={{ borderColor: TCG_COLORS[p.tcg] }}
                            >
                              {tcgLabel(p.tcg)}
                            </Badge>
                          </td>
                          <td className="p-3 text-muted-foreground hidden md:table-cell">
                            {p.setName ?? "—"}
                          </td>
                          <td className="p-3 text-center hidden sm:table-cell">
                            {p.owned}
                          </td>
                          <td className="p-3 text-right font-semibold">
                            {p.price > 0 ? `$${p.price.toFixed(2)}` : "—"}
                          </td>
                          <td className="p-3 text-right">
                            {p.change30d === null ? (
                              <span className="text-muted-foreground">—</span>
                            ) : (
                              <span
                                className={
                                  p.change30d >= 0
                                    ? "text-green-500"
                                    : "text-red-500"
                                }
                              >
                                {p.change30d >= 0 ? "+" : ""}
                                {p.change30d.toFixed(1)}%
                              </span>
                            )}
                          </td>
                        </tr>
                      ))}
                      {filtered.length === 0 && (
                        <tr>
                          <td
                            colSpan={6}
                            className="p-6 text-center text-sm text-muted-foreground"
                          >
                            No cards match your search.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </AppShell>
  );
}

function SummaryCard({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <Card>
      <CardHeader className="p-3 pb-1 md:p-6 md:pb-4">
        <CardTitle className="text-xs md:text-sm font-medium text-muted-foreground">
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent className="p-3 pt-0 md:p-6 md:pt-0">{children}</CardContent>
    </Card>
  );
}

function SortableTh({
  label,
  align,
  className,
  ariaSort,
  onClick,
  indicator,
}: {
  label: string;
  align: "right" | "center" | "left";
  className?: string;
  ariaSort: "ascending" | "descending" | "none";
  onClick: () => void;
  indicator: React.ReactNode;
}) {
  const justify =
    align === "right"
      ? "justify-end"
      : align === "center"
        ? "justify-center"
        : "justify-start";
  const textAlign =
    align === "right"
      ? "text-right"
      : align === "center"
        ? "text-center"
        : "text-left";
  return (
    <th
      className={`p-3 font-medium text-muted-foreground ${textAlign} ${className ?? ""}`}
      aria-sort={ariaSort}
    >
      <button
        type="button"
        onClick={onClick}
        className={`inline-flex w-full items-center gap-1 ${justify} hover:text-foreground`}
      >
        {label}
        {indicator}
      </button>
    </th>
  );
}

function PricesSkeleton() {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 md:gap-6 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, idx) => (
          <Card key={idx}>
            <CardHeader className="p-3 md:p-6">
              <Skeleton className="h-4 w-24" />
            </CardHeader>
            <CardContent className="p-3 pt-0 md:p-6 md:pt-0">
              <Skeleton className="h-8 w-20" />
            </CardContent>
          </Card>
        ))}
      </div>
      <Skeleton className="h-9 w-full max-w-sm" />
      <Skeleton className="h-64 w-full" />
    </div>
  );
}
