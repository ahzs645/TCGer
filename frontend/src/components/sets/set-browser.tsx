"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  CalendarDays,
  CheckCircle2,
  Loader2,
  Plus,
  Search,
} from "lucide-react";

import { SetSymbol } from "@/components/cards/set-symbol";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { getSets } from "@/lib/api/cards";
import { getAppRoute } from "@/lib/app-routes";
import { isCatalogGame } from "@/lib/catalog/use-catalog";
import { isDemoMode } from "@/lib/demo-mode";
import { ALL_COLLECTION_ID } from "@/lib/hooks/use-collection";
import { countOwnedPrintingsForSet, releaseYear } from "@/lib/sets/progress";
import { cn, GAME_LABELS, type SupportedGame } from "@/lib/utils";
import { useAuthStore } from "@/stores/auth";
import { useCollectionsStore } from "@/stores/collections";
import { supportedGames, useGameFilterStore } from "@/stores/game-filter";
import { useModuleStore } from "@/stores/preferences";
import type { CollectionCard, TcgCode, TcgSet } from "@tcg/api-types";

import { useShallow } from "zustand/react/shallow";
type ProgressFilter = "all" | "started" | "complete" | "not-started";
type SetSort = "release" | "name" | "card-count";

function compareSets(left: TcgSet, right: TcgSet, sort: SetSort): number {
  if (sort === "name") {
    return left.name.localeCompare(right.name, undefined, {
      sensitivity: "base",
    });
  }
  if (sort === "card-count") {
    return (
      (right.totalCards ?? -1) - (left.totalCards ?? -1) ||
      left.name.localeCompare(right.name)
    );
  }
  return (
    (right.releaseDate ?? "").localeCompare(left.releaseDate ?? "") ||
    left.name.localeCompare(right.name)
  );
}

function formatReleaseDate(value: string | undefined): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(date);
}

function searchText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLocaleLowerCase();
}

export function SetBrowser() {
  const pathname = usePathname();
  const [mounted, setMounted] = useState(false);
  const { token, isAuthenticated } = useAuthStore();
  const enabledGames = useModuleStore((state) => state.enabledGames);
  const { selectedGame: game, setGame } = useGameFilterStore(
    useShallow((state) => ({
      selectedGame: state.selectedGame,
      setGame: state.setGame,
    })),
  );
  const { collections, fetchCollections, hasFetched, collectionsLoading } =
    useCollectionsStore(
      useShallow((state) => ({
        collections: state.collections,
        fetchCollections: state.fetchCollections,
        hasFetched: state.hasFetched,
        collectionsLoading: state.isLoading,
      })),
    );
  const [query, setQuery] = useState("");
  const [progress, setProgress] = useState<ProgressFilter>("started");
  const [searchOverridesProgress, setSearchOverridesProgress] = useState(false);
  const [sort, setSort] = useState<SetSort>("release");
  const [year, setYear] = useState("all");
  const [collectionId, setCollectionId] = useState(ALL_COLLECTION_ID);
  const searchInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (token && isAuthenticated && !hasFetched) {
      void fetchCollections(token);
    }
  }, [fetchCollections, hasFetched, isAuthenticated, token]);

  useEffect(() => {
    if (
      collectionId !== ALL_COLLECTION_ID &&
      !collections.some((collection) => collection.id === collectionId)
    ) {
      setCollectionId(ALL_COLLECTION_ID);
    }
  }, [collectionId, collections]);

  const requestedGame = game === "all" ? undefined : game;
  const setsQuery = useQuery({
    queryKey: ["sets", requestedGame ?? "all"],
    queryFn: () => getSets(token!, requestedGame),
    enabled: Boolean(mounted && token && isAuthenticated),
    staleTime: 5 * 60_000,
  });

  const contextCards = useMemo<CollectionCard[]>(() => {
    if (collectionId === ALL_COLLECTION_ID) {
      return collections.flatMap((collection) => collection.cards);
    }
    return (
      collections.find((collection) => collection.id === collectionId)?.cards ??
      []
    );
  }, [collectionId, collections]);

  const availableYears = useMemo(() => {
    const years = new Set<number>();
    for (const set of setsQuery.data ?? []) {
      const value = releaseYear(set.releaseDate);
      if (value) years.add(value);
    }
    return Array.from(years).sort((left, right) => right - left);
  }, [setsQuery.data]);

  const ownedCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const set of setsQuery.data ?? []) {
      counts.set(
        `${set.tcg}:${set.code}`,
        countOwnedPrintingsForSet(set, contextCards),
      );
    }
    return counts;
  }, [contextCards, setsQuery.data]);

  const visibleSets = useMemo(() => {
    const needle = searchText(query.trim());
    // Search the full catalog even though the default view is limited to sets
    // represented in the collector's collection.
    const effectiveProgress = searchOverridesProgress ? "all" : progress;
    return (setsQuery.data ?? [])
      .filter((set) => {
        if (!enabledGames[set.tcg]) return false;
        if (game !== "all" && set.tcg !== game) return false;
        if (year !== "all" && releaseYear(set.releaseDate) !== Number(year)) {
          return false;
        }
        if (
          needle &&
          !searchText(set.name).includes(needle) &&
          !searchText(set.code).includes(needle)
        ) {
          return false;
        }

        const owned = ownedCounts.get(`${set.tcg}:${set.code}`) ?? 0;
        const total = set.totalCards ?? 0;
        if (effectiveProgress === "started") {
          return owned > 0;
        }
        if (effectiveProgress === "complete") {
          return total > 0 && owned >= total;
        }
        if (effectiveProgress === "not-started") return owned === 0;
        return true;
      })
      .sort((left, right) => compareSets(left, right, sort));
  }, [
    enabledGames,
    game,
    ownedCounts,
    progress,
    query,
    searchOverridesProgress,
    setsQuery.data,
    sort,
    year,
  ]);

  const groupedSets = useMemo(() => {
    const groups = new Map<TcgCode, TcgSet[]>();
    for (const set of visibleSets) {
      const values = groups.get(set.tcg) ?? [];
      values.push(set);
      groups.set(set.tcg, values);
    }
    return Array.from(groups.entries());
  }, [visibleSets]);

  if (!mounted) {
    return (
      <Card>
        <CardContent className="flex min-h-64 items-center justify-center">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  if (!isAuthenticated || !token) {
    return (
      <Card>
        <CardHeader>
          <CardTitle asChild>
            <h2>Sign in required</h2>
          </CardTitle>
          <CardDescription>
            Sign in to browse set checklists and compare them with your
            collection.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const noGamesEnabled = Object.values(enabledGames).every(
    (enabled) => !enabled,
  );
  const isCatalogSearch = Boolean(query.trim());
  const isDefaultStartedView = progress === "started" && !isCatalogSearch;

  const browseAllSets = () => {
    setProgress("all");
    setSearchOverridesProgress(false);
    window.requestAnimationFrame(() => searchInputRef.current?.focus());
  };

  const updateQuery = (value: string) => {
    if (!query.trim() && value.trim() && progress === "started") {
      setSearchOverridesProgress(true);
    } else if (!value.trim()) {
      setSearchOverridesProgress(false);
    }
    setQuery(value);
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="flex flex-col gap-3 pb-4 sm:flex-row sm:items-start sm:justify-between sm:space-y-0">
          <div className="space-y-1.5">
            <CardTitle asChild className="text-lg">
              <h2>{isDefaultStartedView ? "Your sets" : "Find a set"}</h2>
            </CardTitle>
            <CardDescription>
              {isDefaultStartedView
                ? "Sets with cards in your collection appear here. Search always looks across the full catalog."
                : `Completion is measured by unique printings in ${
                    collectionId === ALL_COLLECTION_ID
                      ? "your entire collection"
                      : (collections.find((entry) => entry.id === collectionId)
                          ?.name ?? "the selected binder")
                  }.`}
            </CardDescription>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={browseAllSets}
            className="shrink-0"
          >
            <Plus className="mr-2 h-4 w-4" />
            Add a set
          </Button>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
          <label className="relative sm:col-span-2">
            <span className="sr-only">Search sets</span>
            <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
            <Input
              ref={searchInputRef}
              value={query}
              onChange={(event) => updateQuery(event.target.value)}
              placeholder="Search all sets by name or code"
              className="pl-9"
            />
          </label>
          <Select
            value={game}
            onValueChange={(value) => setGame(value as SupportedGame)}
          >
            <SelectTrigger aria-label="Game">
              <SelectValue placeholder="All games" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All enabled games</SelectItem>
              {supportedGames
                .filter((value) => value !== "all")
                .map((value) => (
                  <SelectItem
                    key={value}
                    value={value}
                    disabled={!enabledGames[value]}
                  >
                    {GAME_LABELS[value]}
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>
          <Select value={year} onValueChange={setYear}>
            <SelectTrigger aria-label="Release year">
              <SelectValue placeholder="Any year" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Any release year</SelectItem>
              {availableYears.map((value) => (
                <SelectItem key={value} value={String(value)}>
                  {value}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={searchOverridesProgress ? "all" : progress}
            onValueChange={(value) => {
              setSearchOverridesProgress(false);
              setProgress(value as ProgressFilter);
            }}
          >
            <SelectTrigger aria-label="Completion status">
              <SelectValue placeholder="Any progress" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Any progress</SelectItem>
              <SelectItem value="not-started">Not started</SelectItem>
              <SelectItem value="started">Started</SelectItem>
              <SelectItem value="complete">Complete</SelectItem>
            </SelectContent>
          </Select>
          <Select
            value={collectionId}
            onValueChange={setCollectionId}
            disabled={collectionsLoading}
          >
            <SelectTrigger aria-label="Collection context">
              <SelectValue placeholder="All collection" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_COLLECTION_ID}>All collection</SelectItem>
              {collections.map((collection) => (
                <SelectItem key={collection.id} value={collection.id}>
                  {collection.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={sort}
            onValueChange={(value) => setSort(value as SetSort)}
          >
            <SelectTrigger aria-label="Sort sets">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="release">Newest release</SelectItem>
              <SelectItem value="name">Set name</SelectItem>
              <SelectItem value="card-count">Largest set</SelectItem>
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      {noGamesEnabled && (
        <Card>
          <CardContent className="py-10 text-center text-muted-foreground">
            Enable at least one game in account settings to browse its sets.
          </CardContent>
        </Card>
      )}

      {!noGamesEnabled && setsQuery.isLoading && (
        <div
          className="flex min-h-64 items-center justify-center gap-2 text-muted-foreground"
          role="status"
        >
          <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
          Loading sets…
        </div>
      )}

      {!noGamesEnabled && setsQuery.isError && (
        <Card className="border-destructive" role="alert">
          <CardContent className="space-y-3 py-8 text-center text-destructive">
            <p>
              {setsQuery.error instanceof Error
                ? setsQuery.error.message
                : "Unable to load sets."}
            </p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void setsQuery.refetch()}
            >
              Try again
            </Button>
          </CardContent>
        </Card>
      )}

      {!noGamesEnabled &&
        !setsQuery.isLoading &&
        !setsQuery.isError &&
        groupedSets.length === 0 && (
          <Card>
            <CardContent className="flex flex-col items-center gap-4 py-12 text-center">
              <div className="space-y-1.5">
                <p className="font-medium text-foreground">
                  {isDefaultStartedView
                    ? "You haven’t started any sets yet"
                    : "No sets match these filters"}
                </p>
                <p className="max-w-md text-sm text-muted-foreground">
                  {isDefaultStartedView
                    ? "Choose a set, open its checklist, and add your first card. It will appear here automatically."
                    : "Try a different search or clear one of the filters."}
                </p>
              </div>
              {isDefaultStartedView && (
                <Button type="button" onClick={browseAllSets}>
                  <Plus className="mr-2 h-4 w-4" />
                  Browse all sets
                </Button>
              )}
            </CardContent>
          </Card>
        )}

      {groupedSets.map(([tcg, sets]) => (
        <section key={tcg} className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-heading font-semibold">
              {GAME_LABELS[tcg]}
            </h2>
            <Badge variant="secondary">
              {sets.length} {sets.length === 1 ? "set" : "sets"}
            </Badge>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 sm:gap-4 lg:grid-cols-3 xl:grid-cols-4">
            {sets.map((set) => {
              const owned = ownedCounts.get(`${set.tcg}:${set.code}`) ?? 0;
              const total = set.totalCards ?? 0;
              const percent =
                total > 0
                  ? Math.min(100, Math.round((owned / total) * 100))
                  : 0;
              const complete = total > 0 && owned >= total;
              const isDemoExperience =
                pathname === "/demo" ||
                pathname.startsWith("/demo/") ||
                (mounted && isDemoMode());
              const canOpenSet = !isDemoExperience || isCatalogGame(set.tcg);
              const href = getAppRoute(
                `/sets/${set.tcg}/${encodeURIComponent(set.code)}`,
                pathname,
              );
              const released = formatReleaseDate(set.releaseDate);

              const setCard = (
                <Card
                  className={cn(
                    "h-full",
                    canOpenSet &&
                      "transition hover:-translate-y-0.5 hover:border-primary/50 hover:shadow-md",
                    complete && "border-emerald-500/50",
                  )}
                >
                  <CardHeader className="flex flex-row items-start gap-3 space-y-0 pb-3 sm:pb-4">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-muted sm:h-12 sm:w-12">
                      <SetSymbol
                        symbolUrl={set.iconUrl}
                        symbolFallbackUrl={set.iconFallbackUrl}
                        logoUrl={set.logoUrl}
                        setCode={set.code}
                        setName={set.name}
                        tcg={set.tcg}
                        size="lg"
                        className="max-h-10 max-w-10"
                      />
                    </div>
                    <div className="min-w-0 flex-1">
                      <CardTitle className="line-clamp-2 text-base">
                        {set.name}
                      </CardTitle>
                      <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
                        <span className="font-medium">
                          {set.code.toLocaleUpperCase()}
                        </span>
                        {released && (
                          <span className="flex items-center gap-1">
                            <CalendarDays className="h-3 w-3" />
                            {released}
                          </span>
                        )}
                      </p>
                    </div>
                    {complete && (
                      <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-500" />
                    )}
                  </CardHeader>
                  <CardContent className="space-y-2">
                    <div className="flex justify-between text-xs">
                      <span className={cn(owned > 0 && "font-medium")}>
                        {owned} unique {owned === 1 ? "print" : "prints"} owned
                      </span>
                      <span className="text-muted-foreground">
                        {total > 0 ? `${owned}/${total}` : "Total unavailable"}
                      </span>
                    </div>
                    <div
                      className="h-2 overflow-hidden rounded-full bg-muted"
                      role="progressbar"
                      aria-label={`${set.name} completion`}
                      aria-valuemin={0}
                      aria-valuemax={total || undefined}
                      aria-valuenow={total ? Math.min(owned, total) : undefined}
                    >
                      <div
                        className={cn(
                          "h-full rounded-full bg-primary transition-all",
                          complete && "bg-emerald-500",
                        )}
                        style={{ width: `${percent}%` }}
                      />
                    </div>
                  </CardContent>
                </Card>
              );

              return canOpenSet ? (
                <Link key={`${set.tcg}:${set.code}`} href={href}>
                  {setCard}
                </Link>
              ) : (
                <div key={`${set.tcg}:${set.code}`}>{setCard}</div>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
