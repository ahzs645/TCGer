"use client";

import Image from "next/image";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowLeft,
  Check,
  Heart,
  Layers,
  Loader2,
  Minus,
  Plus,
  RefreshCw,
  Search,
  Sparkles,
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
import { useConfirm } from "@/components/ui/confirm-dialog";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { GameBadge } from "@/components/cards/game-badge";
import { SetSymbol } from "@/components/cards/set-symbol";
import {
  cn,
  GAME_LABELS,
  getCardBackImage,
  type SupportedGame,
} from "@/lib/utils";
import { normalizeHexColor } from "@/lib/color";
import { searchCardsApi } from "@/lib/api-client";
import { getSets } from "@/lib/api/cards";
import { addCardsInChunks, expandWishlistRule } from "@/lib/wishlists/sync";
import { useAuthStore } from "@/stores/auth";
import { useWishlistsStore } from "@/stores/wishlists";
import { supportedGames } from "@/stores/game-filter";
import type {
  WishlistCardResponse,
  WishlistRuleResponse,
} from "@/stores/wishlists";
import { describeWishlistRule } from "@tcg/api-types";
import type { Card as CardType, TcgCode } from "@/types/card";
import { copyCountNoun } from "@/lib/copy-labels";
import { PriceAlertDialog } from "@/components/prices/price-alert-dialog";

export function WishlistContent() {
  const [confirm, confirmDialog] = useConfirm();
  const { token, isAuthenticated } = useAuthStore();
  const {
    wishlists,
    fetchWishlists,
    addWishlist,
    removeWishlist,
    addCardToWishlist,
    addCardsToWishlist,
    updateWishlistCard,
    removeCardFromWishlist,
    addRule,
    removeRule,
    syncWishlist,
    isLoading,
    hasFetched,
    error,
    clearError,
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

  // Bulk "everything that matches" state
  const [addMode, setAddMode] = useState<"search" | "set">("search");
  const [keepUpdated, setKeepUpdated] = useState(true);
  const [includeAllPrintings, setIncludeAllPrintings] = useState(true);
  const [bulkStatus, setBulkStatus] = useState<string | null>(null);
  const [isExpanding, setIsExpanding] = useState(false);

  // "From a set" tab state
  const [setGame, setSetGame] = useState<TcgCode>("pokemon");
  const [selectedSetCode, setSelectedSetCode] = useState<string>("");

  // Rule sync state
  const [isSyncing, setSyncing] = useState(false);
  const [syncStatus, setSyncStatus] = useState<string | null>(null);

  const setsQuery = useQuery({
    queryKey: ["sets", setGame],
    queryFn: () => getSets(token!, setGame),
    enabled: Boolean(token && isAddCardDialogOpen && addMode === "set"),
    staleTime: 5 * 60_000,
  });

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
      cards = cards.filter((c) => c.missingQuantity === 0);
    } else if (filterOwned === "missing") {
      cards = cards.filter((c) => c.missingQuantity > 0);
    }

    return cards;
  }, [activeWishlist, collectionSearchTerm, filterOwned]);

  const wishlistCardIds = useMemo(
    () => new Set((activeWishlist?.cards ?? []).map((card) => card.externalId)),
    [activeWishlist?.cards],
  );

  // Bulk adds span games, where provider ids can collide (OP01-001 exists in
  // more than one catalogue), so they dedupe on a game-qualified key.
  const wishlistCardKeys = useMemo(
    () =>
      new Set(
        (activeWishlist?.cards ?? []).map(
          (card) => `${card.tcg}:${card.externalId}`,
        ),
      ),
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
    const target = wishlists.find((w) => w.id === wishlistId);
    const confirmed = await confirm({
      title: `Delete "${target?.name ?? "this wishlist"}"?`,
      description:
        "The wishlist and everything on it will be removed. This cannot be undone.",
      confirmLabel: "Delete wishlist",
      destructive: true,
    });
    if (!confirmed) return;
    try {
      await removeWishlist(token, wishlistId);
      if (activeWishlistId === wishlistId) {
        const next = wishlists.find((w) => w.id !== wishlistId)?.id ?? null;
        setActiveWishlistId(next);
        if (!next) setMobileView("list");
      }
    } catch {
      // Surfaced via the store error banner.
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

  /**
   * Adds every card matching the current search — not just the preview page —
   * and optionally saves it as a rule so later printings get pulled in too.
   */
  const handleAddAllMatching = async () => {
    if (!token || !activeWishlistId || !searchQuery.trim()) return;
    const query = searchQuery.trim();
    const tcg = searchTcg === "all" ? undefined : (searchTcg as TcgCode);

    setIsExpanding(true);
    setBulkStatus("Searching every printing…");
    try {
      const matches = await expandWishlistRule(token, {
        type: "name",
        tcg,
        query,
        includeAllPrintings,
      });

      if (!matches.length) {
        setBulkStatus(`No cards found for "${query}".`);
        return;
      }

      const fresh = matches.filter(
        (card) => !wishlistCardKeys.has(`${card.tcg}:${card.id}`),
      );
      if (fresh.length) {
        await addCardsInChunks(token, activeWishlistId, fresh, (sent, total) =>
          setBulkStatus(`Adding ${sent} of ${total} cards…`),
        );
      }

      if (keepUpdated) {
        await addRule(token, activeWishlistId, {
          type: "name",
          tcg,
          query,
          includeAllPrintings,
          autoSync: true,
        });
      } else {
        await fetchWishlists(token);
      }

      setBulkStatus(
        fresh.length
          ? `Added ${fresh.length} card${fresh.length === 1 ? "" : "s"} matching "${query}".`
          : `Already tracking all ${matches.length} matches for "${query}".`,
      );
      setSelectedCards(new Set());
    } catch (bulkError) {
      setBulkStatus(
        bulkError instanceof Error
          ? bulkError.message
          : "Failed to add matching cards.",
      );
    } finally {
      setIsExpanding(false);
    }
  };

  /** Adds an entire set as a checklist, optionally kept in sync. */
  const handleAddSet = async () => {
    if (!token || !activeWishlistId || !selectedSetCode) return;
    const set = setsQuery.data?.find((entry) => entry.code === selectedSetCode);

    setIsExpanding(true);
    setBulkStatus(`Loading ${set?.name ?? selectedSetCode}…`);
    try {
      const matches = await expandWishlistRule(token, {
        type: "set",
        tcg: setGame,
        setCode: selectedSetCode,
      });

      if (!matches.length) {
        setBulkStatus("That set returned no cards.");
        return;
      }

      const fresh = matches.filter(
        (card) => !wishlistCardKeys.has(`${card.tcg}:${card.id}`),
      );
      if (fresh.length) {
        await addCardsInChunks(token, activeWishlistId, fresh, (sent, total) =>
          setBulkStatus(`Adding ${sent} of ${total} cards…`),
        );
      }

      if (keepUpdated) {
        await addRule(token, activeWishlistId, {
          type: "set",
          tcg: setGame,
          setCode: selectedSetCode,
          setName: set?.name,
          includeAllPrintings: true,
          autoSync: true,
        });
      } else {
        await fetchWishlists(token);
      }

      setBulkStatus(
        fresh.length
          ? `Added ${fresh.length} card${fresh.length === 1 ? "" : "s"} from ${set?.name ?? selectedSetCode}.`
          : `Already tracking all ${matches.length} cards in ${set?.name ?? selectedSetCode}.`,
      );
    } catch (bulkError) {
      setBulkStatus(
        bulkError instanceof Error
          ? bulkError.message
          : "Failed to add the set.",
      );
    } finally {
      setIsExpanding(false);
    }
  };

  const handleSync = async () => {
    if (!token || !activeWishlistId) return;
    setSyncing(true);
    setSyncStatus("Syncing…");
    try {
      const result = await syncWishlist(token, activeWishlistId, {
        onProgress: setSyncStatus,
      });
      setSyncStatus(
        result.addedCards
          ? `Added ${result.addedCards} new card${result.addedCards === 1 ? "" : "s"}.`
          : "Already up to date.",
      );
    } catch (syncError) {
      setSyncStatus(
        syncError instanceof Error ? syncError.message : "Sync failed.",
      );
    } finally {
      setSyncing(false);
    }
  };

  const handleRemoveRule = async (ruleId: string) => {
    if (!token || !activeWishlistId) return;
    try {
      await removeRule(token, activeWishlistId, ruleId);
    } catch {
      // Surfaced via the store error banner.
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

  const handleDesiredQuantityChange = async (
    cardId: string,
    desiredQuantity: number,
  ) => {
    if (!token || !activeWishlistId) return;
    await updateWishlistCard(token, activeWishlistId, cardId, {
      desiredQuantity,
    });
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
                  className="min-w-0 flex-1 truncate text-sm font-medium"
                  title={wishlist.name}
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
                    {wishlist.ownedDesiredQuantity} /{" "}
                    {wishlist.totalDesiredQuantity}{" "}
                    {copyCountNoun(wishlist.totalDesiredQuantity)}
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
            className="flex flex-col items-stretch gap-3 space-y-0 border-b p-4 sm:flex-row sm:items-start sm:justify-between sm:gap-0 sm:p-6"
            data-oid="zj7axve"
          >
            <div className="min-w-0 sm:flex-1" data-oid="sr-y2yh">
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
                <CardTitle
                  className="min-w-0 break-words leading-tight sm:truncate sm:leading-none"
                  data-oid="k-t4z:_"
                >
                  {activeWishlist.name}
                </CardTitle>
              </div>
              <CardDescription className="mt-1" data-oid="ryk797.">
                {activeWishlist.description ??
                  `${activeWishlist.totalCards} cards tracked`}
              </CardDescription>
              <div
                className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm sm:gap-x-4"
                data-oid="e8wn6k4"
              >
                <span
                  className="whitespace-nowrap text-muted-foreground"
                  data-oid="ln2uro3"
                >
                  {activeWishlist.ownedDesiredQuantity} /{" "}
                  {activeWishlist.totalDesiredQuantity} wanted{" "}
                  {copyCountNoun(activeWishlist.totalDesiredQuantity)} owned
                </span>
                <Badge
                  variant={
                    activeWishlist.completionPercent === 100
                      ? "default"
                      : "secondary"
                  }
                  className="whitespace-nowrap"
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
            <div
              className="flex items-center gap-2 sm:ml-2 sm:flex-shrink-0"
              data-oid="chre:su"
            >
              {activeWishlist.rules.length > 0 && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => void handleSync()}
                  disabled={isSyncing}
                  title="Re-run this wishlist's rules and add anything new"
                >
                  <RefreshCw
                    className={cn(
                      "h-4 w-4 sm:mr-1",
                      isSyncing && "animate-spin",
                    )}
                  />
                  <span className="hidden sm:inline">Sync</span>
                </Button>
              )}
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
                variant="ghost"
                className="ml-auto text-muted-foreground hover:bg-destructive/10 hover:text-destructive sm:ml-0"
                onClick={() => handleDeleteWishlist(activeWishlist.id)}
                aria-label="Delete wishlist"
                title="Delete wishlist"
                data-oid="5ks5byx"
              >
                <Trash className="h-4 w-4" data-oid="i.v-myk" />
              </Button>
            </div>
          </CardHeader>
          {(activeWishlist.rules.length > 0 || syncStatus) && (
            <div className="border-b bg-muted/30 px-4 py-3 sm:px-6">
              <div className="flex flex-wrap items-center gap-2">
                {activeWishlist.rules.map((rule) => (
                  <WishlistRuleChip
                    key={rule.id}
                    rule={rule}
                    onRemove={() => void handleRemoveRule(rule.id)}
                  />
                ))}
              </div>
              {syncStatus && (
                <p className="mt-2 text-xs text-muted-foreground">
                  {syncStatus}
                </p>
              )}
            </div>
          )}
          <div className="border-b px-4 py-3 sm:px-6" data-oid="rf4iju2">
            <div className="flex flex-col gap-2 sm:flex-row" data-oid="j3hjjed">
              <Input
                aria-label="Search within wishlist"
                value={collectionSearchTerm}
                onChange={(e) => setCollectionSearchTerm(e.target.value)}
                placeholder="Search this wishlist..."
                className="min-w-0 flex-1"
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
                  className="w-full sm:w-[150px]"
                  aria-label="Filter wishlist by ownership"
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
            <ScrollArea className="lg:h-[calc(100vh-420px)]" data-oid="asjsn.o">
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
                        onDesiredQuantityChange={(desiredQuantity) =>
                          handleDesiredQuantityChange(card.id, desiredQuantity)
                        }
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
      {error && (
        <div className="mb-4 flex items-start justify-between gap-3 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          <span>{error}</span>
          <button
            type="button"
            onClick={clearError}
            className="shrink-0 text-destructive/80 hover:text-destructive"
            aria-label="Dismiss error"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

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
              Pick cards one at a time, grab every printing of a name, or drop
              in a whole set for &ldquo;{activeWishlist?.name}&rdquo;.
            </DialogDescription>
          </DialogHeader>
          <Tabs
            value={addMode}
            onValueChange={(value) => {
              setAddMode(value as "search" | "set");
              setBulkStatus(null);
            }}
            className="flex flex-1 min-h-0 flex-col gap-3"
          >
            <TabsList className="w-full">
              <TabsTrigger value="search" className="flex-1">
                <Search className="mr-1 h-3.5 w-3.5" />
                By name
              </TabsTrigger>
              <TabsTrigger value="set" className="flex-1">
                <Layers className="mr-1 h-3.5 w-3.5" />
                Whole set
              </TabsTrigger>
            </TabsList>

            <TabsContent
              value="set"
              className="flex flex-col gap-3 data-[state=inactive]:hidden"
            >
              <div className="flex gap-2">
                <Select
                  value={setGame}
                  onValueChange={(value) => {
                    setSetGame(value as TcgCode);
                    setSelectedSetCode("");
                  }}
                >
                  <SelectTrigger className="w-[140px]" aria-label="Game">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {supportedGames
                      .filter((game) => game !== "all")
                      .map((game) => (
                        <SelectItem key={game} value={game}>
                          {GAME_LABELS[game]}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
                <Select
                  value={selectedSetCode}
                  onValueChange={setSelectedSetCode}
                  disabled={setsQuery.isLoading || !setsQuery.data?.length}
                >
                  <SelectTrigger className="flex-1" aria-label="Set">
                    <SelectValue
                      placeholder={
                        setsQuery.isLoading ? "Loading sets…" : "Choose a set"
                      }
                    />
                  </SelectTrigger>
                  <SelectContent className="max-h-72">
                    {(setsQuery.data ?? []).map((set) => (
                      <SelectItem key={set.code} value={set.code}>
                        {set.name}
                        {set.totalCards ? ` (${set.totalCards})` : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <label className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={keepUpdated}
                  onCheckedChange={(checked) =>
                    setKeepUpdated(checked === true)
                  }
                />
                Keep this wishlist updated as the set gets new cards
              </label>
              <Button
                onClick={() => void handleAddSet()}
                disabled={!selectedSetCode || isExpanding}
              >
                {isExpanding ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Layers className="mr-2 h-4 w-4" />
                )}
                Add every card in this set
              </Button>
              {setsQuery.isError && (
                <p className="text-sm text-destructive">
                  Could not load sets for {GAME_LABELS[setGame]}.
                </p>
              )}
              {bulkStatus && addMode === "set" && (
                <p className="text-sm text-muted-foreground">{bulkStatus}</p>
              )}
            </TabsContent>

            <TabsContent
              value="search"
              className="flex flex-1 min-h-0 flex-col gap-3 data-[state=inactive]:hidden"
            >
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
                      {supportedGames
                        .filter((game) => game !== "all")
                        .map((game) => (
                          <SelectItem key={game} value={game}>
                            {GAME_LABELS[game]}
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                  <Button
                    type="submit"
                    disabled={isSearching}
                    data-oid="jw0dezj"
                  >
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

                {/* Grab everything matching the name, not just this preview page */}
                {searchQuery.trim() && (
                  <div className="space-y-2 rounded-md border border-dashed p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2 text-sm">
                        <Sparkles className="h-4 w-4 text-primary" />
                        <span>
                          Add <strong>every</strong> card matching &ldquo;
                          {searchQuery.trim()}&rdquo;
                        </span>
                      </div>
                      <Button
                        size="sm"
                        onClick={() => void handleAddAllMatching()}
                        disabled={isExpanding}
                      >
                        {isExpanding ? (
                          <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                        ) : (
                          <Plus className="mr-1 h-3 w-3" />
                        )}
                        Add all matches
                      </Button>
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <label className="flex items-center gap-2 text-xs text-muted-foreground">
                        <Checkbox
                          checked={includeAllPrintings}
                          onCheckedChange={(checked) =>
                            setIncludeAllPrintings(checked === true)
                          }
                        />
                        Include every printing (uncheck for one entry per card)
                      </label>
                      <label className="flex items-center gap-2 text-xs text-muted-foreground">
                        <Checkbox
                          checked={keepUpdated}
                          onCheckedChange={(checked) =>
                            setKeepUpdated(checked === true)
                          }
                        />
                        Keep this wishlist updated with future printings
                      </label>
                    </div>
                    {bulkStatus && addMode === "search" && (
                      <p className="text-xs text-muted-foreground">
                        {bulkStatus}
                      </p>
                    )}
                  </div>
                )}

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
                            src={
                              card.imageUrlSmall ?? getCardBackImage(card.tcg)
                            }
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
                            <GameBadge game={card.tcg} className="mt-1" />
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
                                <Plus
                                  className="mr-1 h-3 w-3"
                                  data-oid=":ybk--k"
                                />
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
            </TabsContent>
          </Tabs>
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
        className="hidden lg:grid lg:grid-cols-[320px_minmax(0,1fr)] lg:items-start lg:gap-6 xl:grid-cols-[360px_minmax(0,1fr)]"
        data-oid="lgwel0t"
      >
        <div
          className="min-w-0 lg:sticky lg:top-20 lg:max-h-[calc(100dvh-6rem)] lg:overflow-y-auto lg:overscroll-contain lg:pr-1"
          data-oid="w-63780"
        >
          {sidebarContent}
        </div>
        {detailContent}
      </div>

      {/* Mobile layout: list or detail */}
      <div className="lg:hidden" data-oid="ao_v:h_">
        {mobileView === "list" ? sidebarContent : detailContent}
      </div>

      {confirmDialog}
    </>
  );
}

function WishlistRuleChip({
  rule,
  onRemove,
}: {
  rule: WishlistRuleResponse;
  onRemove: () => void;
}) {
  const lastSynced = rule.lastSyncedAt
    ? new Date(rule.lastSyncedAt).toLocaleDateString()
    : null;

  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border bg-background px-2.5 py-1 text-xs">
      {rule.type === "set" ? (
        <Layers className="h-3 w-3 text-muted-foreground" />
      ) : (
        <Sparkles className="h-3 w-3 text-muted-foreground" />
      )}
      <span className="font-medium">{describeWishlistRule(rule)}</span>
      {rule.tcg && (
        <span className="text-muted-foreground">{GAME_LABELS[rule.tcg]}</span>
      )}
      {lastSynced && (
        <span className="text-muted-foreground">· synced {lastSynced}</span>
      )}
      <button
        type="button"
        onClick={onRemove}
        className="rounded-full p-0.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
        aria-label={`Remove rule: ${describeWishlistRule(rule)}`}
      >
        <X className="h-3 w-3" />
      </button>
    </span>
  );
}

function WishlistCardItem({
  card,
  onRemove,
  onDesiredQuantityChange,
}: {
  card: WishlistCardResponse;
  onRemove: () => void;
  onDesiredQuantityChange: (desiredQuantity: number) => Promise<void>;
}) {
  const [isUpdatingQuantity, setUpdatingQuantity] = useState(false);

  const updateDesiredQuantity = async (desiredQuantity: number) => {
    if (
      isUpdatingQuantity ||
      desiredQuantity < 1 ||
      desiredQuantity > 99 ||
      desiredQuantity === card.desiredQuantity
    ) {
      return;
    }
    setUpdatingQuantity(true);
    try {
      await onDesiredQuantityChange(desiredQuantity);
    } finally {
      setUpdatingQuantity(false);
    }
  };

  return (
    <div
      className={cn(
        "group relative rounded-lg border p-3 transition",
        card.missingQuantity === 0
          ? "border-emerald-300 bg-emerald-50/50 dark:border-emerald-800 dark:bg-emerald-950/30"
          : card.ownedQuantity > 0
            ? "border-amber-300 bg-amber-50/50 dark:border-amber-800 dark:bg-amber-950/30"
            : "border-input bg-card",
      )}
      data-oid="-0lre:h"
    >
      <button
        type="button"
        onClick={onRemove}
        className="absolute right-1 top-1 flex h-11 w-11 items-center justify-center rounded-full text-muted-foreground transition hover:bg-destructive/10 hover:text-destructive sm:opacity-0 sm:group-focus-within:opacity-100 sm:group-hover:opacity-100"
        aria-label="Remove from wishlist"
        data-oid="fs83:gq"
      >
        <X className="h-4 w-4" data-oid="w554f3_" />
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
              card.ownedQuantity === 0 && "opacity-50 grayscale",
            )}
            sizes="50px"
            onError={(e) => {
              e.currentTarget.onerror = null;
              e.currentTarget.src = getCardBackImage(card.tcg);
            }}
            data-oid="sri8mjb"
          />

          {card.missingQuantity === 0 && (
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
          <div className="mt-1 space-y-1.5" data-oid="-tqdcme">
            <span
              className={cn(
                "block text-[10px] font-medium",
                card.missingQuantity === 0
                  ? "text-emerald-600 dark:text-emerald-400"
                  : card.ownedQuantity > 0
                    ? "text-amber-700 dark:text-amber-400"
                    : "text-muted-foreground",
              )}
              data-oid="mjw9hnr"
            >
              {card.missingQuantity === 0
                ? `Goal met · ${card.ownedQuantity} owned`
                : `${card.ownedQuantity} of ${card.desiredQuantity} owned · ${card.missingQuantity} missing`}
            </span>
            <div
              className="flex items-center gap-1"
              aria-label="Desired quantity"
            >
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="h-6 w-6"
                disabled={isUpdatingQuantity || card.desiredQuantity <= 1}
                onClick={() =>
                  void updateDesiredQuantity(card.desiredQuantity - 1)
                }
                aria-label={`Want one fewer ${card.name}`}
              >
                <Minus className="h-3 w-3" />
              </Button>
              <span className="min-w-12 text-center text-[10px] font-medium">
                Want {card.desiredQuantity}
              </span>
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="h-6 w-6"
                disabled={isUpdatingQuantity || card.desiredQuantity >= 99}
                onClick={() =>
                  void updateDesiredQuantity(card.desiredQuantity + 1)
                }
                aria-label={`Want one more ${card.name}`}
              >
                {isUpdatingQuantity ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <Plus className="h-3 w-3" />
                )}
              </Button>
            </div>
            <div className="pt-1">
              <PriceAlertDialog
                card={{
                  externalId: card.externalId,
                  tcg: card.tcg,
                  name: card.name,
                  imageUrl: card.imageUrlSmall ?? card.imageUrl,
                }}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
