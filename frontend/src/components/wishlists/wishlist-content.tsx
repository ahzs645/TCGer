'use client';

import Image from 'next/image';
import { useEffect, useMemo, useState } from 'react';
import { Check, Heart, Loader2, Plus, Search, Trash, X } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { SetSymbol } from '@/components/cards/set-symbol';
import { cn, GAME_LABELS, type SupportedGame } from '@/lib/utils';
import { normalizeHexColor } from '@/lib/color';
import { searchCardsApi } from '@/lib/api-client';
import { useAuthStore } from '@/stores/auth';
import { useWishlistsStore } from '@/stores/wishlists';
import { useGameFilterStore } from '@/stores/game-filter';
import type { WishlistResponse, WishlistCardResponse } from '@/stores/wishlists';
import type { Card as CardType, TcgCode } from '@/types/card';

const CARD_PLACEHOLDER_IMAGE = '/images/card-placeholder.jpg';

export function WishlistContent() {
  const { token, isAuthenticated } = useAuthStore();
  const { wishlists, fetchWishlists, addWishlist, removeWishlist, addCardToWishlist, removeCardFromWishlist, isLoading, hasFetched } = useWishlistsStore();
  const [activeWishlistId, setActiveWishlistId] = useState<string | null>(null);
  const [isCreateDialogOpen, setCreateDialogOpen] = useState(false);
  const [isAddCardDialogOpen, setAddCardDialogOpen] = useState(false);
  const [newWishlistName, setNewWishlistName] = useState('');
  const [newWishlistDescription, setNewWishlistDescription] = useState('');
  const [createError, setCreateError] = useState<string | null>(null);

  // Search state for adding cards
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<CardType[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [searchTcg, setSearchTcg] = useState<SupportedGame>('all');

  // Collection search state
  const [collectionSearchTerm, setCollectionSearchTerm] = useState('');
  const [filterOwned, setFilterOwned] = useState<'all' | 'owned' | 'missing'>('all');

  useEffect(() => {
    if (isAuthenticated && token && !hasFetched) {
      fetchWishlists(token);
    }
  }, [isAuthenticated, token, hasFetched, fetchWishlists]);

  useEffect(() => {
    if (wishlists.length && !activeWishlistId) {
      setActiveWishlistId(wishlists[0].id);
    }
  }, [wishlists, activeWishlistId]);

  const activeWishlist = useMemo(
    () => wishlists.find((w) => w.id === activeWishlistId) ?? null,
    [wishlists, activeWishlistId]
  );

  const filteredCards = useMemo(() => {
    if (!activeWishlist) return [];
    let cards = activeWishlist.cards;

    if (collectionSearchTerm.trim()) {
      const term = collectionSearchTerm.toLowerCase();
      cards = cards.filter(
        (c) =>
          c.name.toLowerCase().includes(term) ||
          c.setName?.toLowerCase().includes(term) ||
          c.setCode?.toLowerCase().includes(term)
      );
    }

    if (filterOwned === 'owned') {
      cards = cards.filter((c) => c.owned);
    } else if (filterOwned === 'missing') {
      cards = cards.filter((c) => !c.owned);
    }

    return cards;
  }, [activeWishlist, collectionSearchTerm, filterOwned]);

  const handleCreateWishlist = async () => {
    if (!token || !newWishlistName.trim()) return;
    setCreateError(null);
    try {
      const id = await addWishlist(token, {
        name: newWishlistName.trim(),
        description: newWishlistDescription.trim() || undefined
      });
      setActiveWishlistId(id);
      setNewWishlistName('');
      setNewWishlistDescription('');
      setCreateDialogOpen(false);
    } catch (error) {
      setCreateError(error instanceof Error ? error.message : 'Failed to create wishlist');
    }
  };

  const handleDeleteWishlist = async (wishlistId: string) => {
    if (!token) return;
    try {
      await removeWishlist(token, wishlistId);
      if (activeWishlistId === wishlistId) {
        setActiveWishlistId(wishlists.find((w) => w.id !== wishlistId)?.id ?? null);
      }
    } catch {
      // Error handled in store
    }
  };

  const handleSearch = async () => {
    if (!searchQuery.trim()) return;
    setIsSearching(true);
    try {
      const results = await searchCardsApi({
        query: searchQuery.trim(),
        tcg: searchTcg === 'all' ? undefined : searchTcg as TcgCode
      });
      setSearchResults(results);
    } catch {
      setSearchResults([]);
    } finally {
      setIsSearching(false);
    }
  };

  const handleAddCard = async (card: CardType) => {
    if (!token || !activeWishlistId) return;
    try {
      await addCardToWishlist(token, activeWishlistId, {
        externalId: card.id,
        tcg: card.tcg,
        name: card.name,
        setCode: card.setCode,
        setName: card.setName,
        rarity: card.rarity,
        imageUrl: card.imageUrl,
        imageUrlSmall: card.imageUrlSmall,
        setSymbolUrl: card.setSymbolUrl,
        setLogoUrl: card.setLogoUrl,
        collectorNumber: card.collectorNumber
      });
    } catch {
      // Error handled in store
    }
  };

  const handleRemoveCard = async (cardId: string) => {
    if (!token || !activeWishlistId) return;
    try {
      await removeCardFromWishlist(token, activeWishlistId, cardId);
    } catch {
      // Error handled in store
    }
  };

  const isCardInWishlist = (cardId: string): boolean => {
    return activeWishlist?.cards.some((c) => c.externalId === cardId) ?? false;
  };

  if (!isAuthenticated) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Sign in required</CardTitle>
          <CardDescription>Sign in to create and manage your wishlists.</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  if (!hasFetched) {
    return (
      <div className="grid gap-6 md:grid-cols-[280px_1fr]">
        <div className="space-y-4">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-32 w-full" />
        </div>
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  return (
    <>
      {/* Create Wishlist Dialog */}
      <Dialog open={isCreateDialogOpen} onOpenChange={setCreateDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create Wishlist</DialogTitle>
            <DialogDescription>
              Create a new wishlist to track cards you want to collect.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="wishlist-name">Name</Label>
              <Input
                id="wishlist-name"
                value={newWishlistName}
                onChange={(e) => setNewWishlistName(e.target.value)}
                placeholder="e.g., Every Darkrai, Eevee Collection"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="wishlist-desc">Description (optional)</Label>
              <Input
                id="wishlist-desc"
                value={newWishlistDescription}
                onChange={(e) => setNewWishlistDescription(e.target.value)}
                placeholder="What are you collecting?"
              />
            </div>
            {createError && (
              <p className="text-sm text-destructive">{createError}</p>
            )}
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setCreateDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleCreateWishlist} disabled={!newWishlistName.trim() || isLoading}>
              {isLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add Card Search Dialog */}
      <Dialog open={isAddCardDialogOpen} onOpenChange={setAddCardDialogOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Add Cards to Wishlist</DialogTitle>
            <DialogDescription>
              Search for cards to add to &ldquo;{activeWishlist?.name}&rdquo;.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <form
              className="flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                handleSearch();
              }}
            >
              <Input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search by card name..."
                className="flex-1"
              />
              <Select value={searchTcg} onValueChange={(v) => setSearchTcg(v as SupportedGame)}>
                <SelectTrigger className="w-[140px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Games</SelectItem>
                  <SelectItem value="pokemon">Pokemon</SelectItem>
                  <SelectItem value="magic">Magic</SelectItem>
                  <SelectItem value="yugioh">Yu-Gi-Oh!</SelectItem>
                </SelectContent>
              </Select>
              <Button type="submit" disabled={isSearching}>
                {isSearching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
              </Button>
            </form>
            <ScrollArea className="h-[400px]">
              <div className="space-y-2">
                {searchResults.length === 0 && !isSearching && (
                  <p className="py-8 text-center text-sm text-muted-foreground">
                    Search for cards to add to your wishlist.
                  </p>
                )}
                {searchResults.map((card) => {
                  const alreadyAdded = isCardInWishlist(card.id);
                  return (
                    <div
                      key={card.id}
                      className="flex items-center gap-3 rounded-lg border p-3"
                    >
                      <Image
                        src={card.imageUrlSmall ?? CARD_PLACEHOLDER_IMAGE}
                        alt={card.name}
                        width={40}
                        height={56}
                        className="h-14 w-10 flex-shrink-0 rounded-md object-cover"
                        loading="lazy"
                        onError={(e) => {
                          e.currentTarget.onerror = null;
                          e.currentTarget.src = CARD_PLACEHOLDER_IMAGE;
                        }}
                      />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{card.name}</p>
                        <div className="flex items-center gap-1 text-xs text-muted-foreground">
                          <SetSymbol
                            symbolUrl={card.setSymbolUrl}
                            logoUrl={card.setLogoUrl}
                            setCode={card.setCode}
                            setName={card.setName}
                            tcg={card.tcg}
                            size="xs"
                          />
                          <span className="truncate">{card.setName ?? card.setCode ?? 'Unknown set'}</span>
                        </div>
                        <Badge variant="outline" className="mt-1 text-[10px]">
                          {GAME_LABELS[card.tcg]}
                        </Badge>
                      </div>
                      <Button
                        size="sm"
                        variant={alreadyAdded ? 'secondary' : 'default'}
                        onClick={() => !alreadyAdded && handleAddCard(card)}
                        disabled={alreadyAdded}
                      >
                        {alreadyAdded ? (
                          <>
                            <Check className="mr-1 h-3 w-3" />
                            Added
                          </>
                        ) : (
                          <>
                            <Plus className="mr-1 h-3 w-3" />
                            Add
                          </>
                        )}
                      </Button>
                    </div>
                  );
                })}
              </div>
            </ScrollArea>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setAddCardDialogOpen(false)}>Done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <div className="grid gap-6 lg:grid-cols-[280px_1fr]">
        {/* Sidebar: Wishlist list */}
        <div className="space-y-4">
          <Button className="w-full gap-2" onClick={() => setCreateDialogOpen(true)}>
            <Plus className="h-4 w-4" />
            New Wishlist
          </Button>

          <ScrollArea className="h-[calc(100vh-320px)]">
            <div className="space-y-2">
              {wishlists.length === 0 && (
                <Card className="border-dashed">
                  <CardContent className="flex flex-col items-center justify-center py-8 text-center">
                    <Heart className="mb-2 h-8 w-8 text-muted-foreground" />
                    <p className="text-sm text-muted-foreground">
                      No wishlists yet. Create one to start tracking cards you want.
                    </p>
                  </CardContent>
                </Card>
              )}
              {wishlists.map((wishlist) => {
                const isActive = wishlist.id === activeWishlistId;
                const accent = normalizeHexColor(wishlist.colorHex);
                return (
                  <button
                    key={wishlist.id}
                    type="button"
                    className={cn(
                      'w-full rounded-lg border p-3 text-left transition',
                      isActive ? 'border-primary bg-primary/5' : 'border-input hover:bg-muted/60'
                    )}
                    onClick={() => setActiveWishlistId(wishlist.id)}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2 min-w-0">
                        {accent && (
                          <span
                            className="inline-flex h-2.5 w-2.5 rounded-full flex-shrink-0"
                            style={{ backgroundColor: accent }}
                          />
                        )}
                        <span className="text-sm font-medium truncate">{wishlist.name}</span>
                      </div>
                      <Badge variant={wishlist.completionPercent === 100 ? 'default' : 'outline'} className="text-[10px] flex-shrink-0">
                        {wishlist.completionPercent}%
                      </Badge>
                    </div>
                    <div className="mt-1.5">
                      <div className="flex items-center justify-between text-[11px] text-muted-foreground mb-1">
                        <span>{wishlist.ownedCards} / {wishlist.totalCards} cards</span>
                      </div>
                      <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                        <div
                          className={cn(
                            'h-full rounded-full transition-all',
                            wishlist.completionPercent === 100 ? 'bg-emerald-500' : 'bg-primary'
                          )}
                          style={{ width: `${wishlist.completionPercent}%` }}
                        />
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </ScrollArea>
        </div>

        {/* Main content: Active wishlist */}
        <Card className="overflow-hidden">
          {activeWishlist ? (
            <>
              <CardHeader className="flex flex-row items-start justify-between space-y-0 border-b">
                <div>
                  <CardTitle>{activeWishlist.name}</CardTitle>
                  <CardDescription>
                    {activeWishlist.description ?? `${activeWishlist.totalCards} cards tracked`}
                  </CardDescription>
                  <div className="mt-2 flex items-center gap-4 text-sm">
                    <span className="text-muted-foreground">
                      {activeWishlist.ownedCards} / {activeWishlist.totalCards} owned
                    </span>
                    <Badge variant={activeWishlist.completionPercent === 100 ? 'default' : 'secondary'}>
                      {activeWishlist.completionPercent}% complete
                    </Badge>
                  </div>
                  <div className="mt-2 h-2 w-48 rounded-full bg-muted overflow-hidden">
                    <div
                      className={cn(
                        'h-full rounded-full transition-all',
                        activeWishlist.completionPercent === 100 ? 'bg-emerald-500' : 'bg-primary'
                      )}
                      style={{ width: `${activeWishlist.completionPercent}%` }}
                    />
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button size="sm" onClick={() => setAddCardDialogOpen(true)}>
                    <Plus className="mr-1 h-4 w-4" />
                    Add Cards
                  </Button>
                  <Button
                    size="sm"
                    variant="destructive"
                    onClick={() => handleDeleteWishlist(activeWishlist.id)}
                  >
                    <Trash className="h-4 w-4" />
                  </Button>
                </div>
              </CardHeader>
              <div className="border-b px-6 py-3">
                <div className="flex gap-2">
                  <Input
                    value={collectionSearchTerm}
                    onChange={(e) => setCollectionSearchTerm(e.target.value)}
                    placeholder="Search within wishlist..."
                    className="flex-1"
                  />
                  <Select value={filterOwned} onValueChange={(v) => setFilterOwned(v as 'all' | 'owned' | 'missing')}>
                    <SelectTrigger className="w-[130px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Cards</SelectItem>
                      <SelectItem value="owned">Owned</SelectItem>
                      <SelectItem value="missing">Missing</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <CardContent className="p-0">
                <ScrollArea className="h-[calc(100vh-420px)]">
                  <div className="p-6">
                    {filteredCards.length === 0 ? (
                      <div className="flex flex-col items-center justify-center py-12 text-center">
                        <Heart className="mb-3 h-10 w-10 text-muted-foreground/50" />
                        <p className="text-sm text-muted-foreground">
                          {activeWishlist.cards.length === 0
                            ? 'This wishlist is empty. Add cards to start tracking.'
                            : 'No cards match your filter.'}
                        </p>
                      </div>
                    ) : (
                      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                        {filteredCards.map((card) => (
                          <WishlistCardItem
                            key={card.id}
                            card={card}
                            onRemove={() => handleRemoveCard(card.id)}
                          />
                        ))}
                      </div>
                    )}
                  </div>
                </ScrollArea>
              </CardContent>
            </>
          ) : (
            <CardContent className="flex flex-col items-center justify-center py-20 text-center">
              <Heart className="mb-3 h-12 w-12 text-muted-foreground/50" />
              <CardTitle className="mb-2">No wishlist selected</CardTitle>
              <CardDescription>
                Create a wishlist to start tracking cards you want to collect.
              </CardDescription>
            </CardContent>
          )}
        </Card>
      </div>
    </>
  );
}

function WishlistCardItem({
  card,
  onRemove
}: {
  card: WishlistCardResponse;
  onRemove: () => void;
}) {
  return (
    <div
      className={cn(
        'group relative rounded-lg border p-3 transition',
        card.owned
          ? 'border-emerald-300 bg-emerald-50/50 dark:border-emerald-800 dark:bg-emerald-950/30'
          : 'border-input bg-card'
      )}
    >
      <button
        type="button"
        onClick={onRemove}
        className="absolute right-2 top-2 rounded-full p-1 opacity-0 transition group-hover:opacity-100 hover:bg-destructive/10 hover:text-destructive"
        aria-label="Remove from wishlist"
      >
        <X className="h-3.5 w-3.5" />
      </button>

      <div className="flex gap-3">
        <div className="relative h-[70px] w-[50px] flex-shrink-0 overflow-hidden rounded">
          <Image
            src={card.imageUrlSmall ?? card.imageUrl ?? CARD_PLACEHOLDER_IMAGE}
            alt={card.name}
            fill
            className={cn('object-cover', !card.owned && 'opacity-50 grayscale')}
            sizes="50px"
            onError={(e) => {
              e.currentTarget.onerror = null;
              e.currentTarget.src = CARD_PLACEHOLDER_IMAGE;
            }}
          />
          {card.owned && (
            <div className="absolute bottom-0 left-0 right-0 bg-emerald-500 py-0.5 text-center">
              <Check className="mx-auto h-3 w-3 text-white" />
            </div>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold leading-tight truncate">{card.name}</p>
          <div className="mt-0.5 flex items-center gap-1">
            <SetSymbol
              symbolUrl={card.setSymbolUrl}
              logoUrl={card.setLogoUrl}
              setCode={card.setCode}
              setName={card.setName}
              tcg={card.tcg}
              size="xs"
            />
            <p className="text-[10px] text-muted-foreground truncate">
              {card.setName ?? card.setCode}
            </p>
          </div>
          {card.rarity && (
            <Badge variant="outline" className="mt-1 text-[9px] h-4">
              {card.rarity}
            </Badge>
          )}
          <div className="mt-1">
            {card.owned ? (
              <span className="text-[10px] font-medium text-emerald-600 dark:text-emerald-400">
                Owned ({card.ownedQuantity}x)
              </span>
            ) : (
              <span className="text-[10px] font-medium text-muted-foreground">
                Not owned
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
