'use client';

import { useEffect, useState } from 'react';
import { Loader2, Search as SearchIcon } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { GAME_LABELS, type SupportedGame } from '@/lib/utils';
import { useCardSearch } from '@/lib/hooks/use-card-search';
import { useGameFilterStore } from '@/stores/game-filter';
import { useModuleStore } from '@/stores/preferences';
import { useCollectionsStore } from '@/stores/collections';
import { useAuthStore } from '@/stores/auth';
import type { Card as CardType } from '@/types/card';

import { CardPreview } from './card-preview';

const presetQueries = [
  { label: 'Top decks', value: 'meta' },
  { label: 'Dragon', value: 'dragon' },
  { label: 'Starter', value: 'starter' }
];

export function CardSearchPanel() {
  const { selectedGame, setGame } = useGameFilterStore((state) => ({
    selectedGame: state.selectedGame,
    setGame: state.setGame
  }));
  const enabledGames = useModuleStore((state) => state.enabledGames);
  const { token, isAuthenticated } = useAuthStore();
  const { fetchCollections, hasFetched } = useCollectionsStore((state) => ({
    fetchCollections: state.fetchCollections,
    hasFetched: state.hasFetched
  }));
  const [inputValue, setInputValue] = useState('');
  const [searchQuery, setSearchQuery] = useState('');

  const { data, isFetching, refetch } = useCardSearch(searchQuery, selectedGame === 'all' ? undefined : selectedGame);
  const filteredCards = (data ?? []).filter((card) => enabledGames[card.tcg as keyof typeof enabledGames]);
  const cards = filteredCards;
  const selectedGameDisabled = selectedGame !== 'all' && !enabledGames[selectedGame as keyof typeof enabledGames];
  const noGamesEnabled = !enabledGames.yugioh && !enabledGames.magic && !enabledGames.pokemon;

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmed = inputValue.trim();
    if (!trimmed) return;
    setSearchQuery(trimmed);
    if (trimmed === searchQuery) {
      void refetch();
    }
  };

  const handlePreset = (value: string) => {
    setInputValue(value);
    setSearchQuery(value);
    if (value === searchQuery) {
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
    <div className="grid gap-6 lg:grid-cols-[360px_1fr]">
      <Card className="h-fit border-dashed">
        <CardHeader>
          <CardTitle>Search Parameters</CardTitle>
          <CardDescription>Query any supported TCG via adapter search.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <form className="space-y-4" onSubmit={handleSubmit}>
            <div className="space-y-2">
              <label className="text-sm font-medium">Keyword</label>
              <div className="flex gap-2">
                <Input
                  value={inputValue}
                  onChange={(event) => setInputValue(event.target.value)}
                  placeholder="Search cards by name, set, or archetype..."
                />
                <Button type="submit" disabled={isFetching}>
                  {isFetching ? <Loader2 className="h-4 w-4 animate-spin" /> : <SearchIcon className="h-4 w-4" />}
                </Button>
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">TCG Filter</label>
              <Select value={selectedGame} onValueChange={(value) => setGame(value as SupportedGame)}>
                <SelectTrigger>
                  <SelectValue placeholder="All games" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Games</SelectItem>
                  <SelectItem value="yugioh" disabled={!enabledGames.yugioh}>
                    Yu-Gi-Oh! {!enabledGames.yugioh && '(disabled)'}
                  </SelectItem>
                  <SelectItem value="magic" disabled={!enabledGames.magic}>
                    Magic: The Gathering {!enabledGames.magic && '(disabled)'}
                  </SelectItem>
                  <SelectItem value="pokemon" disabled={!enabledGames.pokemon}>
                    Pokémon {!enabledGames.pokemon && '(disabled)'}
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Quick presets</label>
              <div className="flex flex-wrap gap-2">
                {presetQueries.map((preset) => (
                  <Button
                    key={preset.value}
                    variant="secondary"
                    size="sm"
                    onClick={() => handlePreset(preset.value)}
                    type="button"
                  >
                    {preset.label}
                  </Button>
                ))}
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Active adapter</label>
              <div className="rounded-md border bg-muted/40 p-3 text-sm">
                Searching{' '}
                <Badge
                  variant="outline"
                  className={selectedGameDisabled ? 'border-destructive text-destructive' : ''}
                >
                  {GAME_LABELS[selectedGame] ?? 'All Games'}
                </Badge>
                {selectedGameDisabled ? (
                  <p className="mt-2 text-xs text-destructive">
                    This game is currently disabled. Enable it from account settings to include its results.
                  </p>
                ) : (
                  <p className="mt-2 text-xs text-muted-foreground">
                    {searchQuery
                      ? `Showing results for "${searchQuery}".`
                      : 'Select a TCG and enter a query to begin searching.'}
                  </p>
                )}
              </div>
            </div>
          </form>
        </CardContent>
      </Card>
      <Card className="overflow-hidden">
        <CardHeader className="flex flex-row items-center justify-between space-y-0 border-b">
          <div>
            <CardTitle>Results</CardTitle>
            <CardDescription>
              {noGamesEnabled
                ? 'Enable at least one module to resume cross-game search.'
                : searchQuery
                  ? `${cards.length} cards matched "${searchQuery}".`
                  : 'Enter a keyword and run a search to see results.'}
            </CardDescription>
          </div>
          {isFetching && <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />}
        </CardHeader>
        <CardContent className="p-0">
          <ScrollArea className="h-[600px]">
            <div className="p-6 space-y-8">
              {cards.length === 0 && !isFetching ? (
                <div className="flex h-40 items-center justify-center text-sm text-muted-foreground">
                  {noGamesEnabled
                    ? 'All modules are disabled. Re-enable at least one trading card game in settings.'
                    : selectedGameDisabled
                      ? 'Selected game is disabled. Toggle it on in module preferences to continue.'
                      : 'No results yet. Try adjusting your query or game filter.'}
                </div>
              ) : (
                (() => {
                  // Group cards by TCG
                  const groupedCards = cards.reduce((acc, card) => {
                    const tcg = card.tcg;
                    if (!acc[tcg]) {
                      acc[tcg] = [];
                    }
                    acc[tcg].push(card);
                    return acc;
                  }, {} as Record<string, typeof cards>);

                  return Object.entries(groupedCards).map(([tcg, tcgCards]) => (
                    <div key={tcg}>
                      <h3 className="text-lg font-semibold mb-4 capitalize">
                        {GAME_LABELS[tcg as keyof typeof GAME_LABELS] || tcg}
                      </h3>
                      <div className="flex flex-wrap gap-4">
                        {tcgCards.map((card) => (
                          <CardPreview key={card.id} card={card as CardType} />
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
