"use client";

import { useEffect, useState } from "react";
import { Loader2, Search as SearchIcon } from "lucide-react";

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
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { GAME_LABELS, type SupportedGame } from "@/lib/utils";
import { useCardSearch } from "@/lib/hooks/use-card-search";
import { useGameFilterStore } from "@/stores/game-filter";
import { useModuleStore } from "@/stores/preferences";
import { useCollectionsStore } from "@/stores/collections";
import { useAuthStore } from "@/stores/auth";
import type { Card as CardType } from "@/types/card";

import { CardPreview } from "./card-preview";

export function CardSearchPanel() {
  const { selectedGame, setGame } = useGameFilterStore((state) => ({
    selectedGame: state.selectedGame,
    setGame: state.setGame,
  }));
  const enabledGames = useModuleStore((state) => state.enabledGames);
  const { token, isAuthenticated } = useAuthStore();
  const { fetchCollections, hasFetched } = useCollectionsStore((state) => ({
    fetchCollections: state.fetchCollections,
    hasFetched: state.hasFetched,
  }));
  const [inputValue, setInputValue] = useState("");
  const [searchQuery, setSearchQuery] = useState("");

  const { data, error, isError, isFetching, refetch } = useCardSearch(
    searchQuery,
    selectedGame === "all" ? undefined : selectedGame,
  );
  const filteredCards = (data ?? []).filter(
    (card) => enabledGames[card.tcg as keyof typeof enabledGames],
  );
  const cards = filteredCards;
  const selectedGameDisabled =
    selectedGame !== "all" &&
    !enabledGames[selectedGame as keyof typeof enabledGames];
  const noGamesEnabled =
    !enabledGames.yugioh && !enabledGames.magic && !enabledGames.pokemon;

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmed = inputValue.trim();
    if (!trimmed) return;
    setSearchQuery(trimmed);
    if (trimmed === searchQuery) {
      void refetch();
    }
  };

  useEffect(() => {
    if (!isAuthenticated || !token) {
      return;
    }

    if (!hasFetched) {
      fetchCollections(token);
    }
  }, [fetchCollections, hasFetched, isAuthenticated, token]);

  return (
    <div className="grid gap-6 lg:grid-cols-[280px_1fr]" data-oid="wsi0d3e">
      <Card className="h-fit border-dashed" data-oid="-_rj04n">
        <CardHeader data-oid="exck2hn">
          <CardTitle data-oid="._71p80">Search Parameters</CardTitle>
          <CardDescription data-oid="arc981r">
            Query any supported TCG via adapter search.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4" data-oid="z2vprw7">
          <form
            className="space-y-4"
            onSubmit={handleSubmit}
            data-oid="shvo8j:"
          >
            <div className="space-y-2" data-oid="99ow48f">
              <label className="text-sm font-medium" data-oid="1bz10j7">
                Keyword
              </label>
              <div className="flex gap-2" data-oid="3ihveu3">
                <Input
                  value={inputValue}
                  onChange={(event) => setInputValue(event.target.value)}
                  placeholder="Search cards by name, set, or archetype..."
                  data-oid="sthnxsr"
                />

                <Button type="submit" disabled={isFetching} data-oid="yh7r5y1">
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
            </div>

            <div className="space-y-2" data-oid="zsrjmvw">
              <label className="text-sm font-medium" data-oid="kdxgwae">
                TCG Filter
              </label>
              <Select
                value={selectedGame}
                onValueChange={(value) => setGame(value as SupportedGame)}
                data-oid="19wtplw"
              >
                <SelectTrigger data-oid="1z40tmp">
                  <SelectValue placeholder="All games" data-oid="jj51dke" />
                </SelectTrigger>
                <SelectContent data-oid="c-c_6mu">
                  <SelectItem value="all" data-oid="20f.i-_">
                    All Games
                  </SelectItem>
                  <SelectItem
                    value="yugioh"
                    disabled={!enabledGames.yugioh}
                    data-oid="0v5hs8d"
                  >
                    Yu-Gi-Oh! {!enabledGames.yugioh && "(disabled)"}
                  </SelectItem>
                  <SelectItem
                    value="magic"
                    disabled={!enabledGames.magic}
                    data-oid="bpj1cuz"
                  >
                    Magic: The Gathering {!enabledGames.magic && "(disabled)"}
                  </SelectItem>
                  <SelectItem
                    value="pokemon"
                    disabled={!enabledGames.pokemon}
                    data-oid="ug:ep-w"
                  >
                    Pokémon {!enabledGames.pokemon && "(disabled)"}
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
          </form>
        </CardContent>
      </Card>
      <Card className="overflow-hidden" data-oid="2ju24np">
        <CardHeader
          className="flex flex-row items-center justify-between space-y-0 border-b"
          data-oid="duv85c-"
        >
          <div data-oid="3.cdfwa">
            <CardTitle data-oid="75.9olc">Results</CardTitle>
            <CardDescription data-oid="_a9wnkx">
              {noGamesEnabled
                ? "Enable at least one module to resume cross-game search."
                : isError
                  ? error instanceof Error
                    ? error.message
                    : "Search failed."
                  : searchQuery
                    ? `${cards.length} cards matched "${searchQuery}".`
                    : "Enter a keyword and run a search to see results."}
            </CardDescription>
          </div>
          {isFetching && (
            <Loader2
              className="h-5 w-5 animate-spin text-muted-foreground"
              data-oid="8z1v9gr"
            />
          )}
        </CardHeader>
        <CardContent className="p-0" data-oid="bopkrlg">
          <ScrollArea className="h-[calc(100vh-280px)]" data-oid="17p81o6">
            <div className="p-6 space-y-8" data-oid="ld:vdo3">
              {cards.length === 0 && !isFetching ? (
                <div
                  className="flex h-40 items-center justify-center text-sm text-muted-foreground"
                  data-oid="ft_4cz3"
                >
                  {noGamesEnabled
                    ? "All modules are disabled. Re-enable at least one trading card game in settings."
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
                  const groupedCards = cards.reduce(
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
                        {GAME_LABELS[tcg as keyof typeof GAME_LABELS] || tcg}
                      </h3>
                      <div className="flex flex-wrap gap-4" data-oid="0mf81m4">
                        {tcgCards.map((card) => (
                          <CardPreview
                            key={card.id}
                            card={card as CardType}
                            data-oid="65k:.5:"
                          />
                        ))}
                      </div>
                    </div>
                  ));
                })()
              )}
            </div>
          </ScrollArea>
        </CardContent>
      </Card>
    </div>
  );
}
