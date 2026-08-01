"use client";

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  DollarSign,
  Edit3,
  Package,
  PackageOpen,
  Plus,
  Search,
  ShoppingBag,
  Trash2,
  TrendingUp,
} from "lucide-react";

import { AppShell } from "@/components/layout/app-shell";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { getCollections } from "@/lib/api/collections";
import {
  addSealedInventory,
  createSealedOpening,
  deleteSealedInventory,
  getSealedInventory,
  getSealedOpenings,
  getSealedProducts,
  recordOpenedCardSale,
  updateSealedInventory,
  type SealedInventoryResponse,
  type SealedLedgerCard,
  type SealedOpeningLedger,
  type SealedProductResponse,
} from "@/lib/api/sealed";
import { isDemoMode } from "@/lib/demo-mode";
import { GAME_LABELS, type SupportedGame } from "@/lib/utils";
import { useAuthStore } from "@/stores/auth";
import { useGameFilterStore } from "@/stores/game-filter";
import {
  getActiveGames,
  type ManageableGame,
  useModuleStore,
} from "@/stores/preferences";

const TCG_COLORS: Record<string, string> = {
  yugioh: "#ef4444",
  magic: "#8b5cf6",
  pokemon: "#f59e0b",
  onepiece: "#0ea5e9",
  lorcana: "#a855f7",
  dragonball: "#f97316",
};

function tcgLabel(tcg: string): string {
  return GAME_LABELS[tcg as SupportedGame] ?? tcg;
}

function currency(value: number): string {
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: "USD",
  }).format(value);
}

function dateLabel(value?: string): string {
  if (!value) return "Not recorded";
  return new Date(value).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function dateInputValue(value?: string): string {
  return value?.slice(0, 10) ?? "";
}

function toIsoDate(value: string): string | undefined {
  return value ? new Date(`${value}T12:00:00`).toISOString() : undefined;
}

function optionalMoney(value: string): number | undefined {
  if (!value.trim()) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

function isVisibleGame(
  tcg: string,
  enabledGames: Record<ManageableGame, boolean>,
  selectedGame: SupportedGame,
): boolean {
  if (enabledGames[tcg as ManageableGame] === false) return false;
  return selectedGame === "all" || tcg === selectedGame;
}

export default function SealedPage() {
  const [mounted, setMounted] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [editing, setEditing] = useState<SealedInventoryResponse | null>(null);
  const [opening, setOpening] = useState<SealedInventoryResponse | null>(null);
  const [deleting, setDeleting] = useState<SealedInventoryResponse | null>(null);
  const [selling, setSelling] = useState<SealedLedgerCard | null>(null);
  useEffect(() => setMounted(true), []);

  const { token, isAuthenticated } = useAuthStore();
  const selectedGame = useGameFilterStore((state) => state.selectedGame);
  const { enabledGames, showPricing } = useModuleStore((state) => ({
    enabledGames: state.enabledGames,
    showPricing: state.showPricing,
  }));
  const queryClient = useQueryClient();
  const demo = mounted && isDemoMode();
  const ready = mounted && isAuthenticated && !!token && !demo;
  const noGamesEnabled = getActiveGames(enabledGames).length === 0;

  const inventoryQuery = useQuery({
    queryKey: ["sealed-inventory"],
    queryFn: () => getSealedInventory(token!),
    enabled: ready && !noGamesEnabled,
    staleTime: 60_000,
  });
  const openingsQuery = useQuery({
    queryKey: ["sealed-openings"],
    queryFn: () => getSealedOpenings(token!),
    enabled: ready && !noGamesEnabled,
    staleTime: 60_000,
  });

  const inventory = useMemo(
    () =>
      (inventoryQuery.data ?? []).filter((item) =>
        isVisibleGame(item.product.tcg, enabledGames, selectedGame),
      ),
    [inventoryQuery.data, enabledGames, selectedGame],
  );
  const inventoryById = useMemo(
    () => new Map((inventoryQuery.data ?? []).map((item) => [item.id, item])),
    [inventoryQuery.data],
  );
  const openings = useMemo(
    () =>
      (openingsQuery.data ?? []).filter((entry) => {
        const item = inventoryById.get(entry.inventoryId);
        return item
          ? isVisibleGame(item.product.tcg, enabledGames, selectedGame)
          : selectedGame === "all";
      }),
    [openingsQuery.data, inventoryById, enabledGames, selectedGame],
  );

  const totalUnits = inventory.reduce((sum, item) => sum + item.quantity, 0);
  const pricedUnits = inventory.reduce(
    (sum, item) => sum + (item.purchasePrice === undefined ? 0 : item.quantity),
    0,
  );
  const costBasis = inventory.reduce(
    (sum, item) => sum + (item.purchasePrice ?? 0) * item.quantity,
    0,
  );
  const openedQuantity = openings.reduce(
    (sum, entry) => sum + entry.openedQuantity,
    0,
  );
  const openingProfitLoss = openings.reduce(
    (sum, entry) => sum + entry.profitLoss,
    0,
  );

  const refreshInventory = () => {
    void queryClient.invalidateQueries({ queryKey: ["sealed-inventory"] });
  };
  const refreshAll = () => {
    refreshInventory();
    void queryClient.invalidateQueries({ queryKey: ["sealed-openings"] });
  };

  const loadError = inventoryQuery.error ?? openingsQuery.error;
  const loading = inventoryQuery.isLoading || openingsQuery.isLoading;

  return (
    <AppShell>
      <div className="space-y-6">
        <PageHeader
          onAdd={() => setAddOpen(true)}
          disabled={!ready || noGamesEnabled}
        />

        {!mounted ? (
          <SealedSkeleton />
        ) : !isAuthenticated ? (
          <MessageCard
            title="Sign in required"
            description="Sign in to track sealed products and opening results."
          />
        ) : demo ? (
          <MessageCard
            title="Sealed products aren’t available in demo mode"
            description="The demo dataset does not include sealed inventory fixtures. Sign in to a connected TCGer server to use this page."
          />
        ) : noGamesEnabled ? (
          <MessageCard
            title="No games enabled"
            description="Enable at least one trading card game in account settings to manage sealed products."
          />
        ) : loadError ? (
          <MessageCard
            title="Couldn’t load sealed products"
            description={(loadError as Error).message}
            action={
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  void inventoryQuery.refetch();
                  void openingsQuery.refetch();
                }}
              >
                Try again
              </Button>
            }
          />
        ) : loading ? (
          <SealedSkeleton />
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3 md:gap-6 xl:grid-cols-4">
              <StatCard
                title="Sealed Units"
                value={totalUnits.toLocaleString()}
                detail={`${inventory.length} unique product${inventory.length === 1 ? "" : "s"}`}
                icon={<Package className="h-5 w-5" />}
              />
              <StatCard
                title="Products Opened"
                value={openedQuantity.toLocaleString()}
                detail={`${openings.length} opening${openings.length === 1 ? "" : "s"} recorded`}
                icon={<PackageOpen className="h-5 w-5" />}
              />
              {showPricing ? (
                <>
                  <StatCard
                    title="Sealed Cost Basis"
                    value={currency(costBasis)}
                    detail={`${pricedUnits} of ${totalUnits} units priced`}
                    icon={<DollarSign className="h-5 w-5" />}
                  />
                  <StatCard
                    title="Opening P/L"
                    value={`${openingProfitLoss >= 0 ? "+" : ""}${currency(openingProfitLoss)}`}
                    detail="Live value plus realized sales"
                    icon={<TrendingUp className="h-5 w-5" />}
                    valueClassName={
                      openingProfitLoss >= 0 ? "text-green-500" : "text-red-500"
                    }
                  />
                </>
              ) : (
                <StatCard
                  title="Games"
                  value={new Set(inventory.map((item) => item.product.tcg)).size}
                  detail="With sealed inventory"
                  icon={<ShoppingBag className="h-5 w-5" />}
                />
              )}
            </div>

            {!showPricing && (
              <div className="rounded-lg border bg-muted/40 p-4 text-sm text-muted-foreground">
                Pricing is hidden in your preferences, so purchase costs and
                opening values are not shown.
              </div>
            )}

            <Tabs defaultValue="inventory">
              <TabsList>
                <TabsTrigger value="inventory">Inventory</TabsTrigger>
                <TabsTrigger value="openings">Opening ledger</TabsTrigger>
              </TabsList>
              <TabsContent value="inventory">
                {inventory.length === 0 ? (
                  <MessageCard
                    title="No sealed products yet"
                    description={
                      selectedGame === "all"
                        ? "Browse the catalog and add your first sealed product."
                        : `No ${tcgLabel(selectedGame)} sealed products match the current game filter.`
                    }
                    action={
                      <Button size="sm" onClick={() => setAddOpen(true)}>
                        <Plus className="mr-2 h-4 w-4" /> Add Product
                      </Button>
                    }
                  />
                ) : (
                  <div className="space-y-3">
                    {inventory.map((item) => (
                      <InventoryCard
                        key={item.id}
                        item={item}
                        showPricing={showPricing}
                        onEdit={() => setEditing(item)}
                        onOpen={() => setOpening(item)}
                        onDelete={() => setDeleting(item)}
                      />
                    ))}
                  </div>
                )}
              </TabsContent>
              <TabsContent value="openings">
                {openings.length === 0 ? (
                  <MessageCard
                    title="No openings recorded"
                    description="Open an inventory item to track the product cost and any collection copies pulled from it."
                  />
                ) : (
                  <div className="space-y-3">
                    {openings.map((entry) => (
                      <OpeningCard
                        key={entry.id}
                        entry={entry}
                        showPricing={showPricing}
                        onSell={setSelling}
                      />
                    ))}
                  </div>
                )}
              </TabsContent>
            </Tabs>
          </>
        )}
      </div>

      <AddInventoryDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        token={token}
        enabledGames={enabledGames}
        selectedGame={selectedGame}
        onSaved={refreshInventory}
      />
      <EditInventoryDialog
        item={editing}
        onOpenChange={(open) => !open && setEditing(null)}
        token={token}
        onSaved={refreshInventory}
      />
      <RecordOpeningDialog
        item={opening}
        onOpenChange={(open) => !open && setOpening(null)}
        token={token}
        onSaved={refreshAll}
      />
      <DeleteInventoryDialog
        item={deleting}
        onOpenChange={(open) => !open && setDeleting(null)}
        token={token}
        onDeleted={refreshInventory}
      />
      <RecordSaleDialog
        card={selling}
        onOpenChange={(open) => !open && setSelling(null)}
        token={token}
        onSaved={() =>
          void queryClient.invalidateQueries({ queryKey: ["sealed-openings"] })
        }
      />
    </AppShell>
  );
}

function PageHeader({ onAdd, disabled }: { onAdd: () => void; disabled: boolean }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div>
        <h1 className="text-3xl font-heading font-semibold">Sealed Products</h1>
        <p className="text-sm text-muted-foreground">
          Track sealed inventory, openings, pulls, and realized sales.
        </p>
      </div>
      <Button size="sm" onClick={onAdd} disabled={disabled}>
        <Plus className="mr-2 h-4 w-4" /> Add Product
      </Button>
    </div>
  );
}

function MessageCard({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: React.ReactNode;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      {action && <CardContent>{action}</CardContent>}
    </Card>
  );
}

function StatCard({
  title,
  value,
  detail,
  icon,
  valueClassName = "",
}: {
  title: string;
  value: string | number;
  detail: string;
  icon: React.ReactNode;
  valueClassName?: string;
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 p-3 pb-1 md:p-6 md:pb-4">
        <CardTitle className="text-xs font-medium text-muted-foreground md:text-sm">
          {title}
        </CardTitle>
        <span className="text-muted-foreground">{icon}</span>
      </CardHeader>
      <CardContent className="p-3 pt-0 md:p-6 md:pt-0">
        <div className={`text-xl font-semibold md:text-3xl ${valueClassName}`}>
          {value}
        </div>
        <p className="mt-1 text-xs text-muted-foreground">{detail}</p>
      </CardContent>
    </Card>
  );
}

function InventoryCard({
  item,
  showPricing,
  onEdit,
  onOpen,
  onDelete,
}: {
  item: SealedInventoryResponse;
  showPricing: boolean;
  onEdit: () => void;
  onOpen: () => void;
  onDelete: () => void;
}) {
  const totalCost = item.purchasePrice === undefined
    ? undefined
    : item.purchasePrice * item.quantity;
  const msrpTotal = item.product.msrp === undefined
    ? undefined
    : item.product.msrp * item.quantity;

  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
          <div className="flex min-w-0 gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-muted">
              <Package className="h-5 w-5 text-muted-foreground" />
            </div>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold">{item.product.name}</p>
              <div className="mt-1 flex flex-wrap items-center gap-2">
                <Badge
                  variant="outline"
                  style={{ borderColor: TCG_COLORS[item.product.tcg] }}
                >
                  {tcgLabel(item.product.tcg)}
                </Badge>
                <Badge variant="secondary">{item.product.productType}</Badge>
                {item.product.setCode && (
                  <span className="text-xs text-muted-foreground">
                    {item.product.setCode}
                  </span>
                )}
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                Purchased {dateLabel(item.purchaseDate)}
                {item.notes ? ` · ${item.notes}` : ""}
              </p>
            </div>
          </div>
          <div className="flex items-center justify-between gap-4 sm:justify-end">
            <div className="text-left sm:text-right">
              <p className="text-sm font-semibold">{item.quantity} sealed</p>
              {showPricing && (
                <>
                  <p className="text-xs text-muted-foreground">
                    Cost {totalCost === undefined ? "—" : currency(totalCost)}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {msrpTotal === undefined
                      ? "Current value unavailable"
                      : `MSRP reference ${currency(msrpTotal)}`}
                  </p>
                </>
              )}
            </div>
            <div className="flex gap-1">
              <Button
                variant="ghost"
                size="icon"
                onClick={onOpen}
                disabled={item.quantity < 1}
                aria-label="Record opening"
              >
                <PackageOpen className="h-4 w-4" />
              </Button>
              <Button variant="ghost" size="icon" onClick={onEdit} aria-label="Edit inventory item">
                <Edit3 className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="text-muted-foreground hover:text-destructive"
                onClick={onDelete}
                aria-label="Delete inventory item"
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function OpeningCard({
  entry,
  showPricing,
  onSell,
}: {
  entry: SealedOpeningLedger;
  showPricing: boolean;
  onSell: (card: SealedLedgerCard) => void;
}) {
  return (
    <Card>
      <CardHeader>
        <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
          <div>
            <CardTitle className="text-base">{entry.productName}</CardTitle>
            <CardDescription>
              Opened {entry.openedQuantity} on {dateLabel(entry.openedAt)} ·{" "}
              {entry.activeCopies} active, {entry.soldCopies} sold
            </CardDescription>
          </div>
          {showPricing && (
            <div className="grid grid-cols-2 gap-x-5 gap-y-1 text-xs sm:text-right">
              <span className="text-muted-foreground">Invested</span>
              <span>{currency(entry.invested)}</span>
              <span className="text-muted-foreground">Live + realized</span>
              <span>{currency(entry.liveValue + entry.realizedProceeds)}</span>
              <span className="text-muted-foreground">P/L</span>
              <span className={entry.profitLoss >= 0 ? "text-green-500" : "text-red-500"}>
                {entry.profitLoss >= 0 ? "+" : ""}{currency(entry.profitLoss)}
              </span>
            </div>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {entry.cards.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No collection copies were linked to this opening.
          </p>
        ) : (
          <div className="divide-y rounded-md border">
            {entry.cards.map((card) => (
              <div key={card.id} className="flex items-center justify-between gap-3 p-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{card.cardName}</p>
                  <p className="text-xs text-muted-foreground">
                    {card.quantity} cop{card.quantity === 1 ? "y" : "ies"} · {tcgLabel(card.tcg)}
                    {card.status === "sold" && card.soldAt
                      ? ` · Sold ${dateLabel(card.soldAt)}`
                      : ""}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  {showPricing && (
                    <span className="text-sm">
                      {currency(card.status === "sold" ? card.realizedProceeds : card.liveValue)}
                    </span>
                  )}
                  {card.status === "active" ? (
                    <Button size="sm" variant="outline" onClick={() => onSell(card)}>
                      Record sale
                    </Button>
                  ) : (
                    <Badge variant="secondary">Sold</Badge>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function AddInventoryDialog({
  open,
  onOpenChange,
  token,
  enabledGames,
  selectedGame,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  token: string | null;
  enabledGames: Record<ManageableGame, boolean>;
  selectedGame: SupportedGame;
  onSaved: () => void;
}) {
  const activeGames = getActiveGames(enabledGames);
  const initialGame = selectedGame !== "all" && enabledGames[selectedGame]
    ? selectedGame
    : "all";
  const [tcg, setTcg] = useState<SupportedGame>(initialGame);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<SealedProductResponse | null>(null);
  const [quantity, setQuantity] = useState("1");
  const [price, setPrice] = useState("");
  const [date, setDate] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setTcg(initialGame);
      setSearch("");
      setSelected(null);
      setQuantity("1");
      setPrice("");
      setDate("");
      setNotes("");
      setError(null);
    }
  }, [open, initialGame]);

  const catalogQuery = useQuery({
    queryKey: ["sealed-products", tcg],
    queryFn: () => getSealedProducts(token!, tcg === "all" ? undefined : tcg),
    enabled: open && !!token,
    staleTime: 5 * 60_000,
  });
  const products = (catalogQuery.data ?? []).filter((product) => {
    if (enabledGames[product.tcg as ManageableGame] === false) return false;
    const needle = search.trim().toLocaleLowerCase();
    return !needle || `${product.name} ${product.productType} ${product.setCode ?? ""}`
      .toLocaleLowerCase()
      .includes(needle);
  });

  const mutation = useMutation({
    mutationFn: () =>
      addSealedInventory(token!, {
        productId: selected!.id,
        quantity: Number(quantity),
        purchasePrice: optionalMoney(price),
        purchaseDate: toIsoDate(date),
        notes: notes.trim() || undefined,
      }),
    onSuccess: () => {
      onSaved();
      onOpenChange(false);
      setQuantity("1");
      setPrice("");
      setDate("");
      setNotes("");
    },
    onError: (cause) => setError((cause as Error).message),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Add sealed product</DialogTitle>
          <DialogDescription>
            Browse the product catalog, then record the purchase details.
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            const parsedQuantity = Number(quantity);
            if (!selected) return setError("Select a product from the catalog.");
            if (!Number.isInteger(parsedQuantity) || parsedQuantity < 1)
              return setError("Quantity must be a positive whole number.");
            if (price.trim() && optionalMoney(price) === undefined)
              return setError("Purchase price must be zero or greater.");
            setError(null);
            mutation.mutate();
          }}
        >
          <div className="grid gap-3 sm:grid-cols-[180px_1fr]">
            <Select value={tcg} onValueChange={(value) => {
              setTcg(value as SupportedGame);
              setSelected(null);
            }}>
              <SelectTrigger aria-label="Filter catalog by game">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All enabled games</SelectItem>
                {activeGames.map((game) => (
                  <SelectItem key={game} value={game}>{tcgLabel(game)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="relative">
              <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
              <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                className="pl-9"
                placeholder="Search products, types, or set codes"
              />
            </div>
          </div>

          <ScrollArea className="h-48 rounded-md border">
            {catalogQuery.isLoading ? (
              <div className="space-y-2 p-3">
                <Skeleton className="h-12" /><Skeleton className="h-12" /><Skeleton className="h-12" />
              </div>
            ) : catalogQuery.error ? (
              <div className="p-4 text-sm text-destructive">
                {(catalogQuery.error as Error).message}
              </div>
            ) : products.length === 0 ? (
              <p className="p-4 text-sm text-muted-foreground">No catalog products match this filter.</p>
            ) : (
              <div className="divide-y">
                {products.map((product) => (
                  <button
                    type="button"
                    key={product.id}
                    className={`flex w-full items-center justify-between gap-3 p-3 text-left transition hover:bg-muted/60 ${selected?.id === product.id ? "bg-muted" : ""}`}
                    onClick={() => setSelected(product)}
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium">{product.name}</span>
                      <span className="block text-xs text-muted-foreground">
                        {tcgLabel(product.tcg)} · {product.productType}
                        {product.setCode ? ` · ${product.setCode}` : ""}
                      </span>
                    </span>
                    {product.msrp !== undefined && (
                      <span className="shrink-0 text-xs text-muted-foreground">
                        MSRP {currency(product.msrp)}
                      </span>
                    )}
                  </button>
                ))}
              </div>
            )}
          </ScrollArea>

          {selected && (
            <p className="rounded-md bg-muted p-3 text-sm">
              Selected: <span className="font-medium">{selected.name}</span>
            </p>
          )}

          <InventoryFields
            prefix="add"
            quantity={quantity}
            setQuantity={setQuantity}
            price={price}
            setPrice={setPrice}
            date={date}
            setDate={setDate}
            notes={notes}
            setNotes={setNotes}
          />
          {error && <p className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={mutation.isPending || !selected}>
              {mutation.isPending ? "Adding…" : "Add to inventory"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function InventoryFields({
  prefix,
  quantity,
  setQuantity,
  price,
  setPrice,
  date,
  setDate,
  notes,
  setNotes,
}: {
  prefix: string;
  quantity: string;
  setQuantity: (value: string) => void;
  price: string;
  setPrice: (value: string) => void;
  date: string;
  setDate: (value: string) => void;
  notes: string;
  setNotes: (value: string) => void;
}) {
  return (
    <>
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="space-y-2">
          <Label htmlFor={`${prefix}-quantity`}>Quantity</Label>
          <Input id={`${prefix}-quantity`} type="number" min="1" step="1" value={quantity} onChange={(e) => setQuantity(e.target.value)} />
        </div>
        <div className="space-y-2">
          <Label htmlFor={`${prefix}-price`}>Unit purchase price</Label>
          <Input id={`${prefix}-price`} type="number" min="0" step="0.01" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="Optional" />
        </div>
        <div className="space-y-2">
          <Label htmlFor={`${prefix}-date`}>Purchase date</Label>
          <Input id={`${prefix}-date`} type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
      </div>
      <div className="space-y-2">
        <Label htmlFor={`${prefix}-notes`}>Notes</Label>
        <Textarea id={`${prefix}-notes`} rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional" />
      </div>
    </>
  );
}

function EditInventoryDialog({
  item,
  onOpenChange,
  token,
  onSaved,
}: {
  item: SealedInventoryResponse | null;
  onOpenChange: (open: boolean) => void;
  token: string | null;
  onSaved: () => void;
}) {
  const [quantity, setQuantity] = useState("1");
  const [price, setPrice] = useState("");
  const [date, setDate] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (item) {
      setQuantity(String(item.quantity));
      setPrice(item.purchasePrice === undefined ? "" : String(item.purchasePrice));
      setDate(dateInputValue(item.purchaseDate));
      setNotes(item.notes ?? "");
      setError(null);
    }
  }, [item]);

  const mutation = useMutation({
    mutationFn: () => updateSealedInventory(token!, item!.id, {
      quantity: Number(quantity),
      purchasePrice: optionalMoney(price),
      purchaseDate: toIsoDate(date),
      notes: notes.trim(),
    }),
    onSuccess: () => {
      onSaved();
      onOpenChange(false);
    },
    onError: (cause) => setError((cause as Error).message),
  });

  return (
    <Dialog open={!!item} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit inventory</DialogTitle>
          <DialogDescription>{item?.product.name}</DialogDescription>
        </DialogHeader>
        <form className="space-y-4" onSubmit={(event) => {
          event.preventDefault();
          const parsedQuantity = Number(quantity);
          if (!Number.isInteger(parsedQuantity) || parsedQuantity < 1)
            return setError("Quantity must be a positive whole number.");
          if (price.trim() && optionalMoney(price) === undefined)
            return setError("Purchase price must be zero or greater.");
          mutation.mutate();
        }}>
          <InventoryFields
            prefix="edit"
            quantity={quantity}
            setQuantity={setQuantity}
            price={price}
            setPrice={setPrice}
            date={date}
            setDate={setDate}
            notes={notes}
            setNotes={setNotes}
          />
          {error && <p className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={mutation.isPending}>{mutation.isPending ? "Saving…" : "Save changes"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

interface LinkableCopy {
  id: string;
  name: string;
  binderName: string;
}

function RecordOpeningDialog({
  item,
  onOpenChange,
  token,
  onSaved,
}: {
  item: SealedInventoryResponse | null;
  onOpenChange: (open: boolean) => void;
  token: string | null;
  onSaved: () => void;
}) {
  const [quantity, setQuantity] = useState("1");
  const [date, setDate] = useState("");
  const [notes, setNotes] = useState("");
  const [cardSearch, setCardSearch] = useState("");
  const [collectionIds, setCollectionIds] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (item) {
      setQuantity("1");
      setDate("");
      setNotes("");
      setCardSearch("");
      setCollectionIds([]);
      setError(null);
    }
  }, [item]);

  const collectionsQuery = useQuery({
    queryKey: ["collections"],
    queryFn: () => getCollections(token!),
    enabled: !!item && !!token,
    staleTime: 60_000,
  });
  const linkableCopies = useMemo<LinkableCopy[]>(() => {
    if (!item) return [];
    const needle = cardSearch.trim().toLocaleLowerCase();
    return (collectionsQuery.data ?? []).flatMap((binder) =>
      binder.cards
        .filter((card) => card.tcg === item.product.tcg)
        .flatMap((card) => card.copies.map((copy) => ({
          id: copy.id,
          name: card.name,
          binderName: binder.name,
        })))
        .filter((copy) => !needle || `${copy.name} ${copy.binderName}`.toLocaleLowerCase().includes(needle)),
    );
  }, [collectionsQuery.data, item, cardSearch]);

  const mutation = useMutation({
    mutationFn: () => createSealedOpening(token!, item!.id, {
      openedQuantity: Number(quantity),
      collectionIds,
      openedAt: toIsoDate(date),
      notes: notes.trim() || undefined,
    }),
    onSuccess: () => {
      onSaved();
      onOpenChange(false);
    },
    onError: (cause) => setError((cause as Error).message),
  });

  return (
    <Dialog open={!!item} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Record opening</DialogTitle>
          <DialogDescription>
            Opening {item?.product.name} reduces its sealed quantity. Optionally link collection copies pulled from it.
          </DialogDescription>
        </DialogHeader>
        <form className="space-y-4" onSubmit={(event) => {
          event.preventDefault();
          const parsedQuantity = Number(quantity);
          if (!item || !Number.isInteger(parsedQuantity) || parsedQuantity < 1 || parsedQuantity > item.quantity)
            return setError(`Opened quantity must be between 1 and ${item?.quantity ?? 1}.`);
          mutation.mutate();
        }}>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="open-quantity">Quantity opened</Label>
              <Input id="open-quantity" type="number" min="1" max={item?.quantity} step="1" value={quantity} onChange={(e) => setQuantity(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="open-date">Opening date</Label>
              <Input id="open-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="open-notes">Notes</Label>
            <Textarea id="open-notes" rows={2} maxLength={2000} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional" />
          </div>
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-3">
              <Label htmlFor="pull-search">Link pulled collection copies</Label>
              <span className="text-xs text-muted-foreground">{collectionIds.length} selected</span>
            </div>
            <Input id="pull-search" value={cardSearch} onChange={(e) => setCardSearch(e.target.value)} placeholder="Search your collection" />
            <ScrollArea className="h-36 rounded-md border">
              {collectionsQuery.isLoading ? (
                <div className="space-y-2 p-3"><Skeleton className="h-8" /><Skeleton className="h-8" /></div>
              ) : collectionsQuery.error ? (
                <p className="p-3 text-xs text-muted-foreground">
                  Collection copies couldn’t be loaded. You can still record the opening without links.
                </p>
              ) : linkableCopies.length === 0 ? (
                <p className="p-3 text-xs text-muted-foreground">No matching collection copies found.</p>
              ) : (
                <div className="divide-y">
                  {linkableCopies.map((copy) => (
                    <label key={copy.id} className="flex cursor-pointer items-center gap-3 p-2.5 text-sm hover:bg-muted/60">
                      <Checkbox
                        checked={collectionIds.includes(copy.id)}
                        onCheckedChange={() => setCollectionIds((current) =>
                          current.includes(copy.id)
                            ? current.filter((id) => id !== copy.id)
                            : current.length < 500 ? [...current, copy.id] : current,
                        )}
                      />
                      <span className="min-w-0">
                        <span className="block truncate">{copy.name}</span>
                        <span className="block text-xs text-muted-foreground">{copy.binderName}</span>
                      </span>
                    </label>
                  ))}
                </div>
              )}
            </ScrollArea>
            <p className="text-xs text-muted-foreground">
              Copies already linked to another opening will be rejected by the server.
            </p>
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={mutation.isPending}>{mutation.isPending ? "Recording…" : "Record opening"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function DeleteInventoryDialog({
  item,
  onOpenChange,
  token,
  onDeleted,
}: {
  item: SealedInventoryResponse | null;
  onOpenChange: (open: boolean) => void;
  token: string | null;
  onDeleted: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  useEffect(() => setError(null), [item]);
  const mutation = useMutation({
    mutationFn: () => deleteSealedInventory(token!, item!.id),
    onSuccess: () => {
      onDeleted();
      onOpenChange(false);
    },
    onError: (cause) => setError((cause as Error).message),
  });
  return (
    <Dialog open={!!item} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete sealed inventory?</DialogTitle>
          <DialogDescription>
            This permanently removes {item?.product.name}. Inventory with opening history cannot be deleted.
          </DialogDescription>
        </DialogHeader>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button variant="destructive" onClick={() => mutation.mutate()} disabled={mutation.isPending}>
            {mutation.isPending ? "Deleting…" : "Delete"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RecordSaleDialog({
  card,
  onOpenChange,
  token,
  onSaved,
}: {
  card: SealedLedgerCard | null;
  onOpenChange: (open: boolean) => void;
  token: string | null;
  onSaved: () => void;
}) {
  const [proceeds, setProceeds] = useState("");
  const [soldAt, setSoldAt] = useState("");
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (card) {
      setProceeds("");
      setSoldAt("");
      setError(null);
    }
  }, [card]);
  const mutation = useMutation({
    mutationFn: () => recordOpenedCardSale(token!, card!.id, {
      proceeds: Number(proceeds),
      soldAt: toIsoDate(soldAt),
    }),
    onSuccess: () => {
      onSaved();
      onOpenChange(false);
    },
    onError: (cause) => setError((cause as Error).message),
  });
  return (
    <Dialog open={!!card} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Record opened-card sale</DialogTitle>
          <DialogDescription>{card?.cardName}</DialogDescription>
        </DialogHeader>
        <form className="space-y-4" onSubmit={(event) => {
          event.preventDefault();
          const value = optionalMoney(proceeds);
          if (value === undefined) return setError("Enter sale proceeds of zero or greater.");
          mutation.mutate();
        }}>
          <div className="space-y-2">
            <Label htmlFor="sale-proceeds">Proceeds</Label>
            <Input id="sale-proceeds" type="number" min="0" step="0.01" required value={proceeds} onChange={(e) => setProceeds(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="sale-date">Sale date</Label>
            <Input id="sale-date" type="date" value={soldAt} onChange={(e) => setSoldAt(e.target.value)} />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={mutation.isPending}>{mutation.isPending ? "Saving…" : "Record sale"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function SealedSkeleton() {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 md:gap-6 xl:grid-cols-4">
        {Array.from({ length: 4 }, (_, index) => <Skeleton key={index} className="h-32" />)}
      </div>
      <Skeleton className="h-10 w-64" />
      <div className="space-y-3">
        {Array.from({ length: 3 }, (_, index) => <Skeleton key={index} className="h-28" />)}
      </div>
    </div>
  );
}
