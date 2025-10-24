'use client';

import Image from 'next/image';
import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
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
import { hexToRgba, normalizeHexColor } from '@/lib/color';
import type { Collection as CollectionEntity } from '@/lib/api/collections';
import { LIBRARY_COLLECTION_ID } from '@/lib/api/collections';
import { ALL_COLLECTION_ID, useCollectionData } from '@/lib/hooks/use-collection';
import { useGameFilterStore } from '@/stores/game-filter';
import { useModuleStore } from '@/stores/preferences';
import type { CollectionCard, TcgCode } from '@/types/card';
import { useCollectionsStore } from '@/stores/collections';
import { useAuthStore } from '@/stores/auth';

export function CollectionTable() {
  const selectedGame = useGameFilterStore((state) => state.selectedGame);
  const token = useAuthStore((state) => state.token);
  const { collections, addCollection, removeCollection } = useCollectionsStore((state) => ({
    collections: state.collections,
    addCollection: state.addCollection,
    removeCollection: state.removeCollection
  }));
  const { enabledGames, showPricing } = useModuleStore((state) => ({
    enabledGames: state.enabledGames,
    showPricing: state.showPricing
  }));
  const [activeCollectionId, setActiveCollectionId] = useState<string>(collections.length ? ALL_COLLECTION_ID : '');
  const [searchTerm, setSearchTerm] = useState('');
  const [sortBy, setSortBy] = useState<'name' | 'rarity' | 'price'>('name');
  const [isFilterOpen, setFilterOpen] = useState(false);
  const [rarityFilter, setRarityFilter] = useState<string>('all');
  const [priceRange, setPriceRange] = useState<[number, number]>([0, 100]);
  const [selection, setSelection] = useState<Record<string, boolean>>({});
  const previousCollectionId = useRef<string | null>(null);
  const [isCreateDialogOpen, setCreateDialogOpen] = useState(false);
  const searchParams = useSearchParams();
  const router = useRouter();

  const changeActiveCollection = (id: string, updateUrl = true) => {
    setActiveCollectionId(id);
    if (!updateUrl) return;
    const search = id
      ? `?binder=${id === ALL_COLLECTION_ID ? 'all' : encodeURIComponent(id)}`
      : '';
    router.replace(`/collections${search}`, { scroll: false });
  };

  useEffect(() => {
    if (!showPricing && sortBy === 'price') {
      setSortBy('name');
    }
  }, [showPricing, sortBy]);

  useEffect(() => {
    if (!collections.length) {
      if (activeCollectionId !== '') {
        changeActiveCollection('', false);
        router.replace('/collections', { scroll: false });
      }
      return;
    }

    const binderFromQuery = searchParams.get('binder');
    const normalizedQueryId = binderFromQuery === 'all' ? ALL_COLLECTION_ID : binderFromQuery;

    if (normalizedQueryId) {
      const available =
        normalizedQueryId === ALL_COLLECTION_ID || collections.some((collection) => collection.id === normalizedQueryId);
      if (available && normalizedQueryId !== activeCollectionId) {
        changeActiveCollection(normalizedQueryId, false);
        return;
      }
    }

    const isValidActive =
      activeCollectionId === ALL_COLLECTION_ID || collections.some((collection) => collection.id === activeCollectionId);

    if (!isValidActive) {
      changeActiveCollection(ALL_COLLECTION_ID);
    }
  }, [collections, activeCollectionId, searchParams, router]);

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
  const activeAccent = normalizeHexColor(collection?.colorHex);
  const activeCardGlow = activeAccent ? hexToRgba(activeAccent, 0.22) : undefined;
  const activeCardFill = activeAccent ? hexToRgba(activeAccent, 0.12) : undefined;
  const activeCardSoft = activeAccent ? hexToRgba(activeAccent, 0.05) : undefined;

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

  const uniqueCardCount = useMemo(() => {
    if (!collection?.cards) return 0;
    return new Set(collection.cards.map((card) => card.cardId ?? card.id)).size;
  }, [collection]);

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
        onSelect={(id) => changeActiveCollection(id)}
        onCreate={() => setCreateDialogOpen(true)}
        onRemove={(id) => {
          if (confirm('Remove this binder? Cards in the binder will not be recoverable unless re-imported.')) {
            if (token) {
              removeCollection(token, id);
            }
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

      <Card
        style={
          activeAccent
            ? {
                borderColor: activeAccent,
                boxShadow: activeCardGlow ? `0 20px 32px -24px ${activeCardGlow}` : undefined,
                backgroundImage:
                  activeCardFill && activeCardSoft
                    ? `linear-gradient(135deg, ${activeCardFill} 0%, ${activeCardSoft} 100%)`
                    : undefined
              }
            : undefined
        }
      >
        <CardHeader className="flex flex-col gap-4 border-b pb-4 md:flex-row md:items-center md:justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              {activeAccent ? (
                <span
                  className="inline-flex h-2.5 w-2.5 rounded-full"
                  style={{ backgroundColor: activeAccent }}
                  aria-hidden="true"
                />
              ) : null}
              <span>{collection?.name ?? 'Collection Manager'}</span>
            </CardTitle>
            <CardDescription>
              {collection?.description ?? 'Manage quantities, review price trends, and prepare CSV exports for grading or trading.'}
              {collection && (
                <span className="mt-1 block text-xs text-muted-foreground">
                  {uniqueCardCount} unique cards
                  {collection.id === ALL_COLLECTION_ID ? ` across ${collections.length} binder(s)` : ''} • Updated
                  {' '}
                  {new Date(collection.updatedAt).toLocaleDateString()}
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
                              showBinderName={collection?.id === ALL_COLLECTION_ID}
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
        onCreate={async ({ name, description }) => {
          if (token) {
            const id = await addCollection(token, { name, description });
            changeActiveCollection(id);
          }
        }}
      />
    </div>
  );
}

function CollectionRow({
  card,
  selected,
  onToggle,
  showPricing,
  showBinderName
}: {
  card: CollectionCard;
  selected: boolean;
  onToggle: () => void;
  showPricing: boolean;
  showBinderName: boolean;
}) {
  const price = card.price ?? 0;
  const previousPrice =
    card.priceHistory && card.priceHistory.length > 1 ? card.priceHistory[card.priceHistory.length - 2] : price;
  const delta = previousPrice ? ((price - previousPrice) / previousPrice) * 100 : 0;
  const positive = delta >= 0;
  const binderAccent = normalizeHexColor(card.binderColorHex);
  const binderChipStyle: CSSProperties | undefined = binderAccent
    ? {
        backgroundColor: hexToRgba(binderAccent, 0.18),
        color: binderAccent
      }
    : undefined;

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
            {showBinderName && card.binderName ? (
              <p className="text-[11px] text-muted-foreground">
                Binder{' '}
                <span
                  className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-medium text-foreground"
                  style={binderChipStyle}
                >
                  {binderAccent ? (
                    <span
                      className="inline-flex h-2.5 w-2.5 rounded-full"
                      style={{ backgroundColor: binderAccent }}
                      aria-hidden="true"
                    />
                  ) : null}
                  <span style={{ color: binderAccent ?? undefined }}>{card.binderName}</span>
                </span>
              </p>
            ) : null}
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
  collections: CollectionEntity[];
  activeId: string;
  onSelect: (id: string) => void;
  onCreate: () => void;
  onRemove: (id: string) => void;
  showPricing: boolean;
}) {
  if (!collections.length) {
    return (
      <div className="flex flex-col gap-4 rounded-xl border border-dashed bg-muted/30 p-6 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-1 text-sm text-muted-foreground">
          <p>No binders yet. Create your first binder to get started.</p>
          <p className="text-xs">Once you add cards, they will appear in the All cards view.</p>
        </div>
        <Button onClick={onCreate} className="gap-2 self-start sm:self-auto">
          <Plus className="h-4 w-4" /> New binder
        </Button>
      </div>
    );
  }

  const aggregateStats = collections.reduce(
    (acc, binder) => {
      binder.cards.forEach((card) => {
        acc.uniqueGames.add(card.tcg);
        acc.uniqueCardIds.add(card.cardId ?? card.id);
        acc.totalCopies += card.quantity;
        acc.totalValue += (card.price ?? 0) * card.quantity;
      });
      const updatedAt = new Date(binder.updatedAt).getTime();
      if (Number.isFinite(updatedAt) && updatedAt > acc.latestUpdated) {
        acc.latestUpdated = updatedAt;
      }
      return acc;
    },
    {
      uniqueGames: new Set<string>(),
      uniqueCardIds: new Set<string>(),
      totalCopies: 0,
      totalValue: 0,
      latestUpdated: 0
    }
  );

  const aggregateUpdatedLabel = aggregateStats.latestUpdated
    ? new Date(aggregateStats.latestUpdated).toLocaleDateString()
    : '—';

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" size="sm" className="gap-2" onClick={onCreate}>
          <Plus className="h-4 w-4" /> New binder
        </Button>
      </div>

      <div className="overflow-hidden rounded-lg border bg-card">
        <SelectorRow
          title="All cards"
          description="Review every binder at once."
          badgeText={`ALL · ${collections.length} binder${collections.length === 1 ? '' : 's'}`}
          stats={[
            `${aggregateStats.uniqueGames.size} game${aggregateStats.uniqueGames.size === 1 ? '' : 's'}`,
            `${aggregateStats.uniqueCardIds.size} unique`,
            `${aggregateStats.totalCopies} copies`
          ]}
          value={showPricing ? `$${aggregateStats.totalValue.toFixed(2)}` : undefined}
          updatedLabel={aggregateUpdatedLabel}
          active={activeId === ALL_COLLECTION_ID}
          onClick={() => onSelect(ALL_COLLECTION_ID)}
        />

        {collections.map((collection) => {
          const uniqueGames = new Set(collection.cards.map((card) => card.tcg)).size;
          const uniqueCards = new Set(collection.cards.map((card) => card.cardId ?? card.id)).size;
          const totalCopies = collection.cards.reduce((sum, card) => sum + card.quantity, 0);
          const totalValue = collection.cards.reduce((sum, card) => sum + (card.price ?? 0) * card.quantity, 0);
          const accentColor = normalizeHexColor(collection.colorHex);
          const isLibrary = collection.id === LIBRARY_COLLECTION_ID;

          return (
            <SelectorRow
              key={collection.id}
              title={collection.name}
              description={collection.description || (isLibrary ? 'Cards not yet assigned to a binder' : undefined)}
              badgeText={`${uniqueGames} game${uniqueGames === 1 ? '' : 's'}`}
              stats={[`${uniqueCards} unique`, `${totalCopies} copies`]}
              value={showPricing ? `$${totalValue.toFixed(2)}` : undefined}
              updatedLabel={new Date(collection.updatedAt).toLocaleDateString()}
              active={collection.id === activeId}
              onClick={() => onSelect(collection.id)}
              onRemove={collections.length > 1 ? () => onRemove(collection.id) : undefined}
              accentColor={accentColor}
            />
          );
        })}
      </div>
    </div>
  );
}

function SelectorRow({
  title,
  description,
  badgeText,
  stats,
  value,
  updatedLabel,
  active,
  onClick,
  onRemove,
  accentColor
}: {
  title: string;
  description?: string;
  badgeText?: string;
  stats?: string[];
  value?: string;
  updatedLabel?: string;
  active: boolean;
  onClick: () => void;
  onRemove?: () => void;
  accentColor?: string;
}) {
  const accent = normalizeHexColor(accentColor);
  const baseGlow = accent ? hexToRgba(accent, active ? 0.32 : 0.18) : undefined;
  const softFill = accent ? hexToRgba(accent, active ? 0.24 : 0.14) : undefined;
  const lighterFill = accent ? hexToRgba(accent, 0.06) : undefined;
  const rowStyle: CSSProperties = {};
  if (accent) {
    rowStyle.borderLeftColor = accent;
    if (softFill) {
      rowStyle.backgroundImage = lighterFill
        ? `linear-gradient(135deg, ${softFill} 0%, ${lighterFill} 100%)`
        : undefined;
    }
    if (baseGlow) {
      rowStyle.boxShadow = `0 16px 26px -18px ${baseGlow}`;
    }
  }

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onClick();
        }
      }}
      className={cn(
        'flex flex-col gap-3 border-l-4 border-l-transparent px-4 py-3 transition hover:bg-muted/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 sm:flex-row sm:items-center sm:justify-between',
        active
          ? accent
            ? 'ring-1 ring-offset-2'
            : 'bg-primary/5 ring-1 ring-primary/40'
          : ''
      )}
      style={rowStyle}
    >
      <div className="flex-1 space-y-1">
        <div className="flex items-center gap-2">
          {accent ? (
            <span
              className="inline-flex h-2.5 w-2.5 rounded-full"
              style={{ backgroundColor: accent }}
              aria-hidden="true"
            />
          ) : null}
          <span className="text-sm font-semibold" style={{ color: accent && active ? accent : undefined }}>
            {title}
          </span>
          {badgeText ? (
            <Badge variant="outline" className="uppercase text-[10px]">
              {badgeText}
            </Badge>
          ) : null}
        </div>
        {description ? <p className="text-xs text-muted-foreground line-clamp-2">{description}</p> : null}
        {stats && stats.length ? (
          <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
            {stats.map((stat) => (
              <span key={stat}>{stat}</span>
            ))}
          </div>
        ) : null}
      </div>
      <div className="flex items-start gap-3">
        <div className="flex flex-col items-end text-[11px] text-muted-foreground">
          {value ? (
            <span
              className="text-sm font-semibold"
              style={{ color: accent && !active ? accent : undefined }}
            >
              {value}
            </span>
          ) : null}
          {updatedLabel ? <span>Updated {updatedLabel}</span> : null}
        </div>
        {onRemove ? (
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onRemove();
            }}
            className="rounded-full p-1 text-muted-foreground transition hover:text-destructive focus:outline-none focus-visible:ring-1 focus-visible:ring-destructive"
            aria-label={`Delete ${title}`}
          >
            <Trash className="h-3.5 w-3.5" />
          </button>
        ) : null}
      </div>
    </div>
  );
}
