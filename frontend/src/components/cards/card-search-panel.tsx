"use client";

import { gameLabel } from "@/lib/utils";

import { useEffect, useMemo, useRef, useState } from "react";
import { Dices, Loader2, Search as SearchIcon } from "lucide-react";
import {
  gamePackageDefinition,
  getGameDefinition,
  matchesCollectionFacets,
  type CollectionFacetCard,
  type GameFilterSelection,
  type TcgCode,
  type GamePackageCatalogCard,
} from "@tcg/api-types";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { GAME_LABELS, type SupportedGame } from "@/lib/utils";
import { useCardSearch } from "@/lib/hooks/use-card-search";
import { discoverCardsApi } from "@/lib/api-client";
import { supportedGames, useGameFilterStore } from "@/stores/game-filter";
import { useModuleStore } from "@/stores/preferences";
import { useCollectionsStore } from "@/stores/collections";
import { useAuthStore } from "@/stores/auth";
import type { Card as CardType } from "@/types/card";

import { CardPreview } from "./card-preview";
import { SetSymbol } from "./set-symbol";
import { GameFacetFilters } from "@/components/collections/sandbox/game-facet-filters";
import {
  gamePackageCards,
  listInstalledGamePackages,
  type InstalledGamePackage,
} from "@/lib/game-packages/game-package-client";

import { LatestRequest } from "@/lib/latest-request";

import { useShallow } from "zustand/react/shallow";

function setFilterValue(tcg: string, setCode: string): string {
  return `${tcg.toLocaleLowerCase()}::${setCode.toLocaleLowerCase()}`;
}

export function CardSearchPanel() {
  const { selectedGame, setGame } = useGameFilterStore(
    useShallow((state) => ({
      selectedGame: state.selectedGame,
      setGame: state.setGame,
    })),
  );
  const enabledGames = useModuleStore((state) => state.enabledGames);
  const { token, isAuthenticated } = useAuthStore();
  const { fetchCollections, hasFetched } = useCollectionsStore(
    useShallow((state) => ({
      fetchCollections: state.fetchCollections,
      hasFetched: state.hasFetched,
    })),
  );
  const latestRequest = useRef(new LatestRequest());
  const [requestError, setRequestError] = useState<Error | null>(null);
  const [inputValue, setInputValue] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [setFilter, setSetFilter] = useState("");
  const [visibleCount, setVisibleCount] = useState(48);
  const [rarityFilter, setRarityFilter] = useState("");
  const [collectorFilter, setCollectorFilter] = useState("");
  const [gameFacetSelections, setGameFacetSelections] = useState<
    Record<string, GameFilterSelection | undefined>
  >({});
  const [discoveredCards, setDiscoveredCards] = useState<CardType[] | null>(
    null,
  );
  const [discoverSource, setDiscoverSource] = useState<string | null>(null);
  const [isDiscovering, setIsDiscovering] = useState(false);
  const [installedPackages, setInstalledPackages] = useState<
    InstalledGamePackage[]
  >([]);
  const [selectedPackageId, setSelectedPackageId] = useState<string>();
  const [packageCards, setPackageCards] = useState<CardType[]>([]);

  const { data, error: searchError, isError: searchIsError, isFetching, refetch } = useCardSearch(
    selectedPackageId ? "" : searchQuery,
    selectedGame === "all" ? undefined : selectedGame,
  );
  const error = requestError ?? searchError;
  const isError = requestError !== null || (!selectedPackageId && discoveredCards === null && searchIsError);
  const normalizedRarityFilter = rarityFilter.trim().toLowerCase();
  const normalizedCollectorFilter = collectorFilter.trim().toLowerCase();
  const selectedPackage = installedPackages.find(
    (item) => item.id === selectedPackageId,
  );
  const selectedDefinition = selectedPackage
    ? gamePackageDefinition(selectedPackage.manifest)
    : selectedGame === "all"
      ? null
      : getGameDefinition(selectedGame as TcgCode);
  const sourceCards = useMemo(
    () => (selectedPackageId ? packageCards : (discoveredCards ?? data ?? [])),
    [data, discoveredCards, packageCards, selectedPackageId],
  );
  const facetCards = sourceCards.map(
    (card) => ({ ...card, quantity: 0 }) as CollectionFacetCard,
  );
  const cardsMatchingOtherFilters = useMemo(
    () =>
      sourceCards.filter((card) => {
        if (
          !selectedPackageId &&
          !enabledGames[card.tcg as keyof typeof enabledGames]
        ) {
          return false;
        }
        if (
          normalizedRarityFilter &&
          !card.rarity?.toLowerCase().includes(normalizedRarityFilter)
        ) {
          return false;
        }
        if (
          normalizedCollectorFilter &&
          !card.collectorNumber
            ?.toLowerCase()
            .includes(normalizedCollectorFilter)
        ) {
          return false;
        }
        if (
          selectedDefinition &&
          !matchesCollectionFacets(
            { ...card, quantity: 0 } as CollectionFacetCard,
            selectedDefinition.search.facets,
            gameFacetSelections,
          )
        ) {
          return false;
        }
        return true;
      }),
    [
      enabledGames,
      gameFacetSelections,
      normalizedCollectorFilter,
      normalizedRarityFilter,
      selectedDefinition,
      selectedPackageId,
      sourceCards,
    ],
  );
  const availableSets = useMemo(() => {
    const options = new Map<
      string,
      {
        value: string;
        code: string;
        name: string;
        tcg: TcgCode;
        symbolUrl?: string;
        logoUrl?: string;
      }
    >();

    for (const card of cardsMatchingOtherFilters) {
      if (!card.setCode) continue;
      const value = setFilterValue(card.tcg, card.setCode);
      const current = options.get(value);
      options.set(value, {
        value,
        code: card.setCode,
        name: card.setName ?? current?.name ?? card.setCode,
        tcg: card.tcg,
        symbolUrl: card.setSymbolUrl ?? current?.symbolUrl,
        logoUrl: card.setLogoUrl ?? current?.logoUrl,
      });
    }

    return Array.from(options.values()).sort(
      (left, right) =>
        left.tcg.localeCompare(right.tcg) ||
        left.name.localeCompare(right.name, undefined, { sensitivity: "base" }),
    );
  }, [cardsMatchingOtherFilters]);
  const activeSetFilter = availableSets.some((set) => set.value === setFilter)
    ? setFilter
    : "";
  const filteredCards = cardsMatchingOtherFilters.filter(
    (card) =>
      !activeSetFilter ||
      (card.setCode &&
        setFilterValue(card.tcg, card.setCode) === activeSetFilter),
  );
  const cards = filteredCards;
  useEffect(() => { setVisibleCount(48); }, [searchQuery, setFilter, rarityFilter, collectorFilter, gameFacetSelections, selectedGame, selectedPackageId]);
  const hasResults = cards.length > 0;
  const selectedGameDisabled =
    !selectedPackageId &&
    selectedGame !== "all" &&
    !enabledGames[selectedGame as keyof typeof enabledGames];
  const noGamesEnabled =
    installedPackages.length === 0 &&
    Object.values(enabledGames).every((enabled) => !enabled);
  const hasFacetFilters = Boolean(
    activeSetFilter ||
      normalizedRarityFilter ||
      normalizedCollectorFilter ||
      Object.values(gameFacetSelections).some((value) => value !== undefined),
  );

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmed = inputValue.trim();
    if (!trimmed) return;
    latestRequest.current.cancel();
    setIsDiscovering(false);
    setRequestError(null);
    setDiscoveredCards(null);
    setDiscoverSource(null);
    setSetFilter("");
    setSearchQuery(trimmed);
    if (selectedPackageId) {
      const gameId = selectedPackage?.manifest.game.id ?? selectedPackageId;
      setPackageCards([]);
      void latestRequest.current.run(
        () => gamePackageCards(selectedPackageId),
        (result) => {
          if (result.error) { setRequestError(result.error); return; }
          setPackageCards(result.value.filter((card) => packageCardMatches(card, trimmed)).map((card) => packageCard(card, gameId)));
        },
      );
      return;
    }
    if (trimmed === searchQuery) {
      void refetch();
    }
  };

  const handleDiscover = async () => {
    if (!token) return;
    setIsDiscovering(true);
    setRequestError(null);
    setDiscoverSource(null);
    setSetFilter("");
    await latestRequest.current.run(
      () => discoverCardsApi({ tcg: selectedGame, count: 6, token }),
      (result) => {
        setIsDiscovering(false);
        if (result.error) { setRequestError(result.error); return; }
        setDiscoveredCards(result.value.cards as CardType[]);
        setDiscoverSource(result.value.sampledFrom
          ? `${gameLabel(result.value.sampledFrom.tcg as SupportedGame)} · ${result.value.sampledFrom.setName ?? result.value.sampledFrom.setCode}`
          : "the catalog");
      },
    );
  };

  useEffect(() => {
    latestRequest.current.cancel();
    setIsDiscovering(false);
    setDiscoveredCards(null);
    setDiscoverSource(null);
    setPackageCards([]);
    setRequestError(null);
    const requests = latestRequest.current;
    return () => requests.cancel();
  }, [selectedGame, selectedPackageId, token]);

  useEffect(() => {
    void listInstalledGamePackages()
      .then(setInstalledPackages)
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!isAuthenticated || !token) {
      return;
    }

    if (!hasFetched) {
      fetchCollections(token);
    }
  }, [fetchCollections, hasFetched, isAuthenticated, token]);

  return (
    <div
      className="grid gap-6 lg:grid-cols-[300px_minmax(0,1fr)]"
      data-oid="wsi0d3e"
    >
      <Card className="h-fit lg:sticky lg:top-20" data-oid="-_rj04n">
        <CardHeader data-oid="exck2hn">
          <CardTitle asChild data-oid="._71p80">
            <h2>Search Parameters</h2>
          </CardTitle>
          <CardDescription data-oid="arc981r">
            Find cards by name or set across your enabled games.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4" data-oid="z2vprw7">
          <form
            className="space-y-4"
            onSubmit={handleSubmit}
            data-oid="shvo8j:"
          >
            <div className="space-y-2" data-oid="99ow48f">
              <label
                htmlFor="card-search-keyword"
                className="text-sm font-medium"
                data-oid="1bz10j7"
              >
                Keyword
              </label>
              <div className="flex gap-2" data-oid="3ihveu3">
                <Input
                  id="card-search-keyword"
                  className="min-w-0 flex-1"
                  value={inputValue}
                  onChange={(event) => setInputValue(event.target.value)}
                  placeholder="Search by name or set..."
                  data-oid="sthnxsr"
                />

                <Button
                  type="submit"
                  size="icon"
                  className="h-11 w-11 shrink-0"
                  aria-label="Search cards"
                  disabled={isFetching}
                  data-oid="yh7r5y1"
                >
                  {isFetching ? (
                    <Loader2
                      className="h-4 w-4 animate-spin"
                      data-oid="c2nss.6"
                    />
                  ) : (
                    <SearchIcon className="h-4 w-4" data-oid="dppi2li" />
                  )}
                </Button>
              </div>
              <Button
                type="button"
                variant="outline"
                className="w-full gap-2"
                onClick={() => void handleDiscover()}
                disabled={
                  isDiscovering ||
                  !isAuthenticated ||
                  noGamesEnabled ||
                  Boolean(selectedPackageId)
                }
              >
                {isDiscovering ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Dices className="h-4 w-4" />
                )}
                Discover random cards
              </Button>
            </div>

            <div className="space-y-2" data-oid="zsrjmvw">
              <label
                id="card-search-game-label"
                className="text-sm font-medium"
                data-oid="kdxgwae"
              >
                Game
              </label>
              <Select
                value={
                  selectedPackageId
                    ? `package:${selectedPackageId}`
                    : selectedGame
                }
                onValueChange={(value) => {
                  latestRequest.current.cancel();
                  if (value.startsWith("package:")) {
                    setSelectedPackageId(value.slice("package:".length));
                    setSetFilter("");
                    setGameFacetSelections({});
                    setDiscoveredCards(null);
                    return;
                  }
                  setSelectedPackageId(undefined);
                  setPackageCards([]);
                  setGame(value as SupportedGame);
                  setSetFilter("");
                  setGameFacetSelections({});
                  setDiscoveredCards(null);
                }}
                data-oid="19wtplw"
              >
                <SelectTrigger
                  aria-labelledby="card-search-game-label"
                  data-oid="1z40tmp"
                >
                  <SelectValue placeholder="All games" data-oid="jj51dke" />
                </SelectTrigger>
                <SelectContent data-oid="c-c_6mu">
                  <SelectItem value="all" data-oid="20f.i-_">
                    All Games
                  </SelectItem>
                  {supportedGames
                    .filter((game) => game !== "all")
                    .map((game) => (
                      <SelectItem
                        key={game}
                        value={game}
                        disabled={!enabledGames[game]}
                      >
                        {gameLabel(game)} · TCGer{" "}
                        {!enabledGames[game] && "(disabled)"}
                      </SelectItem>
                    ))}
                  {installedPackages.map((installed) => (
                    <SelectItem
                      key={installed.id}
                      value={`package:${installed.id}`}
                    >
                      {gamePackageDefinition(installed.manifest).label} ·{" "}
                      {installed.manifest.publisher.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <fieldset className="space-y-3 rounded-lg border p-3">
              <legend className="px-1 text-sm font-medium">
                Refine results
              </legend>
              <div className="space-y-2">
                <label
                  htmlFor="card-search-set"
                  className="text-xs font-medium"
                >
                  Set
                </label>
                <Select
                  value={
                    availableSets.length > 0
                      ? activeSetFilter || "all"
                      : undefined
                  }
                  onValueChange={(value) =>
                    setSetFilter(value === "all" ? "" : value)
                  }
                  disabled={availableSets.length === 0}
                >
                  <SelectTrigger
                    id="card-search-set"
                    aria-label="Set"
                    className="h-auto min-h-11 py-2 sm:min-h-10"
                  >
                    <SelectValue
                      placeholder={
                        searchQuery || discoveredCards || selectedPackageId
                          ? "No sets in these results"
                          : "Search first to choose a set"
                      }
                    />
                  </SelectTrigger>
                  <SelectContent className="max-h-[min(28rem,var(--radix-select-content-available-height))] min-w-[18rem]">
                    <SelectItem value="all">
                      <span className="text-foreground">
                        Any set in these results
                      </span>
                    </SelectItem>
                    {supportedGames
                      .filter((tcg) => tcg !== "all")
                      .map((tcg) => {
                        const sets = availableSets.filter(
                          (set) => set.tcg === tcg,
                        );
                        if (sets.length === 0) return null;
                        return (
                          <SelectGroup key={tcg}>
                            <SelectLabel>{gameLabel(tcg)}</SelectLabel>
                            {sets.map((set) => (
                              <SelectItem key={set.value} value={set.value}>
                                <span className="flex items-center gap-2.5 text-left">
                                  <SetSymbol
                                    symbolUrl={set.symbolUrl}
                                    logoUrl={set.logoUrl}
                                    setCode={set.code}
                                    setName={set.name}
                                    tcg={set.tcg}
                                    size="sm"
                                    className="shrink-0"
                                  />
                                  <span className="grid min-w-0 leading-tight">
                                    <span className="truncate text-foreground">
                                      {set.name}
                                    </span>
                                    <span className="text-xs text-muted-foreground">
                                      {set.code.toLocaleUpperCase()}
                                    </span>
                                  </span>
                                </span>
                              </SelectItem>
                            ))}
                          </SelectGroup>
                        );
                      })}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  {availableSets.length > 0
                    ? `${availableSets.length} ${availableSets.length === 1 ? "set" : "sets"} in the current results.`
                    : "Run a search to choose from its matching sets."}
                </p>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-2">
                  <label
                    htmlFor="card-search-rarity"
                    className="text-xs font-medium"
                  >
                    Rarity
                  </label>
                  <Input
                    id="card-search-rarity"
                    value={rarityFilter}
                    onChange={(event) => {
                      setRarityFilter(event.target.value);
                      setSetFilter("");
                    }}
                    placeholder="Rare"
                  />
                </div>
                <div className="space-y-2">
                  <label
                    htmlFor="card-search-collector"
                    className="text-xs font-medium"
                  >
                    Collector #
                  </label>
                  <Input
                    id="card-search-collector"
                    value={collectorFilter}
                    onChange={(event) => {
                      setCollectorFilter(event.target.value);
                      setSetFilter("");
                    }}
                    placeholder="138"
                  />
                </div>
              </div>
              {hasFacetFilters ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="w-full"
                  onClick={() => {
                    setSetFilter("");
                    setRarityFilter("");
                    setCollectorFilter("");
                    setGameFacetSelections({});
                  }}
                >
                  Clear result filters
                </Button>
              ) : null}
            </fieldset>
            {selectedDefinition ? (
              <GameFacetFilters
                definition={{
                  ...selectedDefinition,
                  collection: {
                    ...selectedDefinition.collection,
                    facets: selectedDefinition.search.facets,
                  },
                }}
                cards={facetCards}
                selections={gameFacetSelections}
                onChange={(facetId, selection) => {
                  setSetFilter("");
                  setGameFacetSelections((current) => ({
                    ...current,
                    [facetId]: selection,
                  }));
                }}
              />
            ) : null}
          </form>
        </CardContent>
      </Card>
      <Card className="overflow-hidden" data-oid="2ju24np">
        <CardHeader
          className="flex flex-row items-center justify-between space-y-0 border-b"
          data-oid="duv85c-"
        >
          <div data-oid="3.cdfwa">
            <CardTitle asChild data-oid="75.9olc">
              <h2>Results</h2>
            </CardTitle>
            <CardDescription data-oid="_a9wnkx">
              {noGamesEnabled
                ? "Enable at least one module to resume cross-game search."
                : isError
                  ? error instanceof Error
                    ? error.message
                    : "Search failed."
                  : discoveredCards
                    ? `${cards.length} random cards from ${discoverSource ?? "the catalog"}.`
                    : searchQuery
                      ? `${cards.length} cards matched "${searchQuery}".`
                      : "Enter a keyword and run a search to see results."}
            </CardDescription>
          </div>
          <div aria-live="polite" aria-atomic="true">
            {isFetching ? (
              <span
                className="flex items-center gap-2 text-sm text-muted-foreground"
                role="status"
              >
                <Loader2
                  className="h-5 w-5 animate-spin"
                  aria-hidden="true"
                  data-oid="8z1v9gr"
                />
                <span className="sr-only">Searching for cards…</span>
              </span>
            ) : isError ? (
              <span className="sr-only" role="alert">
                Card search failed.
              </span>
            ) : searchQuery ? (
              <span className="sr-only" role="status">
                {cards.length} {cards.length === 1 ? "card" : "cards"} found.
              </span>
            ) : null}
          </div>
        </CardHeader>
        <CardContent className="p-0" data-oid="bopkrlg">
          <ScrollArea
            className={
              hasResults ? "h-auto lg:h-[calc(100vh-17rem)]" : "h-auto"
            }
            data-oid="17p81o6"
          >
            <div className="space-y-8 p-4 sm:p-6" data-oid="ld:vdo3">
              {!hasResults ? (
                <div
                  className="flex h-40 items-center justify-center text-sm text-muted-foreground"
                  role={isError ? "alert" : isFetching ? "status" : undefined}
                  data-oid="ft_4cz3"
                >
                  {noGamesEnabled
                    ? "All modules are disabled. Re-enable at least one trading card game in settings."
                    : isFetching
                      ? "Searching for matching cards..."
                      : isError
                        ? error instanceof Error
                          ? error.message
                          : "Search failed. Try again."
                        : selectedGameDisabled
                          ? "Selected game is disabled. Toggle it on in module preferences to continue."
                          : searchQuery
                            ? `No exact matches for "${searchQuery}". Try correcting the spelling or using a broader query.`
                            : "No results yet. Try adjusting your query or game filter."}
                </div>
              ) : (
                (() => {
                  // Group cards by TCG
                  const groupedCards = cards.slice(0, visibleCount).reduce(
                    (acc, card) => {
                      const tcg = card.tcg;
                      if (!acc[tcg]) {
                        acc[tcg] = [];
                      }
                      acc[tcg].push(card);
                      return acc;
                    },
                    {} as Record<string, typeof cards>,
                  );

                  return (
                    Object.entries(groupedCards) as [string, typeof cards][]
                  ).map(([tcg, tcgCards]) => (
                    <div key={tcg} data-oid="i.8p.ha">
                      <h3
                        className="text-lg font-semibold mb-4 capitalize"
                        data-oid="dqt0:bq"
                      >
                        {(() => {
                          const installed = installedPackages.find(
                            (item) => item.manifest.game.id === tcg,
                          );
                          return installed
                            ? gamePackageDefinition(installed.manifest).label
                            : (gameLabel(tcg as keyof typeof GAME_LABELS) ??
                                tcg);
                        })()}
                      </h3>
                      <div className="flex flex-wrap gap-4" data-oid="0mf81m4">
                        {tcgCards.map((card) => (
                          <CardPreview
                            key={`${card.tcg}:${card.id}`}
                            card={card as CardType}
                            data-oid="65k:.5:"
                          />
                        ))}
                      </div>
                    </div>
                  ));
                })()
              )}
              {cards.length > visibleCount && <Button variant="outline" onClick={() => setVisibleCount(count => count + 48)}>Show more results ({visibleCount} of {cards.length})</Button>}
            </div>
          </ScrollArea>
        </CardContent>
      </Card>
    </div>
  );
}

function packageCardMatches(
  card: GamePackageCatalogCard,
  query: string,
): boolean {
  const normalized = query.toLocaleLowerCase();
  return [card.name, card.setName, card.setCode, card.collectorNumber].some(
    (value) => value?.toLocaleLowerCase().includes(normalized),
  );
}

function packageCard(card: GamePackageCatalogCard, gameId: string): CardType {
  return {
    ...card,
    tcg: gameId,
    printingKey: card.printingKey ?? card.id,
  } as unknown as CardType;
}
