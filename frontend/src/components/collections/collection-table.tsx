'use client';

import Image from 'next/image';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Download, Filter, Loader2, Plus, RefreshCcw, Trash, TrendingUp } from 'lucide-react';

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
import { cn, GAME_LABELS, type SupportedGame } from '@/lib/utils';
import type { SampleCollection } from '@/lib/data/sample-collections';
import { useCollectionData } from '@/lib/hooks/use-collection';
import { useGameFilterStore } from '@/stores/game-filter';
import { useModuleStore } from '@/stores/preferences';
import type { CollectionCard, TcgCode } from '@/types/card';
import { useCollectionsStore } from '@/stores/collections';

export function CollectionTable() {
  const selectedGame = useGameFilterStore((state) => state.selectedGame);
  const { collections, addCollection, removeCollection } = useCollectionsStore((state) => ({
    collections: state.collections,
    addCollection: state.addCollection,
    removeCollection: state.removeCollection
  }));
  const { enabledGames, showPricing } = useModuleStore((state) => ({
    enabledGames: state.enabledGames,
    showPricing: state.showPricing
  }));
  const [activeCollectionId, setActiveCollectionId] = useState<string>(collections[0]?.id ?? '');
  const [searchTerm, setSearchTerm] = useState('');
  const [sortBy, setSortBy] = useState<'name' | 'rarity' | 'price'>('name');
  const [isFilterOpen, setFilterOpen] = useState(false);
  const [rarityFilter, setRarityFilter] = useState<string>('all');
  const [priceRange, setPriceRange] = useState<[number, number]>([0, 100]);
  const [selection, setSelection] = useState<Record<string, boolean>>({});
  const previousCollectionId = useRef<string | null>(null);
  const [isCreateDialogOpen, setCreateDialogOpen] = useState(false);

  useEffect(() => {
    if (!showPricing && sortBy === 'price') {
      setSortBy('name');
    }
  }, [showPricing, sortBy]);

  useEffect(() => {
    if (!collections.some((collection) => collection.id === activeCollectionId)) {
      setActiveCollectionId(collections[0]?.id ?? '');
    }
  }, [collections, activeCollectionId]);

  useEffect(() => {
    setSelection({});
    setSearchTerm('');
    setRarityFilter('all');
  }, [activeCollectionId]);

  const { collection, items, isLoading, maxPrice, totalQuantity, totalValue } = useCollectionData({
    collectionId: activeCollectionId,
    query: searchTerm,
    game: selectedGame as SupportedGame | 'all',
    enabledGames
  });

  const selectedGameDisabled = selectedGame !== 'all' && !enabledGames[selectedGame as keyof typeof enabledGames];
  const noGamesEnabled = !enabledGames.yugioh && !enabledGames.magic && !enabledGames.pokemon;

  const defaultMaxPrice = useMemo(() => Math.max(Math.ceil(maxPrice || 50), 10), [maxPrice]);

  useEffect(() => {
    const upperBound = defaultMaxPrice;
    setPriceRange((prev) => {
      const isNewCollection = previousCollectionId.current !== collection?.id;
      previousCollectionId.current = collection?.id ?? null;

      if (!showPricing) {
        return [0, upperBound];
      }

      const nextMin = isNewCollection ? 0 : Math.min(prev[0], upperBound);
      return [nextMin, upperBound];
    });
  }, [collection?.id, defaultMaxPrice, showPricing]);

  const rarityOptions = useMemo(() => {
    const unique = new Set<string>();
    items.forEach((card) => card.rarity && unique.add(card.rarity));
    return Array.from(unique).sort((a, b) => a.localeCompare(b));
  }, [items]);

  const filtered = useMemo(() => {
    return items.filter((card) => {
      if (rarityFilter !== 'all' && card.rarity !== rarityFilter) return false;
      if (showPricing) {
        const cardPrice = card.price ?? 0;
        if (cardPrice < priceRange[0] || cardPrice > priceRange[1]) return false;
      }
      return true;
    });
  }, [items, priceRange, rarityFilter, showPricing]);

  const sortedCards = useMemo(() => {
    return [...filtered].sort((a, b) => compareCards(a, b, sortBy, showPricing));
  }, [filtered, sortBy, showPricing]);

  const selectedIds = useMemo(
    () => Object.entries(selection).filter(([, checked]) => checked).map(([id]) => id),
    [selection]
  );

  const groupedByGame = useMemo(() => {
    const map = new Map<TcgCode, CollectionCard[]>();
    sortedCards.forEach((card) => {
      if (!map.has(card.tcg)) {
        map.set(card.tcg, []);
      }
      map.get(card.tcg)!.push(card);
    });
    return Array.from(map.entries());
  }, [sortedCards]);

  const toggleRow = (id: string) => {
    setSelection((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const handleExport = () => {
    const exportRows = (selectedIds.length ? sortedCards.filter((card) => selection[card.id]) : sortedCards).map(
      (card) => {
        const base = {
          Name: card.name,
          Game: GAME_LABELS[card.tcg],
          Set: card.setName ?? card.setCode ?? 'Unknown',
          Rarity: card.rarity ?? 'N/A',
          Quantity: card.quantity,
          Condition: card.condition ?? 'Unknown'
        } as Record<string, unknown>;

        if (showPricing) {
          base['EstimatedPrice'] = card.price ?? 0;
        }

        return base;
      }
    );

    const fallbackHeader = showPricing
      ? { Name: '', Game: '', Set: '', Rarity: '', Quantity: 0, Condition: '', EstimatedPrice: 0 }
      : { Name: '', Game: '', Set: '', Rarity: '', Quantity: 0, Condition: '' };
    const header = Object.keys(exportRows[0] ?? fallbackHeader);
    const csvLines = [header.join(','), ...exportRows.map((row) => header.map((key) => formatCsvValue(row[key as keyof typeof row])).join(','))];
    const blob = new Blob([csvLines.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const exportName = (collection?.name ?? 'collection').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `${exportName || 'collection'}-export-${Date.now()}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      <CollectionSelector
        collections={collections}
        activeId={activeCollectionId}
        onSelect={(id) => setActiveCollectionId(id)}
        onCreate={() => setCreateDialogOpen(true)}
        onRemove={(id) => {
          if (confirm('Remove this binder? Cards in the binder will not be recoverable unless re-imported.')) {
            removeCollection(id);
          }
        }}
        showPricing={showPricing}
      />

      <CollectionSummary
        items={items}
        selectedIds={selectedIds}
        totalQuantity={totalQuantity}
        totalValue={totalValue}
        showPricing={showPricing}
      />

      <Card>
        <CardHeader className="flex flex-col gap-4 border-b pb-4 md:flex-row md:items-center md:justify-between">
          <div>
            <CardTitle>{collection?.name ?? 'Collection Manager'}</CardTitle>
            <CardDescription>
              {collection?.description ?? 'Manage quantities, review price trends, and prepare CSV exports for grading or trading.'}
              {collection && (
                <span className="mt-1 block text-xs text-muted-foreground">
                  {collection.cards.length} unique cards • Updated {new Date(collection.updatedAt).toLocaleDateString()}
                </span>
              )}
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
                {showPricing && <SelectItem value="price">Estimated price</SelectItem>}
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
            showPricing={showPricing}
            defaultMax={defaultMaxPrice}
            onClear={() => resetFilters(setRarityFilter, setPriceRange, defaultMaxPrice)}
          />

          <div className="relative">
            <ScrollArea className="h-[620px] rounded-md border">
              {isLoading ? (
                <div className="flex h-full min-h-[240px] items-center justify-center text-sm text-muted-foreground">
                  <div className="flex items-center gap-2">
                    <Loader2 className="h-4 w-4 animate-spin" /> Loading collection data...
                  </div>
                </div>
              ) : groupedByGame.length === 0 ? (
                <div className="flex h-full min-h-[240px] items-center justify-center text-sm text-muted-foreground">
                  {noGamesEnabled
                    ? 'All modules are disabled. Re-enable them in settings to view your catalog.'
                    : selectedGameDisabled
                      ? 'Selected game is disabled. Enable it from module preferences to manage its collection.'
                      : 'No cards matched your filters.'}
                </div>
              ) : (
                <div className="space-y-8 p-4">
                  {groupedByGame.map(([tcg, cardsForGame]) => {
                    const gameValue = cardsForGame.reduce((sum, card) => sum + (card.price ?? 0) * card.quantity, 0);
                    const gameQuantity = cardsForGame.reduce((sum, card) => sum + card.quantity, 0);

                    return (
                      <div key={tcg} className="space-y-3">
                        <div className="flex items-center justify-between">
                          <div>
                            <h3 className="text-sm font-semibold">{GAME_LABELS[tcg as keyof typeof GAME_LABELS]}</h3>
                            <p className="text-xs text-muted-foreground">
                              {cardsForGame.length} card(s), {gameQuantity} copies
                              {showPricing ? ` • $${gameValue.toFixed(2)}` : ''}
                            </p>
                          </div>
                          <Badge variant="outline" className="uppercase">
                            {GAME_LABELS[tcg as keyof typeof GAME_LABELS] ?? tcg}
                          </Badge>
                        </div>

                        <Table>
                          <TableHeader className="bg-muted/30">
                            <TableRow>
                              <TableHead className="w-10">
                                <Checkbox
                                  checked={cardsForGame.every((card) => selection[card.id])}
                                  onCheckedChange={(checked) =>
                                    setSelection((prev) => {
                                      const next = { ...prev };
                                      if (checked) {
                                        cardsForGame.forEach((card) => {
                                          next[card.id] = true;
                                        });
                                      } else {
                                        cardsForGame.forEach((card) => {
                                          delete next[card.id];
                                        });
                                      }
                                      return next;
                                    })
                                  }
                                  aria-label={`Select all ${GAME_LABELS[tcg as keyof typeof GAME_LABELS]} cards`}
                                />
                              </TableHead>
                              <TableHead>Name</TableHead>
                              <TableHead>Set</TableHead>
                              <TableHead>Rarity</TableHead>
                              <TableHead className="text-right">Quantity</TableHead>
                              <TableHead className="text-right">Condition</TableHead>
                              {showPricing && <TableHead className="text-right">Est. Price</TableHead>}
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {cardsForGame.map((card) => (
                              <CollectionRow
                                key={card.id}
                                card={card}
                                selected={!!selection[card.id]}
                                onToggle={() => toggleRow(card.id)}
                                showPricing={showPricing}
                              />
                            ))}
                          </TableBody>
                        </Table>
                      </div>
                    );
                  })}
                </div>
              )}
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
        showPricing={showPricing}
        onApply={(rarity, range) => {
          setRarityFilter(rarity);
          setPriceRange(range);
        }}
      />

      <CreateCollectionDialog
        open={isCreateDialogOpen}
        onOpenChange={setCreateDialogOpen}
        onCreate={({ name, description }) => {
          const id = addCollection({ name, description });
          setActiveCollectionId(id);
        }}
      />
    </div>
  );
}

function CollectionRow({
  card,
  selected,
  onToggle,
  showPricing
}: {
  card: CollectionCard;
  selected: boolean;
  onToggle: () => void;
  showPricing: boolean;
}) {
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
      <TableCell>{card.setName ?? card.setCode ?? 'Unknown'}</TableCell>
      <TableCell>{card.rarity ?? 'N/A'}</TableCell>
      <TableCell className="text-right">{card.quantity}</TableCell>
      <TableCell className="text-right">{card.condition ?? 'Unknown'}</TableCell>
      {showPricing && (
        <TableCell className="text-right">
          <div className="flex flex-col items-end gap-1">
            <span className="font-medium">${price.toFixed(2)}</span>
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger
                  className={`flex items-center gap-1 text-xs ${positive ? 'text-emerald-500' : 'text-red-500'}`}
                >
                  <TrendingUp className="h-3 w-3" />
                  {positive ? '+' : ''}
                  {delta.toFixed(1)}%
                </TooltipTrigger>
                <TooltipContent>Change versus previous sync snapshot.</TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
        </TableCell>
      )}
    </TableRow>
  );
}

function CreateCollectionDialog({
  open,
  onOpenChange,
  onCreate
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreate: (input: { name: string; description: string }) => void;
}) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');

  useEffect(() => {
    if (!open) {
      setName('');
      setDescription('');
    }
  }, [open]);

  const handleSubmit = () => {
    const trimmedName = name.trim();
    if (!trimmedName) {
      return;
    }
    onCreate({ name: trimmedName, description: description.trim() });
    setName('');
    setDescription('');
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Create new binder</DialogTitle>
          <DialogDescription>Organize cards by creating dedicated binders for decks, sets, or trades.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="collection-name">Name</Label>
            <Input
              id="collection-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="e.g., Commander Staples"
              autoFocus
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="collection-description">Description</Label>
            <Input
              id="collection-description"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="Optional summary"
            />
          </div>
        </div>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="button" onClick={handleSubmit} disabled={!name.trim()}>
            Create binder
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
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
  showPricing,
  onApply
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  rarity: string;
  rarities: string[];
  priceRange: [number, number];
  maxPrice: number;
  showPricing: boolean;
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
          <DialogDescription>
            {showPricing
              ? 'Narrow down your collection by rarity and price range.'
              : 'Filter your collection by rarity.'}
          </DialogDescription>
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

          {showPricing && (
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
          )}
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
  showPricing,
  defaultMax,
  onClear
}: {
  rarity: string;
  priceRange: [number, number];
  showPricing: boolean;
  defaultMax: number;
  onClear: () => void;
}) {
  const hasRarity = rarity !== 'all';
  const hasPrice = showPricing && (priceRange[0] !== 0 || priceRange[1] !== defaultMax);

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

function compareCards(a: CollectionCard, b: CollectionCard, sortBy: 'name' | 'rarity' | 'price', showPricing: boolean) {
  if (sortBy === 'price' && showPricing) {
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

function CollectionSelector({
  collections,
  activeId,
  onSelect,
  onCreate,
  onRemove,
  showPricing
}: {
  collections: SampleCollection[];
  activeId: string;
  onSelect: (id: string) => void;
  onCreate: () => void;
  onRemove: (id: string) => void;
  showPricing: boolean;
}) {
  if (!collections.length) {
    return (
      <div className="rounded-xl border border-dashed bg-muted/30 p-6 text-sm text-muted-foreground">
        No collections yet. Start by importing cards or creating a binder from the account menu.
      </div>
    );
  }

  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      <button
        type="button"
        onClick={onCreate}
        className="flex h-full min-h-[140px] flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-muted-foreground/40 p-6 text-sm font-medium text-muted-foreground transition hover:border-primary/60 hover:text-primary focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2"
      >
        <span className="flex h-10 w-10 items-center justify-center rounded-full border border-current">
          <Plus className="h-4 w-4" />
        </span>
        New binder
      </button>
      {collections.map((collection) => {
        const isActive = collection.id === activeId;
        const uniqueGames = new Set(collection.cards.map((card) => card.tcg));
        const uniqueCards = collection.cards.length;
        const totalCopies = collection.cards.reduce((sum, card) => sum + card.quantity, 0);
        const totalValue = collection.cards.reduce((sum, card) => sum + (card.price ?? 0) * card.quantity, 0);

        return (
          <button
            key={collection.id}
            type="button"
            onClick={() => onSelect(collection.id)}
            aria-pressed={isActive}
            className={cn(
              'group rounded-xl border p-4 text-left transition focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2',
              isActive ? 'border-primary bg-primary/5 shadow-md' : 'border-border bg-card hover:border-primary/40 hover:bg-muted/40'
            )}
          >
            <div className="flex items-center justify-between gap-4">
              <div>
                <h3 className="text-sm font-semibold text-foreground">{collection.name}</h3>
                <p className="mt-1 text-xs text-muted-foreground line-clamp-2">{collection.description}</p>
              </div>
              <div className="flex items-center gap-2">
                <Badge variant="outline" className="uppercase text-[10px]">
                  {uniqueGames.size} games
                </Badge>
                {collections.length > 1 && (
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      onRemove(collection.id);
                    }}
                    className="rounded-full border border-transparent p-1 text-muted-foreground transition hover:border-destructive/40 hover:text-destructive focus:outline-none focus:ring-1 focus:ring-destructive"
                    aria-label={`Delete ${collection.name}`}
                  >
                    <Trash className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            </div>
            <div className="mt-4 flex items-center justify-between text-[11px] text-muted-foreground">
              <span>{uniqueCards} unique cards</span>
              <span>{totalCopies} copies</span>
            </div>
            {showPricing && (
              <div className="mt-2 text-sm font-semibold text-foreground">
                ${totalValue.toFixed(2)}
              </div>
            )}
            <p className="mt-2 text-[10px] text-muted-foreground">
              Updated {new Date(collection.updatedAt).toLocaleDateString()}
            </p>
          </button>
        );
      })}
    </div>
  );
}
