'use client';

import Image from 'next/image';
import { useEffect, useMemo, useState } from 'react';
import { Download, Filter, Loader2, RefreshCcw, TrendingUp } from 'lucide-react';

import { CollectionSummary } from '@/components/collections/collection-summary';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Slider } from '@/components/ui/slider';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { GAME_LABELS, type SupportedGame } from '@/lib/utils';
import { useCollectionData } from '@/lib/hooks/use-collection';
import { useGameFilterStore } from '@/stores/game-filter';
import { useModuleStore } from '@/stores/preferences';
import type { CollectionCard } from '@/types/card';

export function CollectionTable() {
  const selectedGame = useGameFilterStore((state) => state.selectedGame);
  const enabledGames = useModuleStore((state) => state.enabledGames);
  const [searchTerm, setSearchTerm] = useState('');
  const [sortBy, setSortBy] = useState<'name' | 'rarity' | 'price'>('name');
  const [isFilterOpen, setFilterOpen] = useState(false);
  const [rarityFilter, setRarityFilter] = useState<string>('all');
  const [priceRange, setPriceRange] = useState<[number, number]>([0, 100]);
  const [selection, setSelection] = useState<Record<string, boolean>>({});

  const { items, isLoading, maxPrice, totalQuantity, totalValue } = useCollectionData({
    query: searchTerm,
    game: selectedGame as SupportedGame | 'all',
    enabledGames
  });

  const selectedGameDisabled = selectedGame !== 'all' && !enabledGames[selectedGame as keyof typeof enabledGames];
  const noGamesEnabled = !enabledGames.yugioh && !enabledGames.magic && !enabledGames.pokemon;

  const defaultMaxPrice = useMemo(() => Math.max(Math.ceil(maxPrice || 50), 10), [maxPrice]);

  useEffect(() => {
    const upperBound = defaultMaxPrice;
    setPriceRange(([min]) => [min > upperBound ? 0 : min, upperBound]);
  }, [defaultMaxPrice]);

  const rarityOptions = useMemo(() => {
    const unique = new Set<string>();
    items.forEach((card) => card.rarity && unique.add(card.rarity));
    return Array.from(unique).sort((a, b) => a.localeCompare(b));
  }, [items]);

  const filtered = useMemo(() => {
    return items.filter((card) => {
      if (rarityFilter !== 'all' && card.rarity !== rarityFilter) return false;
      const cardPrice = card.price ?? 0;
      if (cardPrice < priceRange[0] || cardPrice > priceRange[1]) return false;
      return true;
    });
  }, [items, priceRange, rarityFilter]);

  const sortedCards = useMemo(() => {
    return [...filtered].sort((a, b) => compareCards(a, b, sortBy));
  }, [filtered, sortBy]);

  const allSelected = useMemo(
    () => sortedCards.length > 0 && sortedCards.every((card) => selection[card.id]),
    [sortedCards, selection]
  );
  const selectedIds = useMemo(
    () => Object.entries(selection).filter(([, checked]) => checked).map(([id]) => id),
    [selection]
  );

  const toggleRow = (id: string) => {
    setSelection((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const toggleAll = () => {
    setSelection((prev) => {
      if (allSelected) {
        const next = { ...prev };
        sortedCards.forEach((card) => {
          delete next[card.id];
        });
        return next;
      }
      const next = { ...prev };
      sortedCards.forEach((card) => {
        next[card.id] = true;
      });
      return next;
    });
  };

  const handleExport = () => {
    const exportRows = (selectedIds.length ? sortedCards.filter((card) => selection[card.id]) : sortedCards).map(
      (card) => ({
        Name: card.name,
        Game: GAME_LABELS[card.tcg],
        Set: card.setName ?? card.setCode ?? 'Unknown',
        Rarity: card.rarity ?? 'N/A',
        Quantity: card.quantity,
        Condition: card.condition ?? 'Unknown',
        EstimatedPrice: card.price ?? 0
      })
    );

    const header = Object.keys(exportRows[0] ?? { Name: '', Game: '', Set: '', Rarity: '', Quantity: 0, Condition: '', EstimatedPrice: 0 });
    const csvLines = [header.join(','), ...exportRows.map((row) => header.map((key) => formatCsvValue(row[key as keyof typeof row])).join(','))];
    const blob = new Blob([csvLines.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);

    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `tcg-collection-export-${Date.now()}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      <CollectionSummary items={items} selectedIds={selectedIds} totalQuantity={totalQuantity} totalValue={totalValue} />

      <Card>
        <CardHeader className="flex flex-col gap-4 border-b pb-4 md:flex-row md:items-center md:justify-between">
          <div>
            <CardTitle>Collection Manager</CardTitle>
            <CardDescription>
              Manage quantities, review price trends, and prepare CSV exports for grading or trading.
            </CardDescription>
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
                <SelectItem value="price">Estimated price</SelectItem>
              </SelectContent>
            </Select>
            <Button variant="outline" size="sm" className="gap-2" onClick={() => setFilterOpen(true)}>
              <Filter className="h-4 w-4" />
              Filters
            </Button>
            <Button size="sm" className="gap-2" onClick={handleExport} disabled={sortedCards.length === 0}>
              <Download className="h-4 w-4" />
              Export
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <ActiveFilters
            rarity={rarityFilter}
            priceRange={priceRange}
            defaultMax={defaultMaxPrice}
            onClear={() => resetFilters(setRarityFilter, setPriceRange, defaultMaxPrice)}
          />

          <div className="relative">
            <ScrollArea className="h-[620px] rounded-md border">
              <Table>
                <TableHeader className="bg-muted/40">
                  <TableRow>
                    <TableHead className="w-10">
                      <Checkbox checked={allSelected} onCheckedChange={toggleAll} aria-label="Select all" />
                    </TableHead>
                    <TableHead>Name</TableHead>
                    <TableHead>Game</TableHead>
                    <TableHead>Set</TableHead>
                    <TableHead>Rarity</TableHead>
                    <TableHead className="text-right">Quantity</TableHead>
                    <TableHead className="text-right">Condition</TableHead>
                    <TableHead className="text-right">Estimated Price</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isLoading && (
                    <TableRow>
                      <TableCell colSpan={8} className="h-40 text-center text-sm text-muted-foreground">
                        <div className="flex items-center justify-center gap-2">
                          <Loader2 className="h-4 w-4 animate-spin" />
                          Loading collection data...
                        </div>
                      </TableCell>
                    </TableRow>
                  )}
                  {!isLoading && (sortedCards.length === 0 || selectedGameDisabled || noGamesEnabled) && (
                    <TableRow>
                      <TableCell colSpan={8} className="h-40 text-center text-sm text-muted-foreground">
                        {noGamesEnabled
                          ? 'All modules are disabled. Re-enable them in settings to view your catalog.'
                          : selectedGameDisabled
                            ? 'Selected game is disabled. Enable it from module preferences to manage its collection.'
                            : 'No cards matched your filters.'}
                      </TableCell>
                    </TableRow>
                  )}
                  {sortedCards.map((card) => (
                    <CollectionRow
                      key={card.id}
                      card={card}
                      selected={!!selection[card.id]}
                      onToggle={() => toggleRow(card.id)}
                    />
                  ))}
                </TableBody>
              </Table>
            </ScrollArea>
          </div>
        </CardContent>
      </Card>

      <FilterDialog
        open={isFilterOpen}
        onOpenChange={setFilterOpen}
        rarity={rarityFilter}
        rarities={rarityOptions}
        priceRange={priceRange}
        maxPrice={defaultMaxPrice}
        onApply={(rarity, range) => {
          setRarityFilter(rarity);
          setPriceRange(range);
        }}
      />
    </div>
  );
}

function CollectionRow({ card, selected, onToggle }: { card: CollectionCard; selected: boolean; onToggle: () => void }) {
  const price = card.price ?? 0;
  const previousPrice =
    card.priceHistory && card.priceHistory.length > 1 ? card.priceHistory[card.priceHistory.length - 2] : price;
  const delta = previousPrice ? ((price - previousPrice) / previousPrice) * 100 : 0;
  const positive = delta >= 0;

  return (
    <TableRow data-state={selected ? 'selected' : undefined}>
      <TableCell className="align-top">
        <Checkbox checked={selected} onCheckedChange={onToggle} aria-label={`Select ${card.name}`} />
      </TableCell>
      <TableCell>
        <div className="flex items-center gap-3">
          <CardAvatar card={card} />
          <div>
            <p className="font-medium leading-tight">{card.name}</p>
            <p className="text-xs text-muted-foreground">
              {card.setName ?? card.setCode ?? 'Unknown set'} · #{card.setCode ?? '—'}
            </p>
          </div>
        </div>
      </TableCell>
      <TableCell>
        <Badge variant="outline">{GAME_LABELS[card.tcg]}</Badge>
      </TableCell>
      <TableCell>{card.setName ?? card.setCode ?? 'Unknown'}</TableCell>
      <TableCell>{card.rarity ?? 'N/A'}</TableCell>
      <TableCell className="text-right">{card.quantity}</TableCell>
      <TableCell className="text-right">{card.condition ?? 'Unknown'}</TableCell>
      <TableCell className="text-right">
        <div className="flex flex-col items-end gap-1">
          <span className="font-medium">${price.toFixed(2)}</span>
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger className={`flex items-center gap-1 text-xs ${positive ? 'text-emerald-500' : 'text-red-500'}`}>
                <TrendingUp className="h-3 w-3" />
                {positive ? '+' : ''}
                {delta.toFixed(1)}%
              </TooltipTrigger>
              <TooltipContent>Change versus previous sync snapshot.</TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
      </TableCell>
    </TableRow>
  );
}

function CardAvatar({ card }: { card: CollectionCard }) {
  if (card.imageUrlSmall) {
    return (
      <div className="relative h-12 w-9 overflow-hidden rounded-md border bg-muted/30">
        <Image
          src={card.imageUrlSmall}
          alt={card.name}
          fill
          className="object-cover"
          sizes="40px"
        />
      </div>
    );
  }

  if (card.setSymbolUrl) {
    return (
      <div className="flex h-12 w-12 items-center justify-center rounded-md border bg-muted/30 p-2">
        <Image src={card.setSymbolUrl} alt={`${card.setName ?? card.setCode} symbol`} width={32} height={32} />
      </div>
    );
  }

  return (
    <div className="flex h-12 w-9 items-center justify-center rounded-md border bg-muted/30 text-xs text-muted-foreground">
      No image
    </div>
  );
}

function FilterDialog({
  open,
  onOpenChange,
  rarity,
  rarities,
  priceRange,
  maxPrice,
  onApply
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  rarity: string;
  rarities: string[];
  priceRange: [number, number];
  maxPrice: number;
  onApply: (rarity: string, range: [number, number]) => void;
}) {
  const [pendingRarity, setPendingRarity] = useState(rarity);
  const [pendingRange, setPendingRange] = useState<[number, number]>(priceRange);

  useEffect(() => {
    if (open) {
      setPendingRarity(rarity);
      setPendingRange(priceRange);
    }
  }, [open, priceRange, rarity]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Filter collection</DialogTitle>
          <DialogDescription>Narrow down your collection by rarity and price range.</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="rarity-filter">Rarity</Label>
            <Select value={pendingRarity} onValueChange={setPendingRarity}>
              <SelectTrigger id="rarity-filter">
                <SelectValue placeholder="Any rarity" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All rarities</SelectItem>
                {rarities.map((r) => (
                  <SelectItem key={r} value={r}>
                    {r}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Price range</Label>
              <span className="text-xs text-muted-foreground">
                ${pendingRange[0].toFixed(2)} – ${pendingRange[1].toFixed(2)}
              </span>
            </div>
            <Slider
              value={pendingRange}
              min={0}
              max={maxPrice}
              step={1}
              onValueChange={(value) => setPendingRange(value as [number, number])}
            />
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button
            variant="ghost"
            type="button"
            onClick={() => {
              setPendingRarity('all');
              setPendingRange([0, maxPrice]);
            }}
          >
            <RefreshCcw className="mr-2 h-4 w-4" />
            Reset
          </Button>
          <Button
            type="button"
            onClick={() => {
              onApply(pendingRarity, pendingRange);
              onOpenChange(false);
            }}
          >
            Apply filters
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ActiveFilters({
  rarity,
  priceRange,
  defaultMax,
  onClear
}: {
  rarity: string;
  priceRange: [number, number];
  defaultMax: number;
  onClear: () => void;
}) {
  const hasRarity = rarity !== 'all';
  const hasPrice = priceRange[0] !== 0 || priceRange[1] !== defaultMax;

  if (!hasRarity && !hasPrice) {
    return null;
  }

  return (
    <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
      <span className="font-medium">Active filters:</span>
      {hasRarity && <Badge variant="outline">Rarity: {rarity}</Badge>}
      {hasPrice && <Badge variant="outline">Price: ${priceRange[0].toFixed(0)} – ${priceRange[1].toFixed(0)}</Badge>}
      <button type="button" className="text-primary underline" onClick={onClear}>
        Clear filters
      </button>
    </div>
  );
}

function compareCards(a: CollectionCard, b: CollectionCard, sortBy: 'name' | 'rarity' | 'price') {
  if (sortBy === 'price') {
    const priceA = a.price ?? 0;
    const priceB = b.price ?? 0;
    return priceB - priceA;
  }

  const valueA = (a[sortBy] ?? '').toString().toLowerCase();
  const valueB = (b[sortBy] ?? '').toString().toLowerCase();
  return valueA.localeCompare(valueB);
}

function formatCsvValue(value: unknown): string {
  if (value === undefined || value === null) return '""';
  const stringValue = value.toString().replace(/\"/g, '""');
  return `"${stringValue}"`;
}

function resetFilters(
  setRarity: (value: string) => void,
  setRange: (value: [number, number]) => void,
  maxPrice: number
) {
  setRarity('all');
  setRange([0, maxPrice]);
}
