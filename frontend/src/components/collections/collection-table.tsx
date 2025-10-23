'use client';

import { useMemo, useState } from 'react';
import { Download, Filter, Loader2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { GAME_LABELS } from '@/lib/utils';
import { useCardSearch } from '@/lib/hooks/use-card-search';
import { useGameFilterStore } from '@/stores/game-filter';

export function CollectionTable() {
  const selectedGame = useGameFilterStore((state) => state.selectedGame);
  const [searchTerm, setSearchTerm] = useState('collection');
  const [sortBy, setSortBy] = useState<'name' | 'rarity'>('name');
  const [selectedRows, setSelectedRows] = useState<Record<string, boolean>>({});

  const { data, isLoading } = useCardSearch(searchTerm, selectedGame === 'all' ? undefined : selectedGame);
  const cards = data ?? [];

  const sortedCards = useMemo(() => {
    return [...cards].sort((a, b) => {
      const aValue = a[sortBy] ?? '';
      const bValue = b[sortBy] ?? '';
      return String(aValue).localeCompare(String(bValue));
    });
  }, [cards, sortBy]);

  const toggleRow = (id: string) => {
    setSelectedRows((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const allSelected = useMemo(() => sortedCards.every((card) => selectedRows[card.id]), [sortedCards, selectedRows]);

  const toggleAll = () => {
    if (allSelected) {
      setSelectedRows({});
    } else {
      const nextState: Record<string, boolean> = {};
      sortedCards.forEach((card) => {
        nextState[card.id] = true;
      });
      setSelectedRows(nextState);
    }
  };

  return (
    <Card>
      <CardHeader className="flex flex-col gap-4 border-b pb-4 md:flex-row md:items-center md:justify-between">
        <div>
          <CardTitle>Collection Manager</CardTitle>
          <CardDescription>Organize, filter, and export cards synced from the backend database.</CardDescription>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Input
            value={searchTerm}
            onChange={(event) => setSearchTerm(event.target.value)}
            placeholder="Search within collection"
            className="w-48 sm:w-64"
          />
          <Select value={sortBy} onValueChange={(value) => setSortBy(value as typeof sortBy)}>
            <SelectTrigger className="w-[140px]">
              <SelectValue placeholder="Sort by" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="name">Name</SelectItem>
              <SelectItem value="rarity">Rarity</SelectItem>
            </SelectContent>
          </Select>
          <Button variant="outline" size="sm" className="gap-2">
            <Filter className="h-4 w-4" />
            Filters
          </Button>
          <Button size="sm" className="gap-2">
            <Download className="h-4 w-4" />
            Export
          </Button>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        <ScrollArea className="h-[620px]">
          <Table>
            <TableHeader className="bg-muted/30">
              <TableRow>
                <TableHead className="w-10">
                  <Checkbox checked={allSelected} onCheckedChange={toggleAll} aria-label="Select all" />
                </TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Game</TableHead>
                <TableHead>Set</TableHead>
                <TableHead>Rarity</TableHead>
                <TableHead className="text-right">Estimated Price</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading && (
                <TableRow>
                  <TableCell colSpan={6} className="h-40 text-center text-sm text-muted-foreground">
                    <div className="flex items-center justify-center gap-2">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Loading collection data...
                    </div>
                  </TableCell>
                </TableRow>
              )}
              {!isLoading && sortedCards.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="h-40 text-center text-sm text-muted-foreground">
                    No cards matched your filters.
                  </TableCell>
                </TableRow>
              )}
              {sortedCards.map((card) => {
                const estimatedPrice = Number((card.attributes?.price as number | undefined) ?? 0) ||
                  Math.random() * 10 + 1;
                return (
                  <TableRow key={card.id} data-state={selectedRows[card.id] ? 'selected' : undefined}>
                    <TableCell>
                      <Checkbox
                        checked={!!selectedRows[card.id]}
                        onCheckedChange={() => toggleRow(card.id)}
                        aria-label={`Select ${card.name}`}
                      />
                    </TableCell>
                    <TableCell className="font-medium">{card.name}</TableCell>
                    <TableCell>{GAME_LABELS[card.tcg]}</TableCell>
                    <TableCell>{card.setName ?? card.setCode ?? 'Unknown'}</TableCell>
                    <TableCell>{card.rarity ?? 'N/A'}</TableCell>
                    <TableCell className="text-right">${estimatedPrice.toFixed(2)}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </ScrollArea>
      </CardContent>
    </Card>
  );
}
