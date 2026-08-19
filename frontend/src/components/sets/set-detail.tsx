"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowLeft,
  Check,
  Grid2X2,
  List,
  Heart,
  Loader2,
  Plus,
  Search,
  Sparkles,
  X,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CardImage } from "@/components/cards/card-image";
import { SetSymbol } from "@/components/cards/set-symbol";
import {
  Card as UiCard,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { getSetCards, getSets } from "@/lib/api/cards";
import {
  addCardToCollection,
  LIBRARY_COLLECTION_ID,
} from "@/lib/api/collections";
import { addCardsInChunks } from "@/lib/wishlists/sync";
import { useWishlistsStore } from "@/stores/wishlists";
import { getAppRoute } from "@/lib/app-routes";
import { compareCollectorNumbers } from "@/lib/cards/collector-number";
import { ALL_COLLECTION_ID } from "@/lib/hooks/use-collection";
import {
  getPrintingIdentity,
  normalizeSetCode,
  summarizeSetProgress,
  uniquePrintings,
} from "@/lib/sets/progress";
import { cn, GAME_LABELS, getCardBackImage } from "@/lib/utils";
import { useAuthStore } from "@/stores/auth";
import { useCollectionsStore } from "@/stores/collections";
import type {
  Card as TradingCard,
  CollectionCard,
  TcgCode,
} from "@tcg/api-types";

import { useShallow } from "zustand/react/shallow";
type OwnershipFilter = "all" | "owned" | "missing";
type CardSort = "collector" | "name" | "rarity";
type ViewMode = "grid" | "list";

interface SetDetailProps {
  tcg: TcgCode;
  setCode: string;
}

function formatDate(value: string | undefined): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  }).format(date);
}

function searchText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLocaleLowerCase();
}

function compareCards(
  left: TradingCard,
  right: TradingCard,
  sort: CardSort,
): number {
  if (sort === "name") return left.name.localeCompare(right.name);
  if (sort === "rarity") {
    return (
      (left.rarity ?? "").localeCompare(right.rarity ?? "") ||
      compareCollectorNumbers(left.collectorNumber, right.collectorNumber)
    );
  }
  return (
    compareCollectorNumbers(left.collectorNumber, right.collectorNumber) ||
    left.name.localeCompare(right.name)
  );
}

export function SetDetail({ tcg, setCode }: SetDetailProps) {
  const pathname = usePathname();
  const [mounted, setMounted] = useState(false);
  const { token, isAuthenticated, user } = useAuthStore();
  const { collections, fetchCollections, hasFetched, collectionsLoading } =
    useCollectionsStore(
      useShallow((state) => ({
        collections: state.collections,
        fetchCollections: state.fetchCollections,
        hasFetched: state.hasFetched,
        collectionsLoading: state.isLoading,
      })),
    );
  const [collectionId, setCollectionId] = useState(ALL_COLLECTION_ID);
  const [query, setQuery] = useState("");
  const [rarity, setRarity] = useState("all");
  const [ownership, setOwnership] = useState<OwnershipFilter>("all");
  const [sort, setSort] = useState<CardSort>("collector");
  const [view, setView] = useState<ViewMode>("grid");
  const [selectedCardIds, setSelectedCardIds] = useState<Set<string>>(
    new Set(),
  );
  const [bulkBinderId, setBulkBinderId] = useState(LIBRARY_COLLECTION_ID);
  const [bulkAdding, setBulkAdding] = useState(false);
  const [bulkStatus, setBulkStatus] = useState<string | null>(null);
  const {
    wishlists,
    fetchWishlists,
    hasFetchedWishlists,
    addRule: addWishlistRule,
  } = useWishlistsStore(
    useShallow((state) => ({
      wishlists: state.wishlists,
      fetchWishlists: state.fetchWishlists,
      hasFetchedWishlists: state.hasFetched,
      addRule: state.addRule,
    })),
  );
  const [wishlistId, setWishlistId] = useState("");
  const [wishlistBusy, setWishlistBusy] = useState(false);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (token && isAuthenticated && !hasFetched) {
      void fetchCollections(token);
    }
  }, [fetchCollections, hasFetched, isAuthenticated, token]);

  useEffect(() => {
    if (token && isAuthenticated && !hasFetchedWishlists) {
      void fetchWishlists(token);
    }
  }, [fetchWishlists, hasFetchedWishlists, isAuthenticated, token]);

  useEffect(() => {
    if (!wishlistId && wishlists.length) {
      setWishlistId(wishlists[0].id);
    }
  }, [wishlistId, wishlists]);

  useEffect(() => {
    if (
      collectionId !== ALL_COLLECTION_ID &&
      !collections.some((collection) => collection.id === collectionId)
    ) {
      setCollectionId(ALL_COLLECTION_ID);
    }
  }, [collectionId, collections]);

  const cardsQuery = useQuery({
    queryKey: ["sets", tcg, setCode, "cards"],
    queryFn: () => getSetCards(token!, tcg, setCode),
    enabled: Boolean(mounted && token && isAuthenticated),
    staleTime: 5 * 60_000,
  });
  const setsQuery = useQuery({
    queryKey: ["sets", tcg],
    queryFn: () => getSets(token!, tcg),
    enabled: Boolean(mounted && token && isAuthenticated),
    staleTime: 5 * 60_000,
  });

  const set = useMemo(
    () =>
      setsQuery.data?.find(
        (entry) => normalizeSetCode(entry.code) === normalizeSetCode(setCode),
      ),
    [setCode, setsQuery.data],
  );

  const contextCards = useMemo<CollectionCard[]>(() => {
    if (collectionId === ALL_COLLECTION_ID) {
      return collections.flatMap((collection) => collection.cards);
    }
    return (
      collections.find((collection) => collection.id === collectionId)?.cards ??
      []
    );
  }, [collectionId, collections]);

  const setCards = useMemo(
    () => uniquePrintings(cardsQuery.data ?? []),
    [cardsQuery.data],
  );
  const progress = useMemo(
    () => summarizeSetProgress(setCards, contextCards),
    [contextCards, setCards],
  );

  const rarities = useMemo(
    () =>
      Array.from(
        new Set(
          setCards
            .map((card) => card.rarity?.trim())
            .filter((value): value is string => Boolean(value)),
        ),
      ).sort((left, right) => left.localeCompare(right)),
    [setCards],
  );

  const visibleCards = useMemo(() => {
    const needle = searchText(query.trim());
    return setCards
      .filter((card) => {
        if (
          needle &&
          !searchText(
            `${card.name} ${card.collectorNumber ?? ""} ${card.rarity ?? ""}`,
          ).includes(needle)
        ) {
          return false;
        }
        if (rarity !== "all" && card.rarity !== rarity) return false;
        const owned = progress.ownedPrintingKeys.has(getPrintingIdentity(card));
        if (ownership === "owned") return owned;
        if (ownership === "missing") return !owned;
        return true;
      })
      .sort((left, right) => compareCards(left, right, sort));
  }, [ownership, progress.ownedPrintingKeys, query, rarity, setCards, sort]);

  const setsHref = getAppRoute("/sets", pathname);
  const setTitle = set?.name ?? setCards[0]?.setName ?? setCode.toUpperCase();
  const releaseDate = formatDate(set?.releaseDate);
  const isAllCollections = collectionId === ALL_COLLECTION_ID;
  const selectedCollectionName = isAllCollections
    ? "All collection"
    : (collections.find((entry) => entry.id === collectionId)?.name ??
      "Selected binder");
  // The scope name is a UI label ("All collection"), not a noun phrase that
  // reads inside a sentence — interpolating it produced "in All collection."
  const scopeSentence = isAllCollections
    ? "Track every unique printing across your whole collection."
    : `Track every unique printing in ${selectedCollectionName}.`;

  const toggleSelected = (cardId: string) => {
    setSelectedCardIds((current) => {
      const next = new Set(current);
      if (next.has(cardId)) next.delete(cardId);
      else next.add(cardId);
      return next;
    });
  };

  const addSelectedCards = async () => {
    if (!token || selectedCardIds.size === 0) return;
    const cards = setCards.filter((card) => selectedCardIds.has(card.id));
    setBulkAdding(true);
    setBulkStatus(null);
    try {
      let cursor = 0;
      const workers = Array.from(
        { length: Math.min(4, cards.length) },
        async () => {
          while (cursor < cards.length) {
            const card = cards[cursor++];
            await addCardToCollection(
              token,
              bulkBinderId,
              {
                cardId: card.id,
                quantity: 1,
                price:
                  typeof card.attributes?.price_usd === "number"
                    ? card.attributes.price_usd
                    : undefined,
                cardData: {
                  ...card,
                  externalId: card.id,
                },
              },
              user,
            );
          }
        },
      );
      await Promise.all(workers);
      await fetchCollections(token);
      setBulkStatus(`Added ${cards.length} cards.`);
      setSelectedCardIds(new Set());
    } catch (error) {
      setBulkStatus(
        error instanceof Error ? error.message : "Bulk add failed.",
      );
    } finally {
      setBulkAdding(false);
    }
  };

  /** Adds the selected printings to a wishlist without touching binders. */
  const addSelectedToWishlist = async () => {
    if (!token || !wishlistId || selectedCardIds.size === 0) return;
    const cards = setCards.filter((card) => selectedCardIds.has(card.id));
    setWishlistBusy(true);
    setBulkStatus(null);
    try {
      await addCardsInChunks(token, wishlistId, cards, (sent, total) =>
        setBulkStatus(`Adding ${sent} of ${total} cards to wishlist…`),
      );
      await fetchWishlists(token);
      setBulkStatus(`Added ${cards.length} cards to your wishlist.`);
      setSelectedCardIds(new Set());
    } catch (error) {
      setBulkStatus(
        error instanceof Error ? error.message : "Wishlist add failed.",
      );
    } finally {
      setWishlistBusy(false);
    }
  };

  /**
   * Tracks the full set as a wishlist rule, so the checklist keeps itself
   * current as the provider publishes more cards for the set.
   */
  const trackSetInWishlist = async () => {
    if (!token || !wishlistId) return;
    setWishlistBusy(true);
    setBulkStatus(`Adding ${setCards.length} cards to your wishlist…`);
    try {
      await addCardsInChunks(token, wishlistId, setCards, (sent, total) =>
        setBulkStatus(`Adding ${sent} of ${total} cards to wishlist…`),
      );
      await addWishlistRule(token, wishlistId, {
        type: "set",
        tcg,
        setCode,
        setName: setTitle,
        includeAllPrintings: true,
        autoSync: true,
      });
      setBulkStatus(`Tracking ${setTitle} in your wishlist.`);
    } catch (error) {
      setBulkStatus(
        error instanceof Error ? error.message : "Could not track this set.",
      );
    } finally {
      setWishlistBusy(false);
    }
  };

  if (!mounted) {
    return (
      <UiCard>
        <CardContent className="flex min-h-72 items-center justify-center">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </CardContent>
      </UiCard>
    );
  }

  if (!isAuthenticated || !token) {
    return (
      <div className="space-y-4">
        <Button variant="ghost" size="sm" asChild>
          <Link href={setsHref}>
            <ArrowLeft className="mr-2 h-4 w-4" />
            All sets
          </Link>
        </Button>
        <UiCard>
          <CardHeader>
            <CardTitle>Sign in required</CardTitle>
            <CardDescription>
              Sign in to open this checklist and compare it with your
              collection.
            </CardDescription>
          </CardHeader>
        </UiCard>
      </div>
    );
  }

  const loadError = cardsQuery.error ?? setsQuery.error;

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <Button variant="ghost" size="sm" asChild className="-ml-3">
          <Link href={setsHref}>
            <ArrowLeft className="mr-2 h-4 w-4" />
            All sets
          </Link>
        </Button>
        <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-end">
          <div className="flex items-start gap-3">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-muted">
              <SetSymbol
                symbolUrl={set?.iconUrl}
                symbolFallbackUrl={set?.iconFallbackUrl}
                logoUrl={set?.logoUrl}
                setCode={setCode}
                setName={setTitle}
                tcg={tcg}
                size="lg"
                className="max-h-10 max-w-10"
              />
            </div>
            <div className="space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="outline">{GAME_LABELS[tcg]}</Badge>
                <Badge variant="secondary">{setCode.toUpperCase()}</Badge>
                {releaseDate && (
                  <span className="text-xs text-muted-foreground">
                    Released {releaseDate}
                  </span>
                )}
              </div>
              <h1 className="text-3xl font-heading font-semibold">
                {setTitle}
              </h1>
              <p className="text-sm text-muted-foreground">{scopeSentence}</p>
            </div>
          </div>
          <Select
            value={collectionId}
            onValueChange={setCollectionId}
            disabled={collectionsLoading}
          >
            <SelectTrigger
              className="w-full sm:w-[240px]"
              aria-label="Collection context"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_COLLECTION_ID}>All collection</SelectItem>
              {collections.map((collection) => (
                <SelectItem key={collection.id} value={collection.id}>
                  {collection.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {loadError ? (
        <UiCard className="border-destructive">
          <CardContent className="py-10 text-center text-destructive">
            {loadError instanceof Error
              ? loadError.message
              : "Unable to load this set."}
          </CardContent>
        </UiCard>
      ) : cardsQuery.isLoading ? (
        <UiCard>
          <CardContent className="flex min-h-72 items-center justify-center gap-2 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
            Loading set checklist…
          </CardContent>
        </UiCard>
      ) : (
        <>
          <UiCard className={cn(progress.complete && "border-emerald-500/50")}>
            <CardContent className="grid gap-5 pt-6 md:grid-cols-[220px_1fr] md:items-center">
              <div>
                <p className="text-3xl font-heading font-semibold">
                  {progress.owned}
                  <span className="text-lg text-muted-foreground">
                    {" "}
                    / {progress.total}
                  </span>
                </p>
                <p className="text-sm text-muted-foreground">
                  unique printings owned
                </p>
              </div>
              <div className="space-y-2">
                <div className="flex items-center justify-between text-sm">
                  <span>{progress.percent}% complete</span>
                  {progress.complete && (
                    <span className="flex items-center gap-1 font-medium text-emerald-600 dark:text-emerald-400">
                      <Check className="h-4 w-4" />
                      Set complete
                    </span>
                  )}
                </div>
                <div
                  className="h-3 overflow-hidden rounded-full bg-muted"
                  role="progressbar"
                  aria-label={`${setTitle} completion`}
                  aria-valuemin={0}
                  aria-valuemax={progress.total}
                  aria-valuenow={progress.owned}
                >
                  <div
                    className={cn(
                      "h-full rounded-full bg-primary transition-all",
                      progress.complete && "bg-emerald-500",
                    )}
                    style={{ width: `${progress.percent}%` }}
                  />
                </div>
              </div>
            </CardContent>
          </UiCard>

          <UiCard>
            <CardContent className="grid gap-3 pt-6 sm:grid-cols-2 lg:grid-cols-[1fr_190px_200px_190px_auto]">
              <label className="relative">
                <span className="sr-only">Search cards in this set</span>
                <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                <Input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Search name, number, or rarity"
                  className="pl-9"
                />
              </label>
              <Select value={rarity} onValueChange={setRarity}>
                <SelectTrigger aria-label="Rarity">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All rarities</SelectItem>
                  {rarities.map((value) => (
                    <SelectItem key={value} value={value}>
                      {value}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select
                value={ownership}
                onValueChange={(value) =>
                  setOwnership(value as OwnershipFilter)
                }
              >
                <SelectTrigger aria-label="Ownership">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Owned and missing</SelectItem>
                  <SelectItem value="owned">Owned only</SelectItem>
                  <SelectItem value="missing">Missing only</SelectItem>
                </SelectContent>
              </Select>
              <Select
                value={sort}
                onValueChange={(value) => setSort(value as CardSort)}
              >
                <SelectTrigger aria-label="Sort cards">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="collector">Collector number</SelectItem>
                  <SelectItem value="name">Card name</SelectItem>
                  <SelectItem value="rarity">Rarity</SelectItem>
                </SelectContent>
              </Select>
              <div className="flex rounded-md border p-1">
                <Button
                  type="button"
                  variant={view === "grid" ? "secondary" : "ghost"}
                  size="sm"
                  onClick={() => setView("grid")}
                  aria-label="Grid view"
                >
                  <Grid2X2 className="h-4 w-4" />
                </Button>
                <Button
                  type="button"
                  variant={view === "list" ? "secondary" : "ghost"}
                  size="sm"
                  onClick={() => setView("list")}
                  aria-label="List view"
                >
                  <List className="h-4 w-4" />
                </Button>
              </div>
            </CardContent>
          </UiCard>

          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-muted-foreground">
              Showing {visibleCards.length} of {progress.total} unique printings
            </p>
            <div className="flex flex-wrap items-center gap-2">
              {wishlists.length > 0 && (
                <>
                  <Select value={wishlistId} onValueChange={setWishlistId}>
                    <SelectTrigger
                      className="w-full sm:w-[210px]"
                      aria-label="Target wishlist"
                    >
                      <SelectValue placeholder="Wishlist" />
                    </SelectTrigger>
                    <SelectContent>
                      {wishlists.map((wishlist) => (
                        <SelectItem key={wishlist.id} value={wishlist.id}>
                          {wishlist.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => void trackSetInWishlist()}
                    disabled={wishlistBusy || !wishlistId || !setCards.length}
                    title="Add every card in this set to the wishlist and keep it updated"
                  >
                    {wishlistBusy ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <Heart className="mr-2 h-4 w-4" />
                    )}
                    Track set in wishlist
                  </Button>
                </>
              )}
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  setSelectedCardIds(
                    new Set(
                      visibleCards
                        .filter(
                          (card) =>
                            !progress.ownedPrintingKeys.has(
                              getPrintingIdentity(card),
                            ),
                        )
                        .map((card) => card.id),
                    ),
                  )
                }
              >
                Select visible missing
              </Button>
            </div>
          </div>

          {selectedCardIds.size > 0 && (
            <UiCard className="sticky top-3 z-20 border-primary/40 shadow-lg">
              <CardContent className="flex flex-col gap-3 p-3 sm:flex-row sm:items-center">
                <span className="text-sm font-medium">
                  {selectedCardIds.size} selected
                </span>
                <Select value={bulkBinderId} onValueChange={setBulkBinderId}>
                  <SelectTrigger
                    className="sm:w-56"
                    aria-label="Bulk add binder"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={LIBRARY_COLLECTION_ID}>
                      Unsorted
                    </SelectItem>
                    {collections
                      .filter((entry) => entry.id !== LIBRARY_COLLECTION_ID)
                      .map((entry) => (
                        <SelectItem key={entry.id} value={entry.id}>
                          {entry.name}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
                <Button
                  size="sm"
                  onClick={() => void addSelectedCards()}
                  disabled={bulkAdding}
                >
                  {bulkAdding ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Plus className="mr-2 h-4 w-4" />
                  )}
                  Add to binder
                </Button>
                {wishlists.length > 0 && (
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => void addSelectedToWishlist()}
                    disabled={wishlistBusy || !wishlistId}
                  >
                    {wishlistBusy ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <Heart className="mr-2 h-4 w-4" />
                    )}
                    Add to wishlist
                  </Button>
                )}
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setSelectedCardIds(new Set())}
                  disabled={bulkAdding}
                >
                  <X className="mr-2 h-4 w-4" />
                  Clear
                </Button>
                {bulkStatus && (
                  <span className="text-xs text-muted-foreground">
                    {bulkStatus}
                  </span>
                )}
              </CardContent>
            </UiCard>
          )}

          {visibleCards.length === 0 ? (
            <UiCard>
              <CardContent className="py-12 text-center text-muted-foreground">
                No printings match these filters.
              </CardContent>
            </UiCard>
          ) : (
            <div
              className={cn(
                view === "grid"
                  ? "grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5"
                  : "space-y-2",
              )}
            >
              {visibleCards.map((card) => {
                const owned = progress.ownedPrintingKeys.has(
                  getPrintingIdentity(card),
                );
                return (
                  <SetCardEntry
                    key={getPrintingIdentity(card)}
                    card={card}
                    owned={owned}
                    view={view}
                    selected={selectedCardIds.has(card.id)}
                    onToggle={() => toggleSelected(card.id)}
                  />
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function SetCardEntry({
  card,
  owned,
  view,
  selected,
  onToggle,
}: {
  card: TradingCard;
  owned: boolean;
  view: ViewMode;
  selected: boolean;
  onToggle: () => void;
}) {
  const image =
    card.imageUrlSmall ?? card.imageUrl ?? getCardBackImage(card.tcg);
  const details = [
    card.collectorNumber ? `#${card.collectorNumber}` : null,
    card.rarity,
  ].filter(Boolean);

  if (view === "list") {
    return (
      <UiCard className={cn(owned && "border-emerald-500/40 bg-emerald-500/5")}>
        <CardContent className="flex items-center gap-4 p-3">
          <div className="relative h-16 w-12 shrink-0 overflow-hidden rounded bg-muted">
            <CardImage
              src={image}
              fallbackSrc={card.imageUrl}
              tcg={card.tcg}
              alt=""
              fill
              sizes="48px"
              className="object-contain"
              unoptimized
            />
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate font-medium">{card.name}</p>
            <p className="truncate text-xs text-muted-foreground">
              {details.join(" · ") || "Printing details unavailable"}
            </p>
          </div>
          <OwnershipBadge owned={owned} />
          <Button
            variant={selected ? "default" : "outline"}
            size="sm"
            onClick={onToggle}
          >
            {selected ? "Selected" : "Select"}
          </Button>
        </CardContent>
      </UiCard>
    );
  }

  return (
    <UiCard
      className={cn(
        "overflow-hidden",
        owned && "border-emerald-500/40 bg-emerald-500/5",
      )}
    >
      <CardContent className="space-y-3 p-3">
        <div className="relative aspect-[5/7] overflow-hidden rounded-md bg-muted">
          <CardImage
            src={image}
            fallbackSrc={card.imageUrl}
            tcg={card.tcg}
            alt={card.name}
            fill
            sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 20vw"
            className={cn(
              "object-contain transition",
              !owned && "grayscale-[0.35] opacity-70",
            )}
            unoptimized
          />
          <div className="absolute right-2 top-2">
            <OwnershipBadge owned={owned} compact />
          </div>
        </div>
        <div className="min-w-0">
          <p className="line-clamp-2 text-sm font-medium">{card.name}</p>
          <p className="mt-1 truncate text-xs text-muted-foreground">
            {details.join(" · ") || "Printing details unavailable"}
          </p>
        </div>
        <Button
          variant={selected ? "default" : "outline"}
          size="sm"
          className="w-full"
          onClick={onToggle}
        >
          {selected ? "Selected" : "Select"}
        </Button>
      </CardContent>
    </UiCard>
  );
}

function OwnershipBadge({
  owned,
  compact = false,
}: {
  owned: boolean;
  compact?: boolean;
}) {
  return (
    <Badge
      variant={owned ? "default" : "secondary"}
      className={cn(
        owned &&
          "border-emerald-600 bg-emerald-600 text-white hover:bg-emerald-600",
        compact && "h-7 w-7 justify-center rounded-full p-0",
      )}
    >
      {owned ? (
        <>
          <Check className={cn("h-3.5 w-3.5", !compact && "mr-1")} />
          {!compact && "Owned"}
        </>
      ) : (
        <>
          <Sparkles className={cn("h-3.5 w-3.5", !compact && "mr-1")} />
          {!compact && "Missing"}
        </>
      )}
    </Badge>
  );
}
