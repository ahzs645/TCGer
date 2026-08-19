"use client";

import { useEffect, useMemo, useState } from "react";
import { Download, Layers, Minus, Plus, Search, Trash2, Upload } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { AppShell } from "@/components/layout/app-shell";
import { Badge } from "@/components/ui/badge";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import {
  createDeck,
  deleteDeck,
  addCardToDeck,
  exportDeckYdk,
  getDeckOwnership,
  getDecks,
  importDeck,
  removeDeckCard,
  updateDeckCard,
  validateDeck,
  type DeckResponse,
} from "@/lib/api/decks";
import { searchCards } from "@/lib/api/cards";
import type { Card as CardResult, YugiohDeckZone } from "@tcg/api-types";
import { GAME_LABELS, type SupportedGame } from "@/lib/utils";
import { useAuthStore } from "@/stores/auth";
import { useGameFilterStore } from "@/stores/game-filter";
import {
  useModuleStore,
  type ManageableGame,
} from "@/stores/preferences";

import { GameBadge } from "@/components/cards/game-badge";
import { gameColor } from "@/lib/games";
const MANAGEABLE_GAMES: readonly ManageableGame[] = [
  "magic",
  "yugioh",
  "pokemon",
  "onepiece",
  "lorcana",
  "dragonball",
];

function tcgLabel(tcg: string): string {
  return GAME_LABELS[tcg as SupportedGame] ?? tcg;
}

export default function DecksPage() {
  const [confirm, confirmDialog] = useConfirm();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const [selectedDeck, setSelectedDeck] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [ydkOpen, setYdkOpen] = useState(false);

  const { token, isAuthenticated } = useAuthStore();
  const selectedGame = useGameFilterStore((state) => state.selectedGame);
  const enabledGames = useModuleStore((state) => state.enabledGames);
  const queryClient = useQueryClient();

  const decksQuery = useQuery({
    queryKey: ["decks"],
    queryFn: () => getDecks(token!),
    enabled: mounted && isAuthenticated && !!token,
    staleTime: 1000 * 60,
  });

  const deleteMutation = useMutation({
    mutationFn: (deckId: string) => deleteDeck(token!, deckId),
    onSuccess: (_data, deckId) => {
      if (selectedDeck === deckId) setSelectedDeck(null);
      void queryClient.invalidateQueries({ queryKey: ["decks"] });
    },
  });

  const decks = useMemo(() => {
    const all = decksQuery.data ?? [];
    return all.filter((d) => {
      if (enabledGames[d.tcg as keyof typeof enabledGames] === false)
        return false;
      if (selectedGame !== "all" && d.tcg !== selectedGame) return false;
      return true;
    });
  }, [decksQuery.data, enabledGames, selectedGame]);

  const activeDeck = decks.find((d) => d.id === selectedDeck) ?? null;

  const totalDecks = decks.length;
  const totalCards = decks.reduce((s, d) => s + (d.cardCount ?? 0), 0);
  const distinctGames = new Set(decks.map((d) => d.tcg)).size;

  const loading = mounted && isAuthenticated && decksQuery.isLoading;

  return (
    <AppShell>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-heading font-semibold">Decks</h1>
            <p className="text-sm text-muted-foreground">
              Build and manage your constructed decks across all games.
            </p>
          </div>
          <div className="flex gap-2">
            {enabledGames.yugioh !== false && (
              <Button variant="outline" size="sm" onClick={() => setYdkOpen(true)}>
                <Upload className="mr-2 h-4 w-4" /> Import YDK
              </Button>
            )}
            <Button
              size="sm"
              onClick={() => setCreateOpen(true)}
              disabled={!mounted || !isAuthenticated}
            >
              <Plus className="mr-2 h-4 w-4" />
              New Deck
            </Button>
          </div>
        </div>

        {mounted && !isAuthenticated ? (
          <Card>
            <CardHeader>
              <CardTitle>Sign in required</CardTitle>
              <CardDescription>
                Sign in to build and manage your decks.
              </CardDescription>
            </CardHeader>
          </Card>
        ) : decksQuery.error ? (
          <Card>
            <CardHeader>
              <CardTitle>Couldn&apos;t load decks</CardTitle>
              <CardDescription>
                {(decksQuery.error as Error).message}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button
                variant="outline"
                size="sm"
                onClick={() => void decksQuery.refetch()}
              >
                Try again
              </Button>
            </CardContent>
          </Card>
        ) : loading ? (
          <DecksSkeleton />
        ) : (
          <>
            {/* Stats */}
            <div className="grid grid-cols-2 gap-3 md:gap-6 lg:grid-cols-3">
              <StatCard title="Total Decks" value={totalDecks} />
              <StatCard title="Cards in Decks" value={totalCards} />
              <StatCard title="Games" value={distinctGames} />
            </div>

            {totalDecks === 0 ? (
              <Card>
                <CardHeader>
                  <CardTitle>No decks yet</CardTitle>
                  <CardDescription>
                    Create your first deck to start tracking your builds.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <Button size="sm" onClick={() => setCreateOpen(true)}>
                    <Plus className="mr-2 h-4 w-4" />
                    New Deck
                  </Button>
                </CardContent>
              </Card>
            ) : (
              <div className="grid gap-6 lg:grid-cols-[minmax(300px,26rem)_minmax(0,1fr)] lg:items-start">
                {/* Deck list */}
                <div className="space-y-3">
                  {decks.map((deck) => {
                    const isSelected = selectedDeck === deck.id;
                    const color = deck.colorHex ?? gameColor(deck.tcg);
                    return (
                      <Card
                        key={deck.id}
                        role="button"
                        tabIndex={0}
                        aria-pressed={isSelected}
                        className={`cursor-pointer transition hover:border-primary/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                          isSelected ? "ring-2 ring-primary" : ""
                        }`}
                        onClick={() =>
                          setSelectedDeck(isSelected ? null : deck.id)
                        }
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            setSelectedDeck(isSelected ? null : deck.id);
                          }
                        }}
                      >
                        <CardContent className="p-4">
                          <div className="flex items-start justify-between gap-2">
                            <div className="flex items-center gap-3">
                              <div
                                className="h-10 w-1.5 rounded-full"
                                style={{ backgroundColor: color }}
                              />
                              <div>
                                <p className="text-sm font-semibold">
                                  {deck.name}
                                </p>
                                <div className="flex items-center gap-2 mt-0.5">
                                  <GameBadge game={deck.tcg} />
                                  {deck.format && (
                                    <span className="text-xs text-muted-foreground">
                                      {deck.format}
                                    </span>
                                  )}
                                </div>
                              </div>
                            </div>
                            <div className="text-right">
                              <p className="text-sm font-medium">
                                {deck.cardCount} cards
                              </p>
                              {deck.isPublic && (
                                <Badge
                                  variant="secondary"
                                  className="text-xs mt-0.5"
                                >
                                  Public
                                </Badge>
                              )}
                            </div>
                          </div>
                          {deck.description && (
                            <p className="text-xs text-muted-foreground mt-2 line-clamp-2">
                              {deck.description}
                            </p>
                          )}
                        </CardContent>
                      </Card>
                    );
                  })}
                </div>

                {/* Deck detail — sticky so it stays on screen while the list
                    beside it scrolls. */}
                <div className="lg:sticky lg:top-20">
                  {activeDeck ? (
                    <DeckDetail
                      deck={activeDeck}
                      onDelete={async () => {
                        const ok = await confirm({
                          title: `Delete "${activeDeck.name}"?`,
                          description:
                            "The deck and its card list will be removed. This cannot be undone.",
                          confirmLabel: "Delete deck",
                          destructive: true,
                        });
                        if (ok) deleteMutation.mutate(activeDeck.id);
                      }}
                      deleting={deleteMutation.isPending}
                    />
                  ) : (
                    <Card className="flex items-center justify-center p-12 lg:min-h-[24rem]">
                      <div className="text-center text-muted-foreground">
                        <Layers className="mx-auto h-12 w-12 mb-3 opacity-40" />
                        <p className="text-sm">
                          Select a deck to view its contents
                        </p>
                      </div>
                    </Card>
                  )}
                </div>
              </div>
            )}
          </>
        )}
      </div>

      <NewDeckDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        token={token}
        enabledGames={enabledGames}
        onCreated={(deck) => {
          void queryClient.invalidateQueries({ queryKey: ["decks"] });
          setSelectedDeck(deck.id);
        }}
      />
      <YdkImportDialog
        open={ydkOpen}
        onOpenChange={setYdkOpen}
        token={token}
        onCreated={(deck) => {
          void queryClient.invalidateQueries({ queryKey: ["decks"] });
          setSelectedDeck(deck.id);
        }}
      />
      {confirmDialog}
    </AppShell>
  );
}

function DeckDetail({
  deck,
  onDelete,
  deleting,
}: {
  deck: DeckResponse;
  onDelete: () => void;
  deleting: boolean;
}) {
  return (
    <Card className="sticky top-20">
      <CardHeader>
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <div
              className="h-6 w-1.5 rounded-full"
              style={{ backgroundColor: deck.colorHex ?? gameColor(deck.tcg) }}
            />
            <CardTitle>{deck.name}</CardTitle>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="text-muted-foreground hover:text-destructive"
            onClick={onDelete}
            disabled={deleting}
            aria-label="Delete deck"
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
        {deck.description && (
          <CardDescription>{deck.description}</CardDescription>
        )}
        <div className="flex items-center gap-2 mt-1">
          <GameBadge game={deck.tcg} />
          {deck.format && <Badge variant="secondary">{deck.format}</Badge>}
          <span className="text-xs text-muted-foreground">
            Updated{" "}
            {new Date(deck.updatedAt).toLocaleDateString(undefined, {
              month: "short",
              day: "numeric",
            })}
          </span>
        </div>
      </CardHeader>
      <CardContent>
        {deck.tcg === "yugioh" ? (
          <YugiohDeckBuilder deck={deck} />
        ) : deck.cards.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            This deck has no cards yet.
          </p>
        ) : (
          <div className="space-y-1">
            <div className="grid grid-cols-[1fr_auto_auto] gap-2 text-xs font-medium text-muted-foreground pb-2 border-b">
              <span>Card Name</span>
              <span className="text-center w-8">Qty</span>
              <span className="text-right w-24">Set</span>
            </div>
            {deck.cards.map((card) => (
              <div
                key={card.id}
                className="grid grid-cols-[1fr_auto_auto] gap-2 items-center py-1.5 text-sm border-b border-border/40 last:border-0"
              >
                <span className="truncate">
                  {card.name}
                  {card.isCommander && (
                    <Badge variant="secondary" className="ml-2 text-[10px]">
                      Commander
                    </Badge>
                  )}
                  {card.isSideboard && (
                    <Badge variant="outline" className="ml-2 text-[10px]">
                      Side
                    </Badge>
                  )}
                </span>
                <span className="text-center w-8 text-muted-foreground">
                  x{card.quantity}
                </span>
                <span className="text-right w-24 text-xs text-muted-foreground truncate">
                  {card.setCode ?? card.setName ?? "—"}
                </span>
              </div>
            ))}
          </div>
        )}
        <div className="mt-4 flex items-center justify-between text-sm">
          <span className="text-muted-foreground">Total</span>
          <span className="font-semibold">{deck.cardCount} cards</span>
        </div>
      </CardContent>
    </Card>
  );
}

const YUGIOH_ZONES: YugiohDeckZone[] = ["main", "extra", "side"];

function deckCardBaseId(card: DeckResponse["cards"][number]) {
  const data = card.cardData ?? {};
  return String(
    data.baseExternalId ??
      data.baseId ??
      (data.attributes as Record<string, unknown> | undefined)?.baseId ??
      card.externalId,
  );
}

function YugiohDeckBuilder({ deck }: { deck: DeckResponse }) {
  const token = useAuthStore((state) => state.token);
  const queryClient = useQueryClient();
  const [query, setQuery] = useState("");
  const [zone, setZone] = useState<YugiohDeckZone>("main");
  const [validationMode, setValidationMode] = useState<"classical" | "genesys">(
    "classical",
  );
  const [exportNotice, setExportNotice] = useState<string | null>(null);
  const [banlistCards, setBanlistCards] = useState("{}");
  const [maxPoints, setMaxPoints] = useState("100");
  const [validationError, setValidationError] = useState<string | null>(null);

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["decks"] });
    void queryClient.invalidateQueries({ queryKey: ["deck-ownership", deck.id] });
  };
  const poolQuery = useQuery({
    queryKey: ["deck-card-pool", query, "yugioh"],
    queryFn: () => searchCards(token!, query.trim(), "yugioh"),
    enabled: Boolean(token && query.trim().length >= 2),
    staleTime: 60_000,
  });
  const ownershipQuery = useQuery({
    queryKey: ["deck-ownership", deck.id],
    queryFn: () => getDeckOwnership(token!, deck.id),
    enabled: Boolean(token),
  });
  const addMutation = useMutation({
    mutationFn: (card: CardResult) =>
      addCardToDeck(token!, deck.id, {
        externalId: card.id,
        tcg: "yugioh",
        name: card.name,
        quantity: 1,
        zone,
        imageUrl: card.imageUrl,
        imageUrlSmall: card.imageUrlSmall,
        setCode: card.setCode,
        setName: card.setName,
        cardData: { ...card, baseExternalId: card.baseExternalId ?? card.id },
      }),
    onSuccess: refresh,
  });
  const updateMutation = useMutation({
    mutationFn: ({
      cardId,
      quantity,
      nextZone,
    }: {
      cardId: string;
      quantity?: number;
      nextZone?: YugiohDeckZone;
    }) =>
      updateDeckCard(token!, deck.id, cardId, {
        quantity,
        zone: nextZone,
      }),
    onSuccess: refresh,
  });
  const removeMutation = useMutation({
    mutationFn: (cardId: string) => removeDeckCard(token!, deck.id, cardId),
    onSuccess: refresh,
  });
  const validationMutation = useMutation({
    mutationFn: async () => {
      const cards = JSON.parse(banlistCards) as Record<string, string | number>;
      return validateDeck(token!, deck.id, {
        format: deck.format,
        banlist:
          validationMode === "genesys"
            ? {
                type: "genesys",
                name: "Genesys",
                maxPoints: Number(maxPoints),
                cards: cards as Record<string, number>,
              }
            : {
                type: "classical",
                name: deck.format || "TCG Advanced",
                cards: cards as Record<string, string>,
              },
      });
    },
    onMutate: () => setValidationError(null),
    onError: (error) =>
      setValidationError(
        error instanceof SyntaxError
          ? "Banlist card map must be valid JSON."
          : (error as Error).message,
      ),
  });

  const owned = new Map(
    (ownershipQuery.data?.owned ?? []).map((item) => [
      item.externalId,
      item.quantity,
    ]),
  );

  async function downloadYdk() {
    const result = await exportDeckYdk(token!, deck.id);
    const blob = new Blob([result.content], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${deck.name.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.ydk`;
    anchor.click();
    URL.revokeObjectURL(url);
    setExportNotice(
      result.skipped.length
        ? `${result.skipped.length} card${result.skipped.length === 1 ? "" : "s"} left out — no eight-digit passcode.`
        : null,
    );
  }

  return (
    <div className="space-y-5">
      {exportNotice && (
        <p
          role="status"
          className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400"
        >
          {exportNotice}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" size="sm" onClick={() => void downloadYdk()}>
          <Download className="mr-2 h-4 w-4" /> Export YDK
        </Button>
        <Badge
          variant={ownershipQuery.data?.missingCount ? "default" : "secondary"}
          className={ownershipQuery.data?.missingCount ? "bg-destructive text-destructive-foreground" : undefined}
        >
          {ownershipQuery.data?.missingCount ?? 0} missing
        </Badge>
      </div>

      <div className="space-y-2 rounded-lg border p-3">
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              aria-label="Search Yu-Gi-Oh card pool"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search Yu-Gi-Oh card pool"
              className="pl-8"
            />
          </div>
          <Select value={zone} onValueChange={(value) => setZone(value as YugiohDeckZone)}>
            <SelectTrigger className="w-28" aria-label="Deck zone for new cards"><SelectValue /></SelectTrigger>
            <SelectContent>
              {YUGIOH_ZONES.map((item) => (
                <SelectItem key={item} value={item}>
                  {item[0].toUpperCase() + item.slice(1)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {(poolQuery.data ?? []).slice(0, 8).map((card) => (
          <div key={card.id} className="flex items-center justify-between gap-2 text-sm">
            <span className="truncate">{card.name} <span className="text-xs text-muted-foreground">{card.setCode}</span></span>
            <Button
              size="sm"
              variant="outline"
              aria-label={`Add ${card.name} to ${zone} deck`}
              onClick={() => addMutation.mutate(card)}
            >
              <Plus className="h-3.5 w-3.5" />
            </Button>
          </div>
        ))}
      </div>

      {YUGIOH_ZONES.map((currentZone) => {
        const cards = deck.cards.filter((card) => card.zone === currentZone);
        const count = cards.reduce((sum, card) => sum + card.quantity, 0);
        return (
          <div key={currentZone} className="space-y-2">
            <div className="flex items-center justify-between border-b pb-1">
              <h3 className="text-sm font-semibold capitalize">{currentZone} Deck</h3>
              <Badge variant="outline">{count}</Badge>
            </div>
            {cards.length === 0 ? (
              <p className="text-xs text-muted-foreground">No cards in this zone.</p>
            ) : cards.map((card) => (
              <div key={card.id} className="flex items-center gap-2 text-sm">
                <span className="min-w-0 flex-1 truncate">
                  {card.name}
                  <span className="ml-2 text-xs text-muted-foreground">
                    owned {owned.get(deckCardBaseId(card)) ?? 0}
                  </span>
                </span>
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label={`Decrease ${card.name} quantity`}
                  disabled={card.quantity <= 1}
                  onClick={() =>
                    updateMutation.mutate({ cardId: card.id, quantity: card.quantity - 1 })
                  }
                >
                  <Minus className="h-3.5 w-3.5" />
                </Button>
                <span
                  className="w-5 text-center"
                  aria-label={`${card.name} quantity`}
                  aria-live="polite"
                >
                  {card.quantity}
                </span>
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label={`Increase ${card.name} quantity`}
                  onClick={() =>
                    updateMutation.mutate({ cardId: card.id, quantity: card.quantity + 1 })
                  }
                >
                  <Plus className="h-3.5 w-3.5" />
                </Button>
                <Select
                  value={card.zone}
                  onValueChange={(value) =>
                    updateMutation.mutate({
                      cardId: card.id,
                      nextZone: value as YugiohDeckZone,
                    })
                  }
                >
                  <SelectTrigger
                    className="h-8 w-24"
                    aria-label={`Deck zone for ${card.name}`}
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {YUGIOH_ZONES.map((item) => (
                      <SelectItem key={item} value={item}>{item}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label={`Remove ${card.name} from deck`}
                  onClick={() => removeMutation.mutate(card.id)}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            ))}
          </div>
        );
      })}

      <div className="space-y-3 rounded-lg border p-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold">Banlist validation</h3>
          <Select
            value={validationMode}
            onValueChange={(value) => setValidationMode(value as "classical" | "genesys")}
          >
            <SelectTrigger className="h-8 w-32" aria-label="Banlist validation mode">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="classical">Classical</SelectItem>
              <SelectItem value="genesys">Genesys</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {validationMode === "genesys" && (
          <Input
            aria-label="Maximum Genesys points"
            type="number"
            min="0"
            value={maxPoints}
            onChange={(event) => setMaxPoints(event.target.value)}
            placeholder="Maximum points"
          />
        )}
        <Textarea
          aria-label="Banlist card map"
          value={banlistCards}
          onChange={(event) => setBanlistCards(event.target.value)}
          rows={3}
          placeholder='{"46986414":"Limited"} or {"46986414":4}'
          className="font-mono text-xs"
        />
        <Button size="sm" onClick={() => validationMutation.mutate()}>
          Validate deck
        </Button>
        {validationError && <p className="text-sm text-destructive" role="alert">{validationError}</p>}
        {validationMutation.data && (
          <div className="text-sm">
            <Badge
              variant={validationMutation.data.valid ? "secondary" : "default"}
              className={validationMutation.data.valid ? undefined : "bg-destructive text-destructive-foreground"}
            >
              {validationMutation.data.valid ? "Valid" : "Invalid"}
            </Badge>
            {validationMutation.data.points !== undefined && (
              <span className="ml-2">{validationMutation.data.points} points</span>
            )}
            {[...validationMutation.data.errors, ...validationMutation.data.warnings].map(
              (message) => <p key={message} className="mt-1 text-xs text-muted-foreground">{message}</p>,
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function YdkImportDialog({
  open,
  onOpenChange,
  token,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  token: string | null;
  onCreated: (deck: DeckResponse) => void;
}) {
  const [name, setName] = useState("");
  const [content, setContent] = useState("");
  const mutation = useMutation({
    mutationFn: () =>
      importDeck(token!, {
        source: "ydk",
        data: content,
        name: name.trim() || undefined,
        tcg: "yugioh",
      }),
    onSuccess: (result) => {
      onCreated(result.deck);
      onOpenChange(false);
      setName("");
      setContent("");
    },
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Import YDK deck</DialogTitle>
          <DialogDescription>Paste a YGOPro-compatible .ydk file.</DialogDescription>
        </DialogHeader>
        <Input
          aria-label="Deck name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="Deck name"
        />
        <Textarea
          aria-label="YDK deck contents"
          value={content}
          onChange={(event) => setContent(event.target.value)}
          rows={12}
          className="font-mono text-xs"
          placeholder={"#main\n46986414\n#extra\n!side"}
        />
        {Boolean(mutation.error) && (
          <p className="text-sm text-destructive" role="alert">
            {(mutation.error as Error).message}
          </p>
        )}
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            disabled={!content.trim() || mutation.isPending}
            onClick={() => mutation.mutate()}
          >
            {mutation.isPending ? "Importing…" : "Import"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function NewDeckDialog({
  open,
  onOpenChange,
  token,
  enabledGames,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  token: string | null;
  enabledGames: Record<string, boolean>;
  onCreated: (deck: DeckResponse) => void;
}) {
  const [name, setName] = useState("");
  const [tcg, setTcg] = useState<ManageableGame>("magic");
  const [format, setFormat] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: () =>
      createDeck(token!, {
        name: name.trim(),
        tcg,
        format: format.trim() || undefined,
        description: description.trim() || undefined,
      }),
    onSuccess: (deck) => {
      onCreated(deck);
      onOpenChange(false);
      setName("");
      setFormat("");
      setDescription("");
      setError(null);
    },
    onError: (e) => setError((e as Error).message || "Failed to create deck"),
  });

  const availableGames = MANAGEABLE_GAMES.filter(
    (g) => enabledGames[g] !== false,
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New deck</DialogTitle>
          <DialogDescription>
            Create a deck, then add cards from card search.
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!name.trim()) {
              setError("Name is required");
              return;
            }
            mutation.mutate();
          }}
          className="space-y-4"
        >
          <div className="space-y-2">
            <Label htmlFor="deck-name">Name</Label>
            <Input
              id="deck-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Izzet Murktide"
              autoFocus
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="deck-tcg">Game</Label>
            <Select
              value={tcg}
              onValueChange={(v) =>
                setTcg(v as ManageableGame)
              }
            >
              <SelectTrigger id="deck-tcg">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(availableGames.length ? availableGames : MANAGEABLE_GAMES).map(
                  (g) => (
                    <SelectItem key={g} value={g}>
                      {tcgLabel(g)}
                    </SelectItem>
                  ),
                )}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="deck-format">Format (optional)</Label>
            <Input
              id="deck-format"
              value={format}
              onChange={(e) => setFormat(e.target.value)}
              placeholder="e.g. Modern, Standard, Advanced"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="deck-description">Description (optional)</Label>
            <Textarea
              id="deck-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
            />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending ? "Creating…" : "Create deck"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function StatCard({ title, value }: { title: string; value: number }) {
  return (
    <Card>
      <CardHeader className="p-3 pb-1 md:p-6 md:pb-4">
        <CardTitle className="text-xs md:text-sm font-medium text-muted-foreground">
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent className="p-3 pt-0 md:p-6 md:pt-0">
        <div className="text-xl md:text-3xl font-semibold">{value}</div>
      </CardContent>
    </Card>
  );
}

function DecksSkeleton() {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 md:gap-6 lg:grid-cols-3">
        {Array.from({ length: 3 }).map((_, idx) => (
          <Card key={idx}>
            <CardHeader className="p-3 md:p-6">
              <Skeleton className="h-4 w-20" />
            </CardHeader>
            <CardContent className="p-3 pt-0 md:p-6 md:pt-0">
              <Skeleton className="h-8 w-12" />
            </CardContent>
          </Card>
        ))}
      </div>
      <div className="grid gap-6 lg:grid-cols-[minmax(300px,26rem)_minmax(0,1fr)] lg:items-start">
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, idx) => (
            <Skeleton key={idx} className="h-24 w-full" />
          ))}
        </div>
        <Skeleton className="h-64 w-full" />
      </div>
    </div>
  );
}
