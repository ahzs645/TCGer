"use client";

import Image from "next/image";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  Check,
  Heart,
  Loader2,
  Plus,
  Search,
  Trash,
  X,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { SetSymbol } from "@/components/cards/set-symbol";
import {
  cn,
  GAME_LABELS,
  getCardBackImage,
  type SupportedGame,
} from "@/lib/utils";
import { normalizeHexColor } from "@/lib/color";
import { searchCardsApi } from "@/lib/api-client";
import { useAuthStore } from "@/stores/auth";
import { useWishlistsStore } from "@/stores/wishlists";
import type { WishlistCardResponse } from "@/stores/wishlists";
import type { Card as CardType, TcgCode } from "@/types/card";

export function WishlistContent() {
  const { token, isAuthenticated } = useAuthStore();
  const {
    wishlists,
    fetchWishlists,
    addWishlist,
    removeWishlist,
    addCardToWishlist,
    addCardsToWishlist,
    removeCardFromWishlist,
    isLoading,
    hasFetched,
  } = useWishlistsStore();
  const [activeWishlistId, setActiveWishlistId] = useState<string | null>(null);
  const [isCreateDialogOpen, setCreateDialogOpen] = useState(false);
  const [isAddCardDialogOpen, setAddCardDialogOpen] = useState(false);
  const [newWishlistName, setNewWishlistName] = useState("");
  const [newWishlistDescription, setNewWishlistDescription] = useState("");
  const [createError, setCreateError] = useState<string | null>(null);

  // Mobile view: list vs detail
  const [mobileView, setMobileView] = useState<"list" | "detail">("list");

  // Search state for adding cards
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<CardType[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [searchTcg, setSearchTcg] = useState<SupportedGame>("all");

  // Bulk selection state
  const [selectedCards, setSelectedCards] = useState<Set<string>>(new Set());
  const [isBulkAdding, setIsBulkAdding] = useState(false);

  // Collection search state
  const [collectionSearchTerm, setCollectionSearchTerm] = useState("");
  const [filterOwned, setFilterOwned] = useState<"all" | "owned" | "missing">(
    "all",
  );

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
    [wishlists, activeWishlistId],
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
          c.setCode?.toLowerCase().includes(term),
      );
    }

    if (filterOwned === "owned") {
      cards = cards.filter((c) => c.owned);
    } else if (filterOwned === "missing") {
      cards = cards.filter((c) => !c.owned);
    }

    return cards;
  }, [activeWishlist, collectionSearchTerm, filterOwned]);

  const wishlistCardIds = useMemo(
    () => new Set((activeWishlist?.cards ?? []).map((card) => card.externalId)),
    [activeWishlist?.cards],
  );

  const isCardInWishlist = useCallback(
    (cardId: string): boolean => wishlistCardIds.has(cardId),
    [wishlistCardIds],
  );

  // Cards in search results that can be selected (not already in wishlist)
  const selectableCards = useMemo(
    () => searchResults.filter((card) => !wishlistCardIds.has(card.id)),
    [searchResults, wishlistCardIds],
  );

  const allSelectableSelected =
    selectableCards.length > 0 &&
    selectableCards.every((c) => selectedCards.has(c.id));

  const handleSelectWishlist = useCallback((wishlistId: string) => {
    setActiveWishlistId(wishlistId);
    setMobileView("detail");
  }, []);

  const handleCreateWishlist = async () => {
    if (!token || !newWishlistName.trim()) return;
    setCreateError(null);
    try {
      const id = await addWishlist(token, {
        name: newWishlistName.trim(),
        description: newWishlistDescription.trim() || undefined,
      });
      setActiveWishlistId(id);
      setMobileView("detail");
      setNewWishlistName("");
      setNewWishlistDescription("");
      setCreateDialogOpen(false);
    } catch (error) {
      setCreateError(
        error instanceof Error ? error.message : "Failed to create wishlist",
      );
    }
  };

  const handleDeleteWishlist = async (wishlistId: string) => {
    if (!token) return;
    try {
      await removeWishlist(token, wishlistId);
      if (activeWishlistId === wishlistId) {
        const next = wishlists.find((w) => w.id !== wishlistId)?.id ?? null;
        setActiveWishlistId(next);
        if (!next) setMobileView("list");
      }
    } catch {
      // Error handled in store
    }
  };

  const handleSearch = async () => {
    if (!searchQuery.trim()) return;
    setIsSearching(true);
    setSelectedCards(new Set());
    try {
      const results = await searchCardsApi({
        query: searchQuery.trim(),
        tcg: searchTcg === "all" ? undefined : (searchTcg as TcgCode),
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
        collectorNumber: card.collectorNumber,
      });
      // Remove from selection after adding
      setSelectedCards((prev) => {
        const next = new Set(prev);
        next.delete(card.id);
        return next;
      });
    } catch {
      // Error handled in store
    }
  };

  const handleBulkAdd = async () => {
    if (!token || !activeWishlistId || selectedCards.size === 0) return;
    setIsBulkAdding(true);
    try {
      const cardsToAdd = searchResults
        .filter((c) => selectedCards.has(c.id) && !isCardInWishlist(c.id))
        .map((card) => ({
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
          collectorNumber: card.collectorNumber,
        }));
      if (cardsToAdd.length > 0) {
        await addCardsToWishlist(token, activeWishlistId, {
          cards: cardsToAdd,
        });
      }
      setSelectedCards(new Set());
    } catch {
      // Error handled in store
    } finally {
      setIsBulkAdding(false);
    }
  };

  const handleToggleCard = (cardId: string) => {
    setSelectedCards((prev) => {
      const next = new Set(prev);
      if (next.has(cardId)) {
        next.delete(cardId);
      } else {
        next.add(cardId);
      }
      return next;
    });
  };

  const handleToggleAll = () => {
    if (allSelectableSelected) {
      setSelectedCards(new Set());
    } else {
      setSelectedCards(new Set(selectableCards.map((c) => c.id)));
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

  if (!isAuthenticated) {
    return (
      <Card data-oid=":oyduh9">
        <CardHeader data-oid="o6hh9wg">
          <CardTitle data-oid="ubkaks8">Sign in required</CardTitle>
          <CardDescription data-oid="279agp1">
            Sign in to create and manage your wishlists.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  if (!hasFetched) {
    return (
      <div className="grid gap-6 lg:grid-cols-[280px_1fr]" data-oid="ouuguqc">
        <div className="space-y-4" data-oid="ix3bgy:">
          <Skeleton className="h-10 w-full" data-oid="jj:fsyp" />
          <Skeleton className="h-32 w-full" data-oid="amqale." />
        </div>
        <Skeleton className="h-96 w-full" data-oid="xz2:z-5" />
      </div>
    );
  }

  // Shared sidebar content
  const sidebarContent = (
    <div className="space-y-4" data-oid="hnusw57">
      <Button
        className="w-full gap-2"
        onClick={() => setCreateDialogOpen(true)}
        data-oid="h9ag.ml"
      >
        <Plus className="h-4 w-4" data-oid="s4q6u8b" />
        New Wishlist
      </Button>

      <div className="space-y-2" data-oid=".hsjbbq">
        {wishlists.length === 0 && (
          <Card className="border-dashed" data-oid="h8nnh9.">
            <CardContent
              className="flex flex-col items-center justify-center py-8 text-center"
              data-oid="fk:671g"
            >
              <Heart
                className="mb-2 h-8 w-8 text-muted-foreground"
                data-oid="4pgtet_"
              />
              <p className="text-sm text-muted-foreground" data-oid="ah3gz:y">
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
                "w-full rounded-lg border p-3 text-left transition",
                isActive
                  ? "border-primary bg-primary/5"
                  : "border-input hover:bg-muted/60",
              )}
              onClick={() => handleSelectWishlist(wishlist.id)}
              data-oid="9.q9njk"
            >
              <div className="flex items-center gap-2" data-oid="2j6k3_w">
                {accent && (
                  <span
                    className="inline-flex h-2.5 w-2.5 rounded-full flex-shrink-0"
                    style={{ backgroundColor: accent }}
                    data-oid="m6u48f7"
                  />
                )}
                <span
                  className="min-w-0 flex-1 text-sm font-medium truncate"
                  data-oid="_z6fklr"
                >
                  {wishlist.name}
                </span>
                <Badge
                  variant={
                    wishlist.completionPercent === 100 ? "default" : "outline"
                  }
                  className="ml-2 text-[10px] flex-shrink-0"
                  data-oid="cxm7g0y"
                >
                  {wishlist.completionPercent}%
                </Badge>
              </div>
              <div className="mt-1.5" data-oid="s.bvqno">
                <div
                  className="flex items-center justify-between text-[11px] text-muted-foreground mb-1"
                  data-oid="3hu2u:k"
                >
                  <span data-oid="p75yp8m">
                    {wishlist.ownedCards} / {wishlist.totalCards} cards
                  </span>
                </div>
                <div
                  className="h-1.5 rounded-full bg-muted overflow-hidden"
                  data-oid=".6t.b:i"
                >
                  <div
                    className={cn(
                      "h-full rounded-full transition-all",
                      wishlist.completionPercent === 100
                        ? "bg-emerald-500"
                        : "bg-primary",
                    )}
                    style={{ width: `${wishlist.completionPercent}%` }}
                    data-oid="5dpqqh2"
                  />
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );

  // Shared detail content
  const detailContent = (
    <Card className="overflow-hidden" data-oid="-3:-9xz">
      {activeWishlist ? (
        <>
          <CardHeader
            className="flex flex-row items-start justify-between space-y-0 border-b"
            data-oid="zj7axve"
          >
            <div className="min-w-0 flex-1" data-oid="sr-y2yh">
              <div className="flex items-center gap-2" data-oid="brd9u79">
                {/* Back button on mobile */}
                <button
                  type="button"
                  onClick={() => setMobileView("list")}
                  className="rounded-md p-1 hover:bg-muted lg:hidden"
                  aria-label="Back to wishlists"
                  data-oid="qqdxhi5"
                >
                  <ArrowLeft className="h-5 w-5" data-oid="kqlik-2" />
                </button>
                <CardTitle className="truncate" data-oid="k-t4z:_">
                  {activeWishlist.name}
                </CardTitle>
              </div>
              <CardDescription className="mt-1" data-oid="ryk797.">
                {activeWishlist.description ??
                  `${activeWishlist.totalCards} cards tracked`}
              </CardDescription>
              <div
                className="mt-2 flex items-center gap-4 text-sm"
                data-oid="e8wn6k4"
              >
                <span className="text-muted-foreground" data-oid="ln2uro3">
                  {activeWishlist.ownedCards} / {activeWishlist.totalCards}{" "}
                  owned
                </span>
                <Badge
                  variant={
                    activeWishlist.completionPercent === 100
                      ? "default"
                      : "secondary"
                  }
                  data-oid="a52cndb"
                >
                  {activeWishlist.completionPercent}% complete
                </Badge>
              </div>
              <div
                className="mt-2 h-2 w-48 rounded-full bg-muted overflow-hidden"
                data-oid="2ue4y7g"
              >
                <div
                  className={cn(
                    "h-full rounded-full transition-all",
                    activeWishlist.completionPercent === 100
                      ? "bg-emerald-500"
                      : "bg-primary",
                  )}
                  style={{ width: `${activeWishlist.completionPercent}%` }}
                  data-oid=".l1ik5s"
                />
              </div>
            </div>
            <div className="flex gap-2 flex-shrink-0 ml-2" data-oid="chre:su">
              <Button
                size="sm"
                onClick={() => setAddCardDialogOpen(true)}
                data-oid="nu7xbub"
              >
                <Plus className="mr-1 h-4 w-4" data-oid="_5xe_mm" />
                <span className="hidden sm:inline" data-oid="j0uy1ee">
                  Add Cards
                </span>
                <span className="sm:hidden" data-oid="8cywkia">
                  Add
                </span>
              </Button>
              <Button
                size="sm"
                variant="destructive"
                onClick={() => handleDeleteWishlist(activeWishlist.id)}
                data-oid="5ks5byx"
              >
                <Trash className="h-4 w-4" data-oid="i.v-myk" />
              </Button>
            </div>
          </CardHeader>
          <div className="border-b px-4 py-3 sm:px-6" data-oid="rf4iju2">
            <div className="flex gap-2" data-oid="j3hjjed">
              <Input
                value={collectionSearchTerm}
                onChange={(e) => setCollectionSearchTerm(e.target.value)}
                placeholder="Search within wishlist..."
                className="flex-1"
                data-oid="1cv2ua5"
              />

              <Select
                value={filterOwned}
                onValueChange={(v) =>
                  setFilterOwned(v as "all" | "owned" | "missing")
                }
                data-oid="7.gxmsp"
              >
                <SelectTrigger
                  className="w-[110px] sm:w-[130px]"
                  data-oid="w8gvxu4"
                >
                  <SelectValue data-oid="khh:y5r" />
                </SelectTrigger>
                <SelectContent data-oid="zkeg-fv">
                  <SelectItem value="all" data-oid="w.3u5wt">
                    All Cards
                  </SelectItem>
                  <SelectItem value="owned" data-oid="ybecpjs">
                    Owned
                  </SelectItem>
                  <SelectItem value="missing" data-oid="..6lke.">
                    Missing
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <CardContent className="p-0" data-oid="pbacx1z">
            <ScrollArea className="h-[calc(100vh-420px)]" data-oid="asjsn.o">
              <div className="p-4 sm:p-6" data-oid="9y0r1ae">
                {filteredCards.length === 0 ? (
                  <div
                    className="flex flex-col items-center justify-center py-12 text-center"
                    data-oid="jluveg4"
                  >
                    <Heart
                      className="mb-3 h-10 w-10 text-muted-foreground/50"
                      data-oid="h1ud4w6"
                    />
                    <p
                      className="text-sm text-muted-foreground"
                      data-oid="yzz_u_2"
                    >
                      {activeWishlist.cards.length === 0
                        ? "This wishlist is empty. Add cards to start tracking."
                        : "No cards match your filter."}
                    </p>
                  </div>
                ) : (
                  <div
                    className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-2 xl:grid-cols-3"
                    data-oid="-0r3xdu"
                  >
                    {filteredCards.map((card) => (
                      <WishlistCardItem
                        key={card.id}
                        card={card}
                        onRemove={() => handleRemoveCard(card.id)}
                        data-oid="wlh:nsz"
                      />
                    ))}
                  </div>
                )}
              </div>
            </ScrollArea>
          </CardContent>
        </>
      ) : (
        <CardContent
          className="flex flex-col items-center justify-center py-20 text-center"
          data-oid="xahlzp8"
        >
          <Heart
            className="mb-3 h-12 w-12 text-muted-foreground/50"
            data-oid="_3:ymw1"
          />
          <CardTitle className="mb-2" data-oid="8d1etxz">
            No wishlist selected
          </CardTitle>
          <CardDescription data-oid="7gdk5aa">
            Create a wishlist to start tracking cards you want to collect.
          </CardDescription>
        </CardContent>
      )}
    </Card>
  );

  return (
    <>
      {/* Create Wishlist Dialog */}
      <Dialog
        open={isCreateDialogOpen}
        onOpenChange={setCreateDialogOpen}
        data-oid="6gpy3dr"
      >
        <DialogContent data-oid="ar:lq6g">
          <DialogHeader data-oid="un.mia:">
            <DialogTitle data-oid="16t-phe">Create Wishlist</DialogTitle>
            <DialogDescription data-oid="zwk.te0">
              Create a new wishlist to track cards you want to collect.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2" data-oid="zn3h6z9">
            <div className="space-y-2" data-oid="_ny7fzz">
              <Label htmlFor="wishlist-name" data-oid="4aig53o">
                Name
              </Label>
              <Input
                id="wishlist-name"
                value={newWishlistName}
                onChange={(e) => setNewWishlistName(e.target.value)}
                placeholder="e.g., Every Darkrai, Eevee Collection"
                data-oid="a:a9eax"
              />
            </div>
            <div className="space-y-2" data-oid="ibukzip">
              <Label htmlFor="wishlist-desc" data-oid="fka4-_l">
                Description (optional)
              </Label>
              <Input
                id="wishlist-desc"
                value={newWishlistDescription}
                onChange={(e) => setNewWishlistDescription(e.target.value)}
                placeholder="What are you collecting?"
                data-oid=":jnm5uq"
              />
            </div>
            {createError && (
              <p className="text-sm text-destructive" data-oid="y9f-gej">
                {createError}
              </p>
            )}
          </div>
          <DialogFooter data-oid="8vw8xue">
            <Button
              variant="ghost"
              onClick={() => setCreateDialogOpen(false)}
              data-oid="ngu82my"
            >
              Cancel
            </Button>
            <Button
              onClick={handleCreateWishlist}
              disabled={!newWishlistName.trim() || isLoading}
              data-oid=".ubg-9u"
            >
              {isLoading ? (
                <Loader2
                  className="mr-2 h-4 w-4 animate-spin"
                  data-oid="jcrdyhe"
                />
              ) : (
                <Plus className="mr-2 h-4 w-4" data-oid="ymbpxo-" />
              )}
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add Card Search Dialog */}
      <Dialog
        open={isAddCardDialogOpen}
        onOpenChange={(open) => {
          setAddCardDialogOpen(open);
          if (!open) {
            setSelectedCards(new Set());
          }
        }}
        data-oid="gacic5b"
      >
        <DialogContent
          className="max-w-2xl max-h-[90vh] flex flex-col"
          data-oid="rb.srq5"
        >
          <DialogHeader data-oid="5:jh4b7">
            <DialogTitle data-oid="qjv8w_w">Add Cards to Wishlist</DialogTitle>
            <DialogDescription data-oid="2.m:oe9">
              Search for cards to add to &ldquo;{activeWishlist?.name}&rdquo;.
              Select multiple cards and add them all at once.
            </DialogDescription>
          </DialogHeader>
          <div
            className="flex flex-col gap-3 flex-1 min-h-0"
            data-oid="3bmqdmv"
          >
            <form
              className="flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                handleSearch();
              }}
              data-oid="3nbn3-7"
            >
              <Input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search by card name..."
                className="flex-1"
                data-oid="-253sm9"
              />

              <Select
                value={searchTcg}
                onValueChange={(v) => setSearchTcg(v as SupportedGame)}
                data-oid="q4u...5"
              >
                <SelectTrigger
                  className="w-[120px] sm:w-[140px]"
                  data-oid="hs7519."
                >
                  <SelectValue data-oid="uj08yjx" />
                </SelectTrigger>
                <SelectContent data-oid="uxokjwj">
                  <SelectItem value="all" data-oid="aqgu.0c">
                    All Games
                  </SelectItem>
                  <SelectItem value="pokemon" data-oid="fks21t7">
                    Pokemon
                  </SelectItem>
                  <SelectItem value="magic" data-oid="kojrklm">
                    Magic
                  </SelectItem>
                  <SelectItem value="yugioh" data-oid="5h-.w:z">
                    Yu-Gi-Oh!
                  </SelectItem>
                </SelectContent>
              </Select>
              <Button type="submit" disabled={isSearching} data-oid="jw0dezj">
                {isSearching ? (
                  <Loader2
                    className="h-4 w-4 animate-spin"
                    data-oid="d1x56tx"
                  />
                ) : (
                  <Search className="h-4 w-4" data-oid="9a.fnrg" />
                )}
              </Button>
            </form>

            {/* Select all bar */}
            {searchResults.length > 0 && (
              <div
                className="flex items-center justify-between rounded-md border bg-muted/50 px-3 py-2"
                data-oid="m4fhx2q"
              >
                <div className="flex items-center gap-2" data-oid="lk5-i8t">
                  <Checkbox
                    checked={allSelectableSelected}
                    onCheckedChange={handleToggleAll}
                    disabled={selectableCards.length === 0}
                    aria-label="Select all"
                    data-oid="q0.bdgk"
                  />

                  <span
                    className="text-sm text-muted-foreground"
                    data-oid="3qufqkg"
                  >
                    {selectableCards.length === 0
                      ? "All cards already added"
                      : selectedCards.size > 0
                        ? `${selectedCards.size} selected`
                        : `Select all (${selectableCards.length} available)`}
                  </span>
                </div>
                {selectedCards.size > 0 && (
                  <Button
                    size="sm"
                    onClick={handleBulkAdd}
                    disabled={isBulkAdding}
                    data-oid="s_v3lg3"
                  >
                    {isBulkAdding ? (
                      <Loader2
                        className="mr-1 h-3 w-3 animate-spin"
                        data-oid="qudrgfk"
                      />
                    ) : (
                      <Plus className="mr-1 h-3 w-3" data-oid="xt_9fsz" />
                    )}
                    Add {selectedCards.size} card
                    {selectedCards.size !== 1 ? "s" : ""}
                  </Button>
                )}
              </div>
            )}

            <ScrollArea
              className="flex-1 min-h-0"
              style={{ maxHeight: "400px" }}
              data-oid="xho-3f:"
            >
              <div className="space-y-2" data-oid=":dbwuvl">
                {searchResults.length === 0 && !isSearching && (
                  <p
                    className="py-8 text-center text-sm text-muted-foreground"
                    data-oid="04ff0y0"
                  >
                    Search for cards to add to your wishlist.
                  </p>
                )}
                {searchResults.map((card) => {
                  const alreadyAdded = isCardInWishlist(card.id);
                  const isSelected = selectedCards.has(card.id);
                  return (
                    <div
                      key={card.id}
                      className={cn(
                        "flex items-center gap-3 rounded-lg border p-3 transition-colors",
                        isSelected &&
                          !alreadyAdded &&
                          "border-primary bg-primary/5",
                      )}
                      data-oid="f4b5-2a"
                    >
                      {!alreadyAdded && (
                        <Checkbox
                          checked={isSelected}
                          onCheckedChange={() => handleToggleCard(card.id)}
                          aria-label={`Select ${card.name}`}
                          data-oid="vac46wu"
                        />
                      )}
                      <Image
                        src={card.imageUrlSmall ?? getCardBackImage(card.tcg)}
                        alt={card.name}
                        width={40}
                        height={56}
                        className="h-14 w-10 flex-shrink-0 rounded-md object-cover"
                        loading="lazy"
                        onError={(e) => {
                          e.currentTarget.onerror = null;
                          e.currentTarget.src = getCardBackImage(card.tcg);
                        }}
                        data-oid="4kvvuzd"
                      />

                      <div className="flex-1 min-w-0" data-oid="4q1-r28">
                        <p
                          className="text-sm font-medium truncate"
                          data-oid="5or8ln5"
                        >
                          {card.name}
                        </p>
                        <div
                          className="flex items-center gap-1 text-xs text-muted-foreground"
                          data-oid="mnxj9jv"
                        >
                          <SetSymbol
                            symbolUrl={card.setSymbolUrl}
                            logoUrl={card.setLogoUrl}
                            setCode={card.setCode}
                            setName={card.setName}
                            tcg={card.tcg}
                            size="xs"
                            data-oid="4v6eocx"
                          />

                          <span className="truncate" data-oid="68cioo9">
                            {card.setName ?? card.setCode ?? "Unknown set"}
                          </span>
                        </div>
                        <Badge
                          variant="outline"
                          className="mt-1 text-[10px]"
                          data-oid="s9dd93-"
                        >
                          {GAME_LABELS[card.tcg]}
                        </Badge>
                      </div>
                      <Button
                        size="sm"
                        variant={alreadyAdded ? "secondary" : "default"}
                        onClick={() => !alreadyAdded && handleAddCard(card)}
                        disabled={alreadyAdded}
                        className="flex-shrink-0"
                        data-oid="r-bnl4b"
                      >
                        {alreadyAdded ? (
                          <>
                            <Check
                              className="mr-1 h-3 w-3"
                              data-oid="iz_w3kc"
                            />
                            Added
                          </>
                        ) : (
                          <>
                            <Plus className="mr-1 h-3 w-3" data-oid=":ybk--k" />
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
          <DialogFooter data-oid="bs.6ddj">
            <Button
              variant="ghost"
              onClick={() => setAddCardDialogOpen(false)}
              data-oid="htjswqq"
            >
              Done
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Desktop layout: side-by-side */}
      <div
        className="hidden lg:grid lg:grid-cols-[280px_1fr] lg:gap-6"
        data-oid="lgwel0t"
      >
        <ScrollArea className="h-[calc(100vh-220px)]" data-oid="w-63780">
          {sidebarContent}
        </ScrollArea>
        {detailContent}
      </div>

      {/* Mobile layout: list or detail */}
      <div className="lg:hidden" data-oid="ao_v:h_">
        {mobileView === "list" ? sidebarContent : detailContent}
      </div>
    </>
  );
}

function WishlistCardItem({
  card,
  onRemove,
}: {
  card: WishlistCardResponse;
  onRemove: () => void;
}) {
  return (
    <div
      className={cn(
        "group relative rounded-lg border p-3 transition",
        card.owned
          ? "border-emerald-300 bg-emerald-50/50 dark:border-emerald-800 dark:bg-emerald-950/30"
          : "border-input bg-card",
      )}
      data-oid="-0lre:h"
    >
      <button
        type="button"
        onClick={onRemove}
        className="absolute right-2 top-2 rounded-full p-1 opacity-0 transition group-hover:opacity-100 hover:bg-destructive/10 hover:text-destructive"
        aria-label="Remove from wishlist"
        data-oid="fs83:gq"
      >
        <X className="h-3.5 w-3.5" data-oid="w554f3_" />
      </button>

      <div className="flex gap-3" data-oid="pifzu:z">
        <div
          className="relative h-[70px] w-[50px] flex-shrink-0 overflow-hidden rounded"
          data-oid=".4y.3f1"
        >
          <Image
            src={
              card.imageUrlSmall ?? card.imageUrl ?? getCardBackImage(card.tcg)
            }
            alt={card.name}
            fill
            className={cn(
              "object-cover",
              !card.owned && "opacity-50 grayscale",
            )}
            sizes="50px"
            onError={(e) => {
              e.currentTarget.onerror = null;
              e.currentTarget.src = getCardBackImage(card.tcg);
            }}
            data-oid="sri8mjb"
          />

          {card.owned && (
            <div
              className="absolute bottom-0 left-0 right-0 bg-emerald-500 py-0.5 text-center"
              data-oid="uxmogq4"
            >
              <Check
                className="mx-auto h-3 w-3 text-white"
                data-oid="t0a.3im"
              />
            </div>
          )}
        </div>
        <div className="min-w-0 flex-1" data-oid="g4iamst">
          <p
            className="text-xs font-semibold leading-tight truncate"
            data-oid="zwyq:dl"
          >
            {card.name}
          </p>
          <div className="mt-0.5 flex items-center gap-1" data-oid="4vvx5n:">
            <SetSymbol
              symbolUrl={card.setSymbolUrl}
              logoUrl={card.setLogoUrl}
              setCode={card.setCode}
              setName={card.setName}
              tcg={card.tcg}
              size="xs"
              data-oid="_zqdw-f"
            />

            <p
              className="text-[10px] text-muted-foreground truncate"
              data-oid="u7joyn8"
            >
              {card.setName ?? card.setCode}
            </p>
          </div>
          {card.rarity && (
            <Badge
              variant="outline"
              className="mt-1 text-[9px] h-4"
              data-oid="zywm1wa"
            >
              {card.rarity}
            </Badge>
          )}
          <div className="mt-1" data-oid="-tqdcme">
            {card.owned ? (
              <span
                className="text-[10px] font-medium text-emerald-600 dark:text-emerald-400"
                data-oid="mjw9hnr"
              >
                Owned ({card.ownedQuantity}x)
              </span>
            ) : (
              <span
                className="text-[10px] font-medium text-muted-foreground"
                data-oid="h_iwm71"
              >
                Not owned
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
