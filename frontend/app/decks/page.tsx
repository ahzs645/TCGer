"use client";

import { useEffect, useMemo, useState } from "react";
import { Layers, Plus, Trash2 } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

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
  getDecks,
  type DeckResponse,
} from "@/lib/api/decks";
import { GAME_LABELS, type SupportedGame } from "@/lib/utils";
import { useAuthStore } from "@/stores/auth";
import { useGameFilterStore } from "@/stores/game-filter";
import { useModuleStore } from "@/stores/preferences";

const TCG_COLORS: Record<string, string> = {
  yugioh: "#ef4444",
  magic: "#8b5cf6",
  pokemon: "#f59e0b",
};
const MANAGEABLE_GAMES = ["magic", "yugioh", "pokemon"] as const;

function tcgLabel(tcg: string): string {
  return GAME_LABELS[tcg as SupportedGame] ?? tcg;
}

export default function DecksPage() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const [selectedDeck, setSelectedDeck] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);

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
          <Button
            size="sm"
            onClick={() => setCreateOpen(true)}
            disabled={!mounted || !isAuthenticated}
          >
            <Plus className="mr-2 h-4 w-4" />
            New Deck
          </Button>
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
            <div className="grid grid-cols-3 gap-3 md:gap-6">
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
              <div className="grid gap-6 lg:grid-cols-[1fr_1fr]">
                {/* Deck list */}
                <div className="space-y-3">
                  {decks.map((deck) => {
                    const isSelected = selectedDeck === deck.id;
                    const color = deck.colorHex ?? TCG_COLORS[deck.tcg];
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
                                  <Badge
                                    variant="outline"
                                    className="text-xs"
                                    style={{ borderColor: TCG_COLORS[deck.tcg] }}
                                  >
                                    {tcgLabel(deck.tcg)}
                                  </Badge>
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

                {/* Deck detail */}
                <div>
                  {activeDeck ? (
                    <DeckDetail
                      deck={activeDeck}
                      onDelete={() => {
                        if (
                          window.confirm(
                            `Delete deck "${activeDeck.name}"? This cannot be undone.`,
                          )
                        ) {
                          deleteMutation.mutate(activeDeck.id);
                        }
                      }}
                      deleting={deleteMutation.isPending}
                    />
                  ) : (
                    <Card className="flex items-center justify-center p-12">
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
              style={{ backgroundColor: deck.colorHex ?? TCG_COLORS[deck.tcg] }}
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
          <Badge variant="outline" style={{ borderColor: TCG_COLORS[deck.tcg] }}>
            {tcgLabel(deck.tcg)}
          </Badge>
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
        {deck.cards.length === 0 ? (
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
  const [tcg, setTcg] = useState<(typeof MANAGEABLE_GAMES)[number]>("magic");
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
                setTcg(v as (typeof MANAGEABLE_GAMES)[number])
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
      <div className="grid grid-cols-3 gap-3 md:gap-6">
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
      <div className="grid gap-6 lg:grid-cols-[1fr_1fr]">
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
