"use client";

import Image from "next/image";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  Download,
  Filter,
  Loader2,
  Plus,
  RefreshCcw,
  Trash,
  TrendingUp,
} from "lucide-react";

import { CollectionSummary } from "@/components/collections/collection-summary";
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
import { Slider } from "@/components/ui/slider";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn, GAME_LABELS, type SupportedGame } from "@/lib/utils";
import { hexToRgba, normalizeHexColor } from "@/lib/color";
import type {
  Collection as CollectionEntity,
  UpdateCollectionCardInput,
} from "@/lib/api/collections";
import { LIBRARY_COLLECTION_ID } from "@/lib/api/collections";
import {
  ALL_COLLECTION_ID,
  useCollectionData,
} from "@/lib/hooks/use-collection";
import { useGameFilterStore } from "@/stores/game-filter";
import { useModuleStore } from "@/stores/preferences";
import type { CollectionCard, CollectionCardCopy, TcgCode } from "@/types/card";
import { useCollectionsStore } from "@/stores/collections";
import { useAuthStore } from "@/stores/auth";
import { SetSymbol } from "@/components/cards/set-symbol";
import { getAppRoute } from "@/lib/app-routes";

type CardUpdateArgs = {
  cardId: string;
  binderId: string;
  updates: UpdateCollectionCardInput;
};

type CardMoveArgs = {
  cardId: string;
  fromBinderId: string;
  toBinderId: string;
};

export function CollectionTable() {
  const selectedGame = useGameFilterStore((state) => state.selectedGame);
  const token = useAuthStore((state) => state.token);
  const { collections, addCollection, removeCollection, updateCollectionCard } =
    useCollectionsStore((state) => ({
      collections: state.collections,
      addCollection: state.addCollection,
      removeCollection: state.removeCollection,
      updateCollectionCard: state.updateCollectionCard,
    }));
  const { enabledGames, showPricing, showCardNumbers } = useModuleStore(
    (state) => ({
      enabledGames: state.enabledGames,
      showPricing: state.showPricing,
      showCardNumbers: state.showCardNumbers,
    }),
  );
  const [activeCollectionId, setActiveCollectionId] = useState<string>(
    collections.length ? ALL_COLLECTION_ID : "",
  );
  const [searchTerm, setSearchTerm] = useState("");
  const [sortBy, setSortBy] = useState<"name" | "rarity" | "price" | "number">(
    "name",
  );
  const [isFilterOpen, setFilterOpen] = useState(false);
  const [rarityFilter, setRarityFilter] = useState<string>("all");
  const [priceRange, setPriceRange] = useState<[number, number]>([0, 100]);
  const [selection, setSelection] = useState<Record<string, boolean>>({});
  const previousCollectionId = useRef<string | null>(null);
  const [isCreateDialogOpen, setCreateDialogOpen] = useState(false);
  const [activeCardId, setActiveCardId] = useState<string | null>(null);
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const handleCardUpdate = async ({
    cardId,
    binderId,
    updates,
  }: CardUpdateArgs) => {
    if (!token) {
      throw new Error("You must be signed in to update cards.");
    }
    await updateCollectionCard(token, binderId, cardId, updates);
  };
  const handleCardMove = async ({
    cardId,
    fromBinderId,
    toBinderId,
  }: CardMoveArgs) => {
    if (!token) {
      throw new Error("You must be signed in to move cards.");
    }
    await updateCollectionCard(token, fromBinderId, cardId, {
      targetBinderId: toBinderId,
    });
  };

  const changeActiveCollection = useCallback(
    (id: string, updateUrl = true) => {
      setActiveCollectionId(id);
      if (!updateUrl) return;
      const search = id
        ? `?binder=${id === ALL_COLLECTION_ID ? "all" : encodeURIComponent(id)}`
        : "";
      router.replace(`${getAppRoute("/collections", pathname)}${search}`, {
        scroll: false,
      });
    },
    [pathname, router],
  );

  useEffect(() => {
    if (!showPricing && sortBy === "price") {
      setSortBy("name");
    }
  }, [showPricing, sortBy]);

  useEffect(() => {
    if (!collections.length) {
      if (activeCollectionId !== "") {
        changeActiveCollection("", false);
        router.replace(getAppRoute("/collections", pathname), {
          scroll: false,
        });
      }
      return;
    }

    const binderFromQuery = searchParams.get("binder");
    const normalizedQueryId =
      binderFromQuery === "all" ? ALL_COLLECTION_ID : binderFromQuery;

    if (normalizedQueryId) {
      const available =
        normalizedQueryId === ALL_COLLECTION_ID ||
        collections.some((collection) => collection.id === normalizedQueryId);
      if (available && normalizedQueryId !== activeCollectionId) {
        changeActiveCollection(normalizedQueryId, false);
        return;
      }
    }

    const isValidActive =
      activeCollectionId === ALL_COLLECTION_ID ||
      collections.some((collection) => collection.id === activeCollectionId);

    if (!isValidActive) {
      changeActiveCollection(ALL_COLLECTION_ID);
    }
  }, [
    collections,
    activeCollectionId,
    searchParams,
    changeActiveCollection,
    pathname,
    router,
  ]);

  useEffect(() => {
    setSelection({});
    setSearchTerm("");
    setRarityFilter("all");
  }, [activeCollectionId]);

  const { collection, items, isLoading, maxPrice, totalQuantity, totalValue } =
    useCollectionData({
      collectionId: activeCollectionId,
      query: searchTerm,
      game: selectedGame as SupportedGame | "all",
      enabledGames,
    });
  const activeAccent = normalizeHexColor(collection?.colorHex);
  const activeCardGlow = activeAccent
    ? hexToRgba(activeAccent, 0.22)
    : undefined;
  const activeCardFill = activeAccent
    ? hexToRgba(activeAccent, 0.12)
    : undefined;
  const activeCardSoft = activeAccent
    ? hexToRgba(activeAccent, 0.05)
    : undefined;

  const selectedGameDisabled =
    selectedGame !== "all" &&
    !enabledGames[selectedGame as keyof typeof enabledGames];
  const noGamesEnabled =
    !enabledGames.yugioh && !enabledGames.magic && !enabledGames.pokemon;

  const defaultMaxPrice = useMemo(
    () => Math.max(Math.ceil(maxPrice || 50), 10),
    [maxPrice],
  );

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
      if (rarityFilter !== "all" && card.rarity !== rarityFilter) return false;
      if (showPricing) {
        const cardPrice = card.price ?? 0;
        if (cardPrice < priceRange[0] || cardPrice > priceRange[1])
          return false;
      }
      return true;
    });
  }, [items, priceRange, rarityFilter, showPricing]);

  const sortedCards = useMemo(() => {
    return [...filtered].sort((a, b) =>
      compareCards(a, b, sortBy, showPricing),
    );
  }, [filtered, sortBy, showPricing]);

  useEffect(() => {
    if (!sortedCards.length) {
      setActiveCardId(null);
      return;
    }

    setActiveCardId((current) => {
      const stillVisible =
        current && sortedCards.some((card) => card.id === current);
      if (stillVisible) {
        return current;
      }
      return sortedCards[0]?.id ?? null;
    });
  }, [sortedCards]);

  const activeCard = useMemo(
    () => sortedCards.find((card) => card.id === activeCardId) ?? null,
    [sortedCards, activeCardId],
  );
  const fallbackBinderContext =
    collection && collection.id !== ALL_COLLECTION_ID
      ? {
          id: collection.id,
          name: collection.name,
          colorHex: collection.colorHex,
        }
      : undefined;
  const activeBinderId = activeCard?.binderId ?? fallbackBinderContext?.id;
  const activeBinderName =
    activeCard?.binderName ?? fallbackBinderContext?.name;
  const activeBinderColor =
    activeCard?.binderColorHex ?? fallbackBinderContext?.colorHex;
  const binderOptions = useMemo(
    () =>
      collections.map((entry) => ({
        id: entry.id,
        name: entry.name,
        colorHex: entry.colorHex,
      })),
    [collections],
  );

  const selectedIds = useMemo(
    () =>
      Object.entries(selection)
        .filter(([, checked]) => checked)
        .map(([id]) => id),
    [selection],
  );
  const selectedSnapshot = useMemo(() => {
    if (!selectedIds.length) {
      return null;
    }
    const selectedCards = items.filter((card) => selection[card.id]);
    const copies = selectedCards.reduce((sum, card) => sum + card.quantity, 0);
    return {
      cards: selectedCards.length,
      copies,
    };
  }, [items, selectedIds, selection]);

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
  const clearSelection = () => {
    setSelection({});
  };

  const handleExport = () => {
    const exportRows = (
      selectedIds.length
        ? sortedCards.filter((card) => selection[card.id])
        : sortedCards
    ).map((card) => {
      const base = {
        Name: card.name,
        Game: GAME_LABELS[card.tcg],
        Set: card.setName ?? card.setCode ?? "Unknown",
        Rarity: card.rarity ?? "N/A",
        Quantity: card.quantity,
        Condition: card.condition ?? "Unknown",
      } as Record<string, unknown>;

      if (showPricing) {
        base["EstimatedPrice"] = card.price ?? 0;
      }

      return base;
    });

    const fallbackHeader = showPricing
      ? {
          Name: "",
          Game: "",
          Set: "",
          Rarity: "",
          Quantity: 0,
          Condition: "",
          EstimatedPrice: 0,
        }
      : { Name: "", Game: "", Set: "", Rarity: "", Quantity: 0, Condition: "" };
    const header = Object.keys(exportRows[0] ?? fallbackHeader);
    const csvLines = [
      header.join(","),
      ...exportRows.map((row) =>
        header
          .map((key) => formatCsvValue(row[key as keyof typeof row]))
          .join(","),
      ),
    ];
    const blob = new Blob([csvLines.join("\n")], {
      type: "text/csv;charset=utf-8;",
    });
    const url = URL.createObjectURL(blob);
    const exportName = (collection?.name ?? "collection")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "");

    const link = document.createElement("a");
    link.href = url;
    link.setAttribute(
      "download",
      `${exportName || "collection"}-export-${Date.now()}.csv`,
    );
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6" data-oid="z2o81lr">
      <CollectionSelector
        collections={collections}
        activeId={activeCollectionId}
        onSelect={(id) => changeActiveCollection(id)}
        onCreate={() => setCreateDialogOpen(true)}
        onRemove={(id) => {
          if (
            confirm(
              "Remove this binder? Cards in the binder will not be recoverable unless re-imported.",
            )
          ) {
            if (token) {
              removeCollection(token, id);
            }
          }
        }}
        showPricing={showPricing}
        data-oid="5ua-_o0"
      />

      <CollectionSummary
        items={items}
        selectedIds={selectedIds}
        totalQuantity={totalQuantity}
        totalValue={totalValue}
        showPricing={showPricing}
        data-oid="ij3hm9k"
      />

      <Card
        style={
          activeAccent
            ? {
                borderColor: activeAccent,
                boxShadow: activeCardGlow
                  ? `0 20px 32px -24px ${activeCardGlow}`
                  : undefined,
                backgroundImage:
                  activeCardFill && activeCardSoft
                    ? `linear-gradient(135deg, ${activeCardFill} 0%, ${activeCardSoft} 100%)`
                    : undefined,
              }
            : undefined
        }
        data-oid="1v59w57"
      >
        <CardHeader
          className="flex flex-col gap-4 border-b pb-4 md:flex-row md:items-center md:justify-between"
          data-oid="x9u:nhb"
        >
          <div data-oid="upik7fh">
            <CardTitle className="flex items-center gap-2" data-oid="yzqm4v1">
              {activeAccent ? (
                <span
                  className="inline-flex h-2.5 w-2.5 rounded-full"
                  style={{ backgroundColor: activeAccent }}
                  aria-hidden="true"
                  data-oid=":j-h716"
                />
              ) : null}
              <span data-oid="5pqypc6">
                {collection?.name ?? "Collection Manager"}
              </span>
            </CardTitle>
            <CardDescription data-oid=":vbf8dc">
              {collection?.description ??
                "Manage quantities, review price trends, and prepare CSV exports for grading or trading."}
              {collection && (
                <span
                  className="mt-1 block text-xs text-muted-foreground"
                  data-oid="-qsr2c4"
                >
                  {uniqueCardCount} unique cards
                  {collection.id === ALL_COLLECTION_ID
                    ? ` across ${collections.length} binder(s)`
                    : ""}{" "}
                  • Updated{" "}
                  {new Date(collection.updatedAt).toLocaleDateString()}
                </span>
              )}
            </CardDescription>
          </div>
          <div className="flex flex-wrap items-center gap-2" data-oid="yzlahyi">
            <Input
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
              placeholder="Search within collection"
              className="w-48 sm:w-64"
              data-oid="m5xjcwh"
            />

            <Select
              value={sortBy}
              onValueChange={(value) => setSortBy(value as typeof sortBy)}
              data-oid="6iz37ua"
            >
              <SelectTrigger className="w-[140px]" data-oid="6sj8jhw">
                <SelectValue placeholder="Sort by" data-oid="2qvjw4e" />
              </SelectTrigger>
              <SelectContent data-oid="7ds20r6">
                <SelectItem value="name" data-oid="n2a4yw5">
                  Name
                </SelectItem>
                <SelectItem value="number" data-oid="p:w.svu">
                  Card number
                </SelectItem>
                <SelectItem value="rarity" data-oid="ko29k2a">
                  Rarity
                </SelectItem>
                {showPricing && (
                  <SelectItem value="price" data-oid="9hvpp::">
                    Estimated price
                  </SelectItem>
                )}
              </SelectContent>
            </Select>
            <Button
              variant="outline"
              size="sm"
              className="gap-2"
              onClick={() => setFilterOpen(true)}
              data-oid="73sb3o."
            >
              <Filter className="h-4 w-4" data-oid="3-kvget" />
              Filters
            </Button>
            <Button
              size="sm"
              className="gap-2"
              onClick={handleExport}
              disabled={sortedCards.length === 0}
              data-oid="1g3lkbp"
            >
              <Download className="h-4 w-4" data-oid="bqe.:6r" />
              Export
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4" data-oid="fgkkd6j">
          <ActiveFilters
            rarity={rarityFilter}
            priceRange={priceRange}
            showPricing={showPricing}
            defaultMax={defaultMaxPrice}
            onClear={() =>
              resetFilters(setRarityFilter, setPriceRange, defaultMaxPrice)
            }
            data-oid="::7:4d9"
          />

          {selectedSnapshot ? (
            <div
              className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-dashed bg-muted/30 px-3 py-2 text-xs text-muted-foreground"
              data-oid="xojntt1"
            >
              <p data-oid="7vtm2de">
                {selectedSnapshot.cards} card
                {selectedSnapshot.cards === 1 ? "" : "s"} selected ·{" "}
                {selectedSnapshot.copies} copy
                {selectedSnapshot.copies === 1 ? "" : "ies"}.
              </p>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="h-7 px-2 text-xs"
                onClick={clearSelection}
                data-oid="v_vkuef"
              >
                Clear selection
              </Button>
            </div>
          ) : null}

          <div
            className="grid gap-4 lg:grid-cols-[minmax(260px,320px)_1fr]"
            data-oid="o9xntw8"
          >
            <CardDetailsPanel
              card={activeCard}
              binderId={activeBinderId}
              binderName={activeBinderName}
              binderColor={activeBinderColor}
              showPricing={showPricing}
              showCardNumbers={showCardNumbers}
              parentCollectionName={collection?.name}
              onUpdate={handleCardUpdate}
              binderOptions={binderOptions}
              onMove={handleCardMove}
              data-oid="rhu4wwa"
            />

            <div className="relative" data-oid="94-q7ex">
              <ScrollArea
                className="h-[620px] rounded-md border"
                data-oid=":n:bbpv"
              >
                {isLoading ? (
                  <div
                    className="flex h-full min-h-[240px] items-center justify-center text-sm text-muted-foreground"
                    data-oid="pv.y4mi"
                  >
                    <div className="flex items-center gap-2" data-oid="l.-vb32">
                      <Loader2
                        className="h-4 w-4 animate-spin"
                        data-oid="szf6skl"
                      />{" "}
                      Loading collection data...
                    </div>
                  </div>
                ) : groupedByGame.length === 0 ? (
                  <div
                    className="flex h-full min-h-[240px] items-center justify-center text-sm text-muted-foreground"
                    data-oid="ft7fo_g"
                  >
                    {noGamesEnabled
                      ? "All modules are disabled. Re-enable them in settings to view your catalog."
                      : selectedGameDisabled
                        ? "Selected game is disabled. Enable it from module preferences to manage its collection."
                        : "No cards matched your filters."}
                  </div>
                ) : (
                  <div className="space-y-8 p-4" data-oid="smryhzo">
                    {groupedByGame.map(([tcg, cardsForGame]) => {
                      const gameValue = cardsForGame.reduce(
                        (sum, card) => sum + (card.price ?? 0) * card.quantity,
                        0,
                      );
                      const gameQuantity = cardsForGame.reduce(
                        (sum, card) => sum + card.quantity,
                        0,
                      );

                      return (
                        <div key={tcg} className="space-y-3" data-oid="gfplifb">
                          <div
                            className="flex items-center justify-between"
                            data-oid=":q0w:v3"
                          >
                            <div data-oid="_4ij.sh">
                              <h3
                                className="text-sm font-semibold"
                                data-oid="_b.a0rb"
                              >
                                {GAME_LABELS[tcg as keyof typeof GAME_LABELS]}
                              </h3>
                              <p
                                className="text-xs text-muted-foreground"
                                data-oid="_:mxbv3"
                              >
                                {cardsForGame.length} card(s), {gameQuantity}{" "}
                                copies
                                {showPricing
                                  ? ` • $${gameValue.toFixed(2)}`
                                  : ""}
                              </p>
                            </div>
                            <Badge
                              variant="outline"
                              className="uppercase"
                              data-oid="awrj_it"
                            >
                              {GAME_LABELS[tcg as keyof typeof GAME_LABELS] ??
                                tcg}
                            </Badge>
                          </div>

                          <Table data-oid="65ye97w">
                            <TableHeader
                              className="bg-muted/30"
                              data-oid="ndw81uh"
                            >
                              <TableRow data-oid="6_hxz8z">
                                <TableHead className="w-10" data-oid="n_h8igd">
                                  <Checkbox
                                    checked={cardsForGame.every(
                                      (card) => selection[card.id],
                                    )}
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
                                    data-oid="fxozyrf"
                                  />
                                </TableHead>
                                <TableHead data-oid="5bpptyy">Name</TableHead>
                                <TableHead data-oid="x2b7603">Set</TableHead>
                                <TableHead data-oid="uvm8n4a">Rarity</TableHead>
                                <TableHead
                                  className="text-right"
                                  data-oid="qx.f7ty"
                                >
                                  Quantity
                                </TableHead>
                                <TableHead
                                  className="text-right"
                                  data-oid=".ucrrnn"
                                >
                                  Condition
                                </TableHead>
                                {showPricing && (
                                  <TableHead
                                    className="text-right"
                                    data-oid="shig29x"
                                  >
                                    Est. Price
                                  </TableHead>
                                )}
                              </TableRow>
                            </TableHeader>
                            <TableBody data-oid="rc8wh2c">
                              {cardsForGame.map((card) => (
                                <CollectionRow
                                  key={card.id}
                                  card={card}
                                  selected={!!selection[card.id]}
                                  onToggle={() => toggleRow(card.id)}
                                  showPricing={showPricing}
                                  showCardNumbers={showCardNumbers}
                                  showBinderName={
                                    collection?.id === ALL_COLLECTION_ID
                                  }
                                  isActive={card.id === activeCard?.id}
                                  onSelectCard={() => setActiveCardId(card.id)}
                                  data-oid="1mdp_n8"
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
        data-oid=".xb68zz"
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
        data-oid="3gw0lxy"
      />
    </div>
  );
}

const CONDITION_OPTIONS = [
  "Mint",
  "Near Mint",
  "Lightly Played",
  "Moderately Played",
  "Heavily Played",
  "Damaged",
];
const EMPTY_CONDITION_VALUE = "__condition-empty__";

function CardDetailsPanel({
  card,
  binderId,
  binderName,
  binderColor,
  showPricing,
  showCardNumbers,
  parentCollectionName,
  onUpdate,
  binderOptions,
  onMove,
}: {
  card: CollectionCard | null;
  binderId?: string;
  binderName?: string;
  binderColor?: string | null;
  showPricing: boolean;
  showCardNumbers: boolean;
  parentCollectionName?: string;
  onUpdate: (args: CardUpdateArgs) => Promise<void>;
  binderOptions: { id: string; name: string; colorHex?: string | null }[];
  onMove: (args: CardMoveArgs) => Promise<void>;
}) {
  const copies = useMemo(
    () => (card?.copies ?? []) as CollectionCardCopy[],
    [card?.copies],
  );
  const [selectedCopyId, setSelectedCopyId] = useState<string | null>(null);
  const [condition, setCondition] = useState<string | null>(null);
  const [notes, setNotes] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [status, setStatus] = useState<"idle" | "success" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [pendingBinderId, setPendingBinderId] = useState<string>(
    () => binderId ?? binderOptions[0]?.id ?? "",
  );
  const [moveStatus, setMoveStatus] = useState<
    "idle" | "pending" | "success" | "error"
  >("idle");
  const [moveError, setMoveError] = useState<string | null>(null);
  const selectedCopy = useMemo(
    () => copies.find((copy) => copy.id === selectedCopyId) ?? null,
    [copies, selectedCopyId],
  );

  useEffect(() => {
    if (!card) {
      setSelectedCopyId(null);
      return;
    }
    setSelectedCopyId((current) => {
      if (current && copies.some((copy) => copy.id === current)) {
        return current;
      }
      if (copies.length === 1) {
        return copies[0].id;
      }
      return null;
    });
  }, [card, copies]);

  useEffect(() => {
    if (selectedCopy) {
      setCondition(selectedCopy.condition ?? null);
      setNotes(selectedCopy.notes ?? "");
    } else {
      setCondition(null);
      setNotes("");
    }
    setStatus("idle");
    setErrorMessage(null);
  }, [selectedCopy]);
  useEffect(() => {
    if (binderId) {
      setPendingBinderId(binderId);
      return;
    }
    if (binderOptions.length) {
      setPendingBinderId((current) => {
        if (current && binderOptions.some((option) => option.id === current)) {
          return current;
        }
        return binderOptions[0].id;
      });
    } else {
      setPendingBinderId("");
    }
  }, [binderId, binderOptions]);

  useEffect(() => {
    if (status !== "success") {
      return;
    }

    const timer = setTimeout(() => setStatus("idle"), 2500);
    return () => clearTimeout(timer);
  }, [status]);
  useEffect(() => {
    if (moveStatus !== "success") {
      return;
    }
    const timer = setTimeout(() => setMoveStatus("idle"), 2500);
    return () => clearTimeout(timer);
  }, [moveStatus]);
  useEffect(() => {
    setMoveStatus("idle");
    setMoveError(null);
  }, [card?.id, selectedCopy?.id]);

  const conditionChoices = useMemo(() => {
    if (!selectedCopy?.condition) {
      return CONDITION_OPTIONS;
    }
    if (CONDITION_OPTIONS.includes(selectedCopy.condition)) {
      return CONDITION_OPTIONS;
    }
    return [selectedCopy.condition, ...CONDITION_OPTIONS];
  }, [selectedCopy?.condition]);

  const pendingPayload = useMemo<UpdateCollectionCardInput | null>(() => {
    if (!selectedCopy) {
      return null;
    }

    const updates: UpdateCollectionCardInput = {};
    if ((condition ?? null) !== (selectedCopy.condition ?? null)) {
      updates.condition = condition;
    }

    if (notes !== (selectedCopy.notes ?? "")) {
      const trimmed = notes.trim();
      updates.notes = trimmed.length ? notes : null;
    }

    return Object.keys(updates).length ? updates : null;
  }, [selectedCopy, condition, notes]);

  const hasChanges = Boolean(pendingPayload);
  const canEdit = Boolean(card && binderId && selectedCopy);
  const canMove = Boolean(
    card &&
      binderId &&
      selectedCopy &&
      pendingBinderId &&
      pendingBinderId !== binderId,
  );
  const binderAccent = normalizeHexColor(binderColor ?? undefined);
  const binderChipStyle: CSSProperties | undefined = binderAccent
    ? {
        backgroundColor: hexToRgba(binderAccent, 0.18),
        color: binderAccent,
      }
    : undefined;

  const handleSave = async () => {
    if (!card || !binderId || !pendingPayload || !selectedCopy) {
      return;
    }

    setIsSaving(true);
    setStatus("idle");
    setErrorMessage(null);
    try {
      await onUpdate({
        cardId: selectedCopy.id,
        binderId,
        updates: pendingPayload,
      });
      setStatus("success");
    } catch (error) {
      setStatus("error");
      setErrorMessage(
        error instanceof Error ? error.message : "Failed to update card.",
      );
    } finally {
      setIsSaving(false);
    }
  };

  const handleReset = () => {
    setCondition(selectedCopy?.condition ?? null);
    setNotes(selectedCopy?.notes ?? "");
    setStatus("idle");
    setErrorMessage(null);
  };
  const handleMove = async () => {
    if (
      !card ||
      !binderId ||
      !pendingBinderId ||
      pendingBinderId === binderId ||
      !selectedCopy
    ) {
      return;
    }
    setMoveStatus("pending");
    setMoveError(null);
    try {
      await onMove({
        cardId: selectedCopy.id,
        fromBinderId: binderId,
        toBinderId: pendingBinderId,
      });
      setMoveStatus("success");
    } catch (error) {
      setMoveStatus("error");
      setMoveError(
        error instanceof Error ? error.message : "Failed to move card.",
      );
    }
  };

  const cardImageUrl = card?.imageUrl ?? card?.imageUrlSmall ?? null;

  return (
    <div
      className="rounded-md border bg-muted/30 p-4 max-h-[80vh] overflow-y-auto lg:max-h-[620px] lg:min-h-[620px]"
      data-oid="n9390o4"
    >
      {!card ? (
        <div
          className="flex min-h-[280px] flex-col items-center justify-center text-center text-sm text-muted-foreground"
          data-oid="oy4-rep"
        >
          <p data-oid="mc0.id:">
            Select a card from the table to view its details and artwork.
          </p>
        </div>
      ) : (
        <div className="flex min-h-full flex-col gap-4" data-oid="ez7s:g:">
          <div className="space-y-3" data-oid="kq2f4v0">
            <div className="flex justify-center" data-oid="kzl6p-.">
              <div
                className="relative aspect-[63/88] w-full max-w-[220px] overflow-hidden rounded-lg border bg-muted"
                data-oid="hzv6u2-"
              >
                {cardImageUrl ? (
                  <Image
                    src={cardImageUrl}
                    alt={card.name}
                    fill
                    className="object-contain"
                    sizes="(min-width: 1024px) 220px, 70vw"
                    data-oid="8t22ia6"
                  />
                ) : card.setSymbolUrl ? (
                  <div
                    className="flex h-full items-center justify-center bg-background"
                    data-oid="1:hycf5"
                  >
                    <Image
                      src={card.setSymbolUrl}
                      alt={`${card.setName ?? card.setCode ?? "Set"} symbol`}
                      width={72}
                      height={72}
                      data-oid="l3a_aaw"
                    />
                  </div>
                ) : (
                  <div
                    className="flex h-full items-center justify-center text-xs text-muted-foreground"
                    data-oid="9kextly"
                  >
                    No image available
                  </div>
                )}
              </div>
            </div>
            {cardImageUrl && (
              <Button asChild variant="secondary" size="sm" data-oid="dc_g1og">
                <a
                  href={cardImageUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  data-oid="9vsixsy"
                >
                  Open image in new tab
                </a>
              </Button>
            )}
            <div data-oid="rlyn-wo">
              <h3
                className="text-lg font-semibold leading-tight"
                data-oid="9hdgjv7"
              >
                {card.name}
              </h3>
              <div
                className="flex items-center gap-1.5 text-xs text-muted-foreground mt-0.5"
                data-oid="n329xgk"
              >
                <SetSymbol
                  symbolUrl={card.setSymbolUrl}
                  setCode={card.setCode}
                  setName={card.setName}
                  tcg={card.tcg}
                  size="sm"
                  data-oid="q-3l7-q"
                />

                <span data-oid="yrya3zl">
                  {card.setName ??
                    (showCardNumbers ? card.setCode : undefined) ??
                    "Unknown set"}
                  {showCardNumbers && card.setCode ? ` · #${card.setCode}` : ""}
                </span>
              </div>
              {(binderName || parentCollectionName) && (
                <p
                  className="mt-2 text-xs text-muted-foreground"
                  data-oid="0s4ew4_"
                >
                  Binder{" "}
                  <span
                    className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-medium text-foreground"
                    style={binderChipStyle}
                    data-oid="ie4ycu5"
                  >
                    {binderAccent ? (
                      <span
                        className="inline-flex h-2.5 w-2.5 rounded-full"
                        style={{ backgroundColor: binderAccent }}
                        aria-hidden="true"
                        data-oid="vs_cvwd"
                      />
                    ) : null}
                    <span
                      style={{ color: binderAccent ?? undefined }}
                      data-oid="n8lfo4s"
                    >
                      {binderName ?? parentCollectionName ?? "Unknown binder"}
                    </span>
                  </span>
                </p>
              )}
            </div>
          </div>

          <div
            className="rounded-md border bg-background/40 p-3 text-xs text-muted-foreground"
            data-oid="35d11z8"
          >
            <div className="grid grid-cols-2 gap-3" data-oid="we_o5.a">
              <div data-oid=".z2uu9f">
                <p className="uppercase tracking-wide" data-oid="inw3r05">
                  Game
                </p>
                <p
                  className="text-sm font-semibold text-foreground"
                  data-oid="ngs9pd9"
                >
                  {GAME_LABELS[card.tcg as keyof typeof GAME_LABELS]}
                </p>
              </div>
              <div data-oid=".4u.ca2">
                <p className="uppercase tracking-wide" data-oid="ipjivrj">
                  Rarity
                </p>
                <p
                  className="text-sm font-semibold text-foreground"
                  data-oid="mb_.4fb"
                >
                  {card.rarity ?? "N/A"}
                </p>
              </div>
              <div data-oid="aageomo">
                <p className="uppercase tracking-wide" data-oid=".l:9.lm">
                  Quantity
                </p>
                <p
                  className="text-sm font-semibold text-foreground"
                  data-oid="3jaivjc"
                >
                  {card.quantity}
                </p>
              </div>
              <div data-oid="s6b34l1">
                <p className="uppercase tracking-wide" data-oid="7ewry0z">
                  Condition
                </p>
                <p
                  className="text-sm font-semibold text-foreground"
                  data-oid="7xu7hss"
                >
                  {card.condition ?? "Not specified"}
                </p>
              </div>
              {showPricing ? (
                <div data-oid="0gp2j.1">
                  <p className="uppercase tracking-wide" data-oid="orfkuy-">
                    Est. value
                  </p>
                  <p
                    className="text-sm font-semibold text-foreground"
                    data-oid="5ie2ok3"
                  >
                    ${(card.price ?? 0).toFixed(2)}
                  </p>
                </div>
              ) : null}
            </div>
          </div>

          <div className="space-y-4" data-oid=":z:ldzq">
            <div className="space-y-2" data-oid="1n3_n.5">
              <div
                className="flex items-center justify-between"
                data-oid="q6949ua"
              >
                <p
                  className="text-xs uppercase text-muted-foreground"
                  data-oid="jrchs6j"
                >
                  Individual copies
                </p>
                <Badge variant="outline" data-oid="hn65xmm">
                  {copies.length}
                </Badge>
              </div>
              {copies.length ? (
                <div className="space-y-2" data-oid="ew106p.">
                  {copies.map((copy, index) => {
                    const isSelected = copy.id === selectedCopyId;
                    return (
                      <button
                        key={copy.id}
                        type="button"
                        onClick={() => setSelectedCopyId(copy.id)}
                        className={cn(
                          "w-full rounded-lg border px-3 py-2 text-left text-sm transition hover:border-primary/40",
                          isSelected
                            ? "border-primary bg-primary/5"
                            : "border-muted",
                        )}
                        data-oid="6kacqph"
                      >
                        <div
                          className="flex items-center justify-between gap-2"
                          data-oid="0veqqbs"
                        >
                          <div data-oid="aoird58">
                            <p
                              className="font-medium text-foreground"
                              data-oid="qqu9q:9"
                            >
                              {copy.condition ?? "Unknown"}{" "}
                              <span
                                className="text-muted-foreground"
                                data-oid="lfk1848"
                              >
                                #{index + 1}
                              </span>
                            </p>
                            <p
                              className="text-xs text-muted-foreground line-clamp-2"
                              data-oid="twc6mny"
                            >
                              {copy.notes?.trim() || "No notes yet"}
                            </p>
                          </div>
                          <div
                            className="flex flex-wrap gap-1"
                            data-oid="mc5m:56"
                          >
                            {copy.tags?.length ? (
                              copy.tags.slice(0, 2).map((tag) => (
                                <Badge
                                  key={tag.id}
                                  variant="secondary"
                                  style={{
                                    backgroundColor: tag.colorHex,
                                    color: "#0B1121",
                                  }}
                                  data-oid="q9_z4wf"
                                >
                                  {tag.label}
                                </Badge>
                              ))
                            ) : (
                              <Badge variant="outline" data-oid="8jcmgg-">
                                No tags
                              </Badge>
                            )}
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              ) : (
                <div
                  className="rounded-lg border border-dashed p-3 text-xs text-muted-foreground"
                  data-oid="2s9uudo"
                >
                  No individual copies tracked for this card yet.
                </div>
              )}
            </div>

            <div className="space-y-2" data-oid="pbasrmi">
              <Label htmlFor="binder-assignment" data-oid=":pfbnk5">
                Binder assignment
              </Label>
              <div
                className="flex flex-col gap-2 sm:flex-row sm:items-center"
                data-oid="0x.tgce"
              >
                <Select
                  value={pendingBinderId || undefined}
                  onValueChange={(value) => {
                    setPendingBinderId(value);
                    setMoveStatus("idle");
                    setMoveError(null);
                  }}
                  disabled={
                    !card || !binderOptions.length || moveStatus === "pending"
                  }
                  data-oid="81fq7ix"
                >
                  <SelectTrigger
                    id="binder-assignment"
                    className="w-full sm:flex-1"
                    data-oid="6mqb0xn"
                  >
                    <SelectValue
                      placeholder="Choose a binder"
                      data-oid="yze14ku"
                    />
                  </SelectTrigger>
                  <SelectContent data-oid="o6dl3lz">
                    {binderOptions.map((option) => {
                      const optionLabel =
                        option.name ||
                        (option.id === LIBRARY_COLLECTION_ID
                          ? "Unsorted"
                          : "Untitled binder");
                      const accent = normalizeHexColor(
                        option.colorHex ?? undefined,
                      );
                      return (
                        <SelectItem
                          key={option.id}
                          value={option.id}
                          data-oid="s-j47zb"
                        >
                          <span
                            className="flex items-center gap-2"
                            data-oid="21qsso3"
                          >
                            {accent ? (
                              <span
                                className="inline-flex h-2.5 w-2.5 rounded-full"
                                style={{ backgroundColor: accent }}
                                aria-hidden="true"
                                data-oid="dne05ov"
                              />
                            ) : null}
                            {optionLabel}
                          </span>
                        </SelectItem>
                      );
                    })}
                  </SelectContent>
                </Select>
                <Button
                  type="button"
                  size="sm"
                  className="w-full sm:w-auto"
                  onClick={handleMove}
                  disabled={!canMove || moveStatus === "pending"}
                  data-oid="_cgvqcu"
                >
                  {moveStatus === "pending" ? (
                    <Loader2
                      className="mr-2 h-4 w-4 animate-spin"
                      data-oid="yz2aggy"
                    />
                  ) : null}
                  Move copy
                </Button>
              </div>
              <p className="text-xs text-muted-foreground" data-oid="3fe8.uz">
                {binderOptions.length
                  ? "Move copies between binders or back into the Unsorted library."
                  : "Binders will appear once your account data has loaded."}
              </p>
              {moveStatus === "success" && (
                <p
                  className="text-xs text-emerald-600"
                  aria-live="polite"
                  data-oid="rz1j7-1"
                >
                  Copy reassigned successfully.
                </p>
              )}
              {moveStatus === "error" && (
                <p
                  className="text-xs text-destructive"
                  aria-live="assertive"
                  data-oid="zfcgfmu"
                >
                  {moveError ?? "Unable to move card."}
                </p>
              )}
            </div>

            {selectedCopy ? (
              <>
                <div className="space-y-2" data-oid="b:mp:im">
                  <Label htmlFor="card-condition" data-oid="x-_lui4">
                    Condition
                  </Label>
                  <Select
                    value={condition ?? EMPTY_CONDITION_VALUE}
                    onValueChange={(value) =>
                      setCondition(
                        value === EMPTY_CONDITION_VALUE ? null : value,
                      )
                    }
                    disabled={!canEdit}
                    data-oid="jkvi7r-"
                  >
                    <SelectTrigger id="card-condition" data-oid="4495nm5">
                      <SelectValue
                        placeholder="Select condition"
                        data-oid="lg-ev12"
                      />
                    </SelectTrigger>
                    <SelectContent data-oid="wbcv25r">
                      <SelectItem
                        value={EMPTY_CONDITION_VALUE}
                        data-oid="5pn.w39"
                      >
                        Not specified
                      </SelectItem>
                      {conditionChoices.map((option) => (
                        <SelectItem
                          key={option}
                          value={option}
                          data-oid="zm6rde1"
                        >
                          {option}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2" data-oid="f.gst3p">
                  <Label htmlFor="card-notes" data-oid="01jkp:.">
                    Notes
                  </Label>
                  <Textarea
                    id="card-notes"
                    placeholder="Add personal notes (sleeves, grading plans, etc.)"
                    value={notes}
                    onChange={(event) => setNotes(event.target.value)}
                    rows={4}
                    disabled={!canEdit}
                    data-oid="9_r8uk2"
                  />
                </div>

                <div className="mt-auto space-y-2" data-oid="9:_f4:h">
                  <div
                    className="flex flex-wrap items-center gap-2"
                    data-oid="frpugld"
                  >
                    <Button
                      type="button"
                      size="sm"
                      onClick={handleSave}
                      disabled={!hasChanges || !canEdit || isSaving}
                      data-oid="2v06pj2"
                    >
                      {isSaving ? (
                        <Loader2
                          className="mr-2 h-4 w-4 animate-spin"
                          data-oid="1aujeai"
                        />
                      ) : null}
                      Save changes
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={handleReset}
                      disabled={!canEdit || isSaving || !hasChanges}
                      data-oid="35_bkww"
                    >
                      Reset
                    </Button>
                  </div>
                  {status === "success" && (
                    <p
                      className="text-xs text-emerald-600"
                      aria-live="polite"
                      data-oid="gd.u8ak"
                    >
                      Copy updated successfully.
                    </p>
                  )}
                  {status === "error" && (
                    <p
                      className="text-xs text-destructive"
                      aria-live="assertive"
                      data-oid="ghcuyy0"
                    >
                      {errorMessage ?? "Failed to update copy."}
                    </p>
                  )}
                </div>
              </>
            ) : (
              <div
                className="rounded-lg border border-dashed bg-muted/30 p-4 text-sm text-muted-foreground"
                data-oid="juf.753"
              >
                {copies.length
                  ? "Select a copy above to edit condition, notes, or move it between binders."
                  : "No copies available to edit in this binder."}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function CollectionRow({
  card,
  selected,
  onToggle,
  showPricing,
  showCardNumbers,
  showBinderName,
  isActive,
  onSelectCard,
}: {
  card: CollectionCard;
  selected: boolean;
  onToggle: () => void;
  showPricing: boolean;
  showCardNumbers: boolean;
  showBinderName: boolean;
  isActive: boolean;
  onSelectCard: () => void;
}) {
  const price = card.price ?? 0;
  const previousHistoryEntry =
    card.priceHistory && card.priceHistory.length > 1
      ? card.priceHistory[card.priceHistory.length - 2]
      : undefined;
  const previousPrice =
    previousHistoryEntry !== undefined
      ? typeof previousHistoryEntry === "number"
        ? previousHistoryEntry
        : previousHistoryEntry.price
      : price;
  const delta = previousPrice
    ? ((price - previousPrice) / previousPrice) * 100
    : 0;
  const positive = delta >= 0;
  const binderAccent = normalizeHexColor(card.binderColorHex);
  const binderChipStyle: CSSProperties | undefined = binderAccent
    ? {
        backgroundColor: hexToRgba(binderAccent, 0.18),
        color: binderAccent,
      }
    : undefined;

  return (
    <TableRow
      data-state={selected ? "selected" : undefined}
      className={cn(
        "cursor-pointer transition-colors",
        isActive && "bg-primary/5",
      )}
      onClick={onSelectCard}
      aria-selected={isActive}
      data-oid="9508df."
    >
      <TableCell className="align-top" data-oid="naz-nr9">
        <Checkbox
          checked={selected}
          onCheckedChange={onToggle}
          aria-label={`Select ${card.name}`}
          onClick={(event) => event.stopPropagation()}
          data-oid="kslmvii"
        />
      </TableCell>
      <TableCell data-oid="v-crdoo">
        <div className="space-y-1" data-oid="v:tvrc_">
          <p className="font-medium leading-tight" data-oid="_45xe7z">
            {card.name}
          </p>
          <div
            className="flex items-center gap-1 text-xs text-muted-foreground"
            data-oid="pzo:lx:"
          >
            <SetSymbol
              symbolUrl={card.setSymbolUrl}
              setCode={card.setCode}
              setName={card.setName}
              tcg={card.tcg}
              size="xs"
              data-oid="chd3135"
            />

            <span data-oid="0xcwu0d">
              {card.setName ??
                (showCardNumbers ? card.setCode : undefined) ??
                "Unknown set"}
              {showCardNumbers ? ` · #${card.setCode ?? "—"}` : ""}
            </span>
          </div>
          {showBinderName && card.binderName ? (
            <p className="text-[11px] text-muted-foreground" data-oid="a40apv9">
              Binder{" "}
              <span
                className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-medium text-foreground"
                style={binderChipStyle}
                data-oid="weh8pe-"
              >
                {binderAccent ? (
                  <span
                    className="inline-flex h-2.5 w-2.5 rounded-full"
                    style={{ backgroundColor: binderAccent }}
                    aria-hidden="true"
                    data-oid="zdhu49w"
                  />
                ) : null}
                <span
                  style={{ color: binderAccent ?? undefined }}
                  data-oid="9ju019m"
                >
                  {card.binderName}
                </span>
              </span>
            </p>
          ) : null}
        </div>
      </TableCell>
      <TableCell data-oid="micrwix">
        <span className="inline-flex items-center gap-1" data-oid="6vj33_e">
          <SetSymbol
            symbolUrl={card.setSymbolUrl}
            setCode={card.setCode}
            setName={card.setName}
            tcg={card.tcg}
            size="xs"
            data-oid="vjd:615"
          />
          {card.setName ??
            (showCardNumbers ? card.setCode : undefined) ??
            "Unknown"}
        </span>
      </TableCell>
      <TableCell data-oid="sujciun">{card.rarity ?? "N/A"}</TableCell>
      <TableCell className="text-right" data-oid="c76_pq5">
        {card.quantity}
      </TableCell>
      <TableCell className="text-right" data-oid="mzf0yiq">
        {card.condition ?? "Unknown"}
      </TableCell>
      {showPricing && (
        <TableCell className="text-right" data-oid="5-ch.5x">
          <div className="flex flex-col items-end gap-1" data-oid="v5ubtkf">
            <span className="font-medium" data-oid="q0h0mum">
              ${price.toFixed(2)}
            </span>
            <TooltipProvider data-oid="-ji0d5_">
              <Tooltip data-oid="v_o0o:_">
                <TooltipTrigger
                  className={`flex items-center gap-1 text-xs ${positive ? "text-emerald-500" : "text-red-500"}`}
                  data-oid="l3zsh77"
                >
                  <TrendingUp className="h-3 w-3" data-oid="cmyyat2" />
                  {positive ? "+" : ""}
                  {delta.toFixed(1)}%
                </TooltipTrigger>
                <TooltipContent data-oid="xhby4j5">
                  Change versus previous sync snapshot.
                </TooltipContent>
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
  onCreate,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreate: (input: { name: string; description: string }) => void;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");

  useEffect(() => {
    if (!open) {
      setName("");
      setDescription("");
    }
  }, [open]);

  const handleSubmit = () => {
    const trimmedName = name.trim();
    if (!trimmedName) {
      return;
    }
    onCreate({ name: trimmedName, description: description.trim() });
    setName("");
    setDescription("");
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange} data-oid="7rt9mrd">
      <DialogContent className="sm:max-w-md" data-oid="gl.d_l1">
        <DialogHeader data-oid="e7_42k9">
          <DialogTitle data-oid="-sodcqx">Create new binder</DialogTitle>
          <DialogDescription data-oid="2ox_28j">
            Organize cards by creating dedicated binders for decks, sets, or
            trades.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4" data-oid="_j1k.ui">
          <div className="space-y-2" data-oid="ap_te8b">
            <Label htmlFor="collection-name" data-oid="_dxzt36">
              Name
            </Label>
            <Input
              id="collection-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="e.g., Commander Staples"
              autoFocus
              data-oid="bb2--cg"
            />
          </div>
          <div className="space-y-2" data-oid="0gr8.bj">
            <Label htmlFor="collection-description" data-oid="i-pb16c">
              Description
            </Label>
            <Input
              id="collection-description"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="Optional summary"
              data-oid=":e1urlv"
            />
          </div>
        </div>
        <DialogFooter data-oid="2rgwqs0">
          <Button
            type="button"
            variant="ghost"
            onClick={() => onOpenChange(false)}
            data-oid="-47358z"
          >
            Cancel
          </Button>
          <Button
            type="button"
            onClick={handleSubmit}
            disabled={!name.trim()}
            data-oid="3pjrp-6"
          >
            Create binder
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
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
  onApply,
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
  const [pendingRange, setPendingRange] =
    useState<[number, number]>(priceRange);

  useEffect(() => {
    if (open) {
      setPendingRarity(rarity);
      setPendingRange(priceRange);
    }
  }, [open, priceRange, rarity]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange} data-oid="xuq8b2i">
      <DialogContent className="sm:max-w-md" data-oid="-_pk:un">
        <DialogHeader data-oid="gts6v5t">
          <DialogTitle data-oid="j3f1rg_">Filter collection</DialogTitle>
          <DialogDescription data-oid="wz0-3tr">
            {showPricing
              ? "Narrow down your collection by rarity and price range."
              : "Filter your collection by rarity."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4" data-oid="b_a6qut">
          <div className="space-y-2" data-oid="w4p:i0h">
            <Label htmlFor="rarity-filter" data-oid="om:-5_4">
              Rarity
            </Label>
            <Select
              value={pendingRarity}
              onValueChange={setPendingRarity}
              data-oid="vuu.0wc"
            >
              <SelectTrigger id="rarity-filter" data-oid="2q2j1_8">
                <SelectValue placeholder="Any rarity" data-oid="12xv7e4" />
              </SelectTrigger>
              <SelectContent data-oid="jq--221">
                <SelectItem value="all" data-oid="megr6f5">
                  All rarities
                </SelectItem>
                {rarities.map((r) => (
                  <SelectItem key={r} value={r} data-oid="j6:qtkf">
                    {r}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {showPricing && (
            <div className="space-y-2" data-oid="dnszi7d">
              <div
                className="flex items-center justify-between"
                data-oid="7:76ety"
              >
                <Label data-oid="9460m34">Price range</Label>
                <span
                  className="text-xs text-muted-foreground"
                  data-oid="od9cr99"
                >
                  ${pendingRange[0].toFixed(2)} – ${pendingRange[1].toFixed(2)}
                </span>
              </div>
              <Slider
                value={pendingRange}
                min={0}
                max={maxPrice}
                step={1}
                onValueChange={(value) =>
                  setPendingRange(value as [number, number])
                }
                data-oid="-pplyqn"
              />
            </div>
          )}
        </div>

        <DialogFooter className="gap-2" data-oid="-l.8ow_">
          <Button
            variant="ghost"
            type="button"
            onClick={() => {
              setPendingRarity("all");
              setPendingRange([0, maxPrice]);
            }}
            data-oid="reqounw"
          >
            <RefreshCcw className="mr-2 h-4 w-4" data-oid="g5308yv" />
            Reset
          </Button>
          <Button
            type="button"
            onClick={() => {
              onApply(pendingRarity, pendingRange);
              onOpenChange(false);
            }}
            data-oid="y3hojl1"
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
  onClear,
}: {
  rarity: string;
  priceRange: [number, number];
  showPricing: boolean;
  defaultMax: number;
  onClear: () => void;
}) {
  const hasRarity = rarity !== "all";
  const hasPrice =
    showPricing && (priceRange[0] !== 0 || priceRange[1] !== defaultMax);

  if (!hasRarity && !hasPrice) {
    return null;
  }

  return (
    <div
      className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground"
      data-oid="w.3:9w_"
    >
      <span className="font-medium" data-oid="ju7e_4u">
        Active filters:
      </span>
      {hasRarity && (
        <Badge variant="outline" data-oid="cj9nm42">
          Rarity: {rarity}
        </Badge>
      )}
      {hasPrice && (
        <Badge variant="outline" data-oid="oyd0dpi">
          Price: ${priceRange[0].toFixed(0)} – ${priceRange[1].toFixed(0)}
        </Badge>
      )}
      <button
        type="button"
        className="text-primary underline"
        onClick={onClear}
        data-oid="706.0p8"
      >
        Clear filters
      </button>
    </div>
  );
}

function compareCards(
  a: CollectionCard,
  b: CollectionCard,
  sortBy: "name" | "rarity" | "price" | "number",
  showPricing: boolean,
) {
  if (sortBy === "price" && showPricing) {
    const priceA = a.price ?? 0;
    const priceB = b.price ?? 0;
    return priceB - priceA;
  }

  if (sortBy === "number") {
    return compareCollectorNumbers(a.collectorNumber, b.collectorNumber);
  }

  const valueA = (a[sortBy] ?? "").toString().toLowerCase();
  const valueB = (b[sortBy] ?? "").toString().toLowerCase();
  return valueA.localeCompare(valueB);
}

function compareCollectorNumbers(a?: string, b?: string): number {
  if (!a && !b) return 0;
  if (!a) return 1;
  if (!b) return -1;

  const partsA = a.match(/^([A-Za-z]*)(\d+)(.*)$/);
  const partsB = b.match(/^([A-Za-z]*)(\d+)(.*)$/);

  if (!partsA && !partsB) return a.localeCompare(b);
  if (!partsA) return 1;
  if (!partsB) return -1;

  const prefixCmp = (partsA[1] || "").localeCompare(partsB[1] || "");
  if (prefixCmp !== 0) return prefixCmp;

  const numA = parseInt(partsA[2], 10);
  const numB = parseInt(partsB[2], 10);
  if (numA !== numB) return numA - numB;

  return (partsA[3] || "").localeCompare(partsB[3] || "");
}

function formatCsvValue(value: unknown): string {
  if (value === undefined || value === null) return '""';
  const stringValue = value.toString().replace(/\"/g, '""');
  return `"${stringValue}"`;
}

function resetFilters(
  setRarity: (value: string) => void,
  setRange: (value: [number, number]) => void,
  maxPrice: number,
) {
  setRarity("all");
  setRange([0, maxPrice]);
}

function CollectionSelector({
  collections,
  activeId,
  onSelect,
  onCreate,
  onRemove,
  showPricing,
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
      <div
        className="flex flex-col gap-4 rounded-xl border border-dashed bg-muted/30 p-6 sm:flex-row sm:items-center sm:justify-between"
        data-oid="spf3spp"
      >
        <div
          className="space-y-1 text-sm text-muted-foreground"
          data-oid="yxcixq7"
        >
          <p data-oid="resvb92">
            No binders yet. Create your first binder to get started.
          </p>
          <p className="text-xs" data-oid="e-kxi4g">
            Once you add cards, they will appear in the All cards view.
          </p>
        </div>
        <Button
          onClick={onCreate}
          className="gap-2 self-start sm:self-auto"
          data-oid="xw:8p2v"
        >
          <Plus className="h-4 w-4" data-oid="a:0vpzs" /> New binder
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
      latestUpdated: 0,
    },
  );

  const aggregateUpdatedLabel = aggregateStats.latestUpdated
    ? new Date(aggregateStats.latestUpdated).toLocaleDateString()
    : "—";

  return (
    <div className="space-y-3" data-oid="p-ss-k_">
      <div className="flex flex-wrap items-center gap-2" data-oid="0rg_ac9">
        <Button
          variant="outline"
          size="sm"
          className="gap-2"
          onClick={onCreate}
          data-oid="23olhvx"
        >
          <Plus className="h-4 w-4" data-oid="-7iodul" /> New binder
        </Button>
      </div>

      <div
        className="overflow-hidden rounded-lg border bg-card"
        data-oid="htw6dtg"
      >
        <SelectorRow
          title="All cards"
          description="Review every binder at once."
          badgeText={`ALL · ${collections.length} binder${collections.length === 1 ? "" : "s"}`}
          stats={[
            `${aggregateStats.uniqueGames.size} game${aggregateStats.uniqueGames.size === 1 ? "" : "s"}`,
            `${aggregateStats.uniqueCardIds.size} unique`,
            `${aggregateStats.totalCopies} copies`,
          ]}
          value={
            showPricing ? `$${aggregateStats.totalValue.toFixed(2)}` : undefined
          }
          updatedLabel={aggregateUpdatedLabel}
          active={activeId === ALL_COLLECTION_ID}
          onClick={() => onSelect(ALL_COLLECTION_ID)}
          data-oid="jn_8bpn"
        />

        {collections.map((collection) => {
          const uniqueGames = new Set(collection.cards.map((card) => card.tcg))
            .size;
          const uniqueCards = new Set(
            collection.cards.map((card) => card.cardId ?? card.id),
          ).size;
          const totalCopies = collection.cards.reduce(
            (sum, card) => sum + card.quantity,
            0,
          );
          const totalValue = collection.cards.reduce(
            (sum, card) => sum + (card.price ?? 0) * card.quantity,
            0,
          );
          const accentColor = normalizeHexColor(collection.colorHex);
          const isLibrary = collection.id === LIBRARY_COLLECTION_ID;

          return (
            <SelectorRow
              key={collection.id}
              title={collection.name}
              description={
                collection.description ||
                (isLibrary ? "Cards not yet assigned to a binder" : undefined)
              }
              badgeText={`${uniqueGames} game${uniqueGames === 1 ? "" : "s"}`}
              stats={[`${uniqueCards} unique`, `${totalCopies} copies`]}
              value={showPricing ? `$${totalValue.toFixed(2)}` : undefined}
              updatedLabel={new Date(collection.updatedAt).toLocaleDateString()}
              active={collection.id === activeId}
              onClick={() => onSelect(collection.id)}
              onRemove={
                collections.length > 1
                  ? () => onRemove(collection.id)
                  : undefined
              }
              accentColor={accentColor}
              data-oid="17-3h.5"
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
  accentColor,
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
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onClick();
        }
      }}
      className={cn(
        "flex flex-col gap-3 border-l-4 border-l-transparent px-4 py-3 transition hover:bg-muted/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 sm:flex-row sm:items-center sm:justify-between",
        active
          ? accent
            ? "ring-1 ring-offset-2"
            : "bg-primary/5 ring-1 ring-primary/40"
          : "",
      )}
      style={rowStyle}
      data-oid="ti0gcwt"
    >
      <div className="flex-1 space-y-1" data-oid="4..rbt3">
        <div className="flex items-center gap-2" data-oid="tha_fyk">
          {accent ? (
            <span
              className="inline-flex h-2.5 w-2.5 rounded-full"
              style={{ backgroundColor: accent }}
              aria-hidden="true"
              data-oid="rmyqff4"
            />
          ) : null}
          <span
            className="text-sm font-semibold"
            style={{ color: accent && active ? accent : undefined }}
            data-oid="l9qt6ih"
          >
            {title}
          </span>
          {badgeText ? (
            <Badge
              variant="outline"
              className="uppercase text-[10px]"
              data-oid="x:l3g2x"
            >
              {badgeText}
            </Badge>
          ) : null}
        </div>
        {description ? (
          <p
            className="text-xs text-muted-foreground line-clamp-2"
            data-oid="moa.w8g"
          >
            {description}
          </p>
        ) : null}
        {stats && stats.length ? (
          <div
            className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground"
            data-oid="2tfwn8-"
          >
            {stats.map((stat) => (
              <span key={stat} data-oid="sl4ixvh">
                {stat}
              </span>
            ))}
          </div>
        ) : null}
      </div>
      <div className="flex items-start gap-3" data-oid="dvjhr6h">
        <div
          className="flex flex-col items-end text-[11px] text-muted-foreground"
          data-oid="tex0xl6"
        >
          {value ? (
            <span
              className="text-sm font-semibold"
              style={{ color: accent && !active ? accent : undefined }}
              data-oid="sdf0vod"
            >
              {value}
            </span>
          ) : null}
          {updatedLabel ? (
            <span data-oid="m.4lpt1">Updated {updatedLabel}</span>
          ) : null}
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
            data-oid="eycub1t"
          >
            <Trash className="h-3.5 w-3.5" data-oid="5nz464z" />
          </button>
        ) : null}
      </div>
    </div>
  );
}
