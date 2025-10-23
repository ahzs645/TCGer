'use client';

import { useState } from 'react';
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
import type { Card as CardType } from '@/types/card';

import { CardPreview } from './card-preview';

const presetQueries = [
  { label: 'Top decks', value: 'meta' },
  { label: 'Dragon', value: 'dragon' },
  { label: 'Starter', value: 'starter' }
];

export function CardSearchPanel() {
  const globalGame = useGameFilterStore((state) => state.selectedGame);
  const [query, setQuery] = useState('dark magician');
  const [selectedGame, setSelectedGame] = useState<SupportedGame | 'all'>(globalGame ?? 'all');

  const { data, isFetching, refetch } = useCardSearch(query, selectedGame === 'all' ? undefined : selectedGame);
  const cards = data ?? [];

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!query.trim()) return;
    refetch();
  };

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
                <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search cards..." />
                <Button type="submit" disabled={isFetching}>
                  {isFetching ? <Loader2 className="h-4 w-4 animate-spin" /> : <SearchIcon className="h-4 w-4" />}
                </Button>
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">TCG Filter</label>
              <Select value={selectedGame} onValueChange={(value) => setSelectedGame(value as SupportedGame | 'all')}>
                <SelectTrigger>
                  <SelectValue placeholder="All games" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Games</SelectItem>
                  <SelectItem value="yugioh">Yu-Gi-Oh!</SelectItem>
                  <SelectItem value="magic">Magic: The Gathering</SelectItem>
                  <SelectItem value="pokemon">Pokémon</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Quick presets</label>
              <div className="flex flex-wrap gap-2">
                {presetQueries.map((preset) => (
                  <Button key={preset.value} variant="secondary" size="sm" onClick={() => setQuery(preset.value)} type="button">
                    {preset.label}
                  </Button>
                ))}
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Active adapter</label>
              <div className="rounded-md border bg-muted/40 p-3 text-sm">
                Searching <Badge variant="outline">{GAME_LABELS[selectedGame] ?? 'All Games'}</Badge>
              </div>
            </div>
          </form>
        </CardContent>
      </Card>
      <Card className="overflow-hidden">
        <CardHeader className="flex flex-row items-center justify-between space-y-0 border-b">
          <div>
            <CardTitle>Results</CardTitle>
            <CardDescription>{cards.length} cards matched your search.</CardDescription>
          </div>
          {isFetching && <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />}
        </CardHeader>
        <CardContent className="p-0">
          <ScrollArea className="h-[600px]">
            <div className="grid gap-6 p-6 md:grid-cols-2 xl:grid-cols-3">
              {cards.map((card) => (
                <CardPreview key={card.id} card={card as CardType} />
              ))}
              {cards.length === 0 && !isFetching && (
                <div className="col-span-full flex h-40 items-center justify-center text-sm text-muted-foreground">
                  No results yet. Try adjusting your query or game filter.
                </div>
              )}
            </div>
          </ScrollArea>
        </CardContent>
      </Card>
    </div>
  );
}
