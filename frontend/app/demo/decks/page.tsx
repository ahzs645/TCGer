"use client";

import { useEffect, useRef, useState } from "react";
import { Layers, Plus, Trash2 } from "lucide-react";

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
import { useConfirm } from "@/components/ui/confirm-dialog";
import type { Deck } from "@/lib/data/demo-portfolio";
import { useDemoStore } from "@/stores/demo-store";

/* ------------------------------------------------------------------ */
/*  Fake deck data                                                      */
/* ------------------------------------------------------------------ */

const TCG_COLORS: Record<string, string> = {
  "Yu-Gi-Oh!": "#ef4444",
  Magic: "#8b5cf6",
  Pokemon: "#f59e0b",
};

export default function DecksPage() {
  const [selectedDeck, setSelectedDeck] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [confirm, confirmDialog] = useConfirm();

  // The demo store is persisted, so its contents only match the server-rendered
  // markup once we are on the client.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const storeDecks = useDemoStore((state) => state.decks);
  const addDeck = useDemoStore((state) => state.addDeck);
  const removeDeck = useDemoStore((state) => state.removeDeck);
  const DECKS: Deck[] = mounted ? storeDecks : [];

  const activeDeck = DECKS.find((d) => d.id === selectedDeck);

  // Below lg the detail renders underneath all six deck cards, so selecting one
  // looked like nothing happened. Bring it into view on selection — but only on
  // the stacked layout, where it is off-screen.
  const detailRef = useRef<HTMLDivElement | null>(null);
  const selectDeck = (id: string | null) => {
    setSelectedDeck(id);
    if (!id) return;
    requestAnimationFrame(() => {
      if (window.matchMedia("(min-width: 1024px)").matches) return;
      detailRef.current?.scrollIntoView({
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
          ? "auto"
          : "smooth",
        block: "start",
      });
    });
  };

  const totalDecks = DECKS.length;
  const completeDecks = DECKS.filter((d) => d.isComplete).length;
  // Sum of the per-deck counts shown on each deck card below — this counts
  // cards across deck lists, which is a different figure from the collection
  // total reported on the dashboard.
  const cardsAcrossDecks = DECKS.reduce(
    (s, d) => s + d.cards.reduce((a, c) => a + c.quantity, 0),
    0,
  );

  const [form, setForm] = useState({
    name: "",
    tcg: "Yu-Gi-Oh!",
    format: "Advanced",
  });

  const handleCreate = () => {
    if (!form.name.trim()) return;
    const id = addDeck({
      name: form.name.trim(),
      tcg: form.tcg,
      format: form.format,
    });
    setForm({ name: "", tcg: "Yu-Gi-Oh!", format: "Advanced" });
    setCreateOpen(false);
    setSelectedDeck(id);
  };

  const handleDelete = async (deck: Deck) => {
    const ok = await confirm({
      title: `Delete "${deck.name}"?`,
      description: "The deck and its card list will be removed.",
      confirmLabel: "Delete deck",
      destructive: true,
    });
    if (!ok) return;
    removeDeck(deck.id);
    if (selectedDeck === deck.id) setSelectedDeck(null);
  };

  return (
    <AppShell data-oid="gs5l5na">
      <div className="space-y-6" data-oid="70ey5tw">
        <div
          className="flex items-start justify-between gap-3"
          data-oid="dd48z1d"
        >
          <div className="min-w-0 flex-1" data-oid="o4d11r0">
            <h1
              className="text-3xl font-heading font-semibold"
              data-oid="2osw5qk"
            >
              Decks
            </h1>
            <p className="text-sm text-muted-foreground" data-oid="8057ask">
              Build and manage your constructed decks across all games.
            </p>
          </div>
          <div className="shrink-0">
            <Button
              size="sm"
              onClick={() => setCreateOpen(true)}
              data-oid="3r454mu"
            >
              <Plus className="mr-2 h-4 w-4" data-oid="vzyog62" />
              New Deck
            </Button>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-3 gap-3 md:gap-6" data-oid="9m6z._l">
          <Card data-oid="4m-d.b5">
            <CardHeader className="p-3 pb-1 md:p-6 md:pb-4" data-oid="g0oh.f4">
              <CardTitle
                className="text-xs md:text-sm font-medium text-muted-foreground"
                data-oid="hgc.9ul"
              >
                Total Decks
              </CardTitle>
            </CardHeader>
            <CardContent className="p-3 pt-0 md:p-6 md:pt-0" data-oid="vd21155">
              <div
                className="text-xl md:text-3xl font-semibold"
                data-oid="28r8e0g"
              >
                {totalDecks}
              </div>
            </CardContent>
          </Card>
          <Card data-oid="l8tk89k">
            <CardHeader className="p-3 pb-1 md:p-6 md:pb-4" data-oid="mmsrhi_">
              <CardTitle
                className="text-xs md:text-sm font-medium text-muted-foreground"
                data-oid="0jiqrb6"
              >
                Complete
              </CardTitle>
            </CardHeader>
            <CardContent className="p-3 pt-0 md:p-6 md:pt-0" data-oid="dw.:4w1">
              <div
                className="text-xl md:text-3xl font-semibold text-green-500"
                data-oid="239mfw2"
              >
                {completeDecks}/{totalDecks}
              </div>
            </CardContent>
          </Card>
          <Card data-oid="s-f_f21">
            <CardHeader className="p-3 pb-1 md:p-6 md:pb-4" data-oid="cfs5r3b">
              <CardTitle
                className="text-xs md:text-sm font-medium text-muted-foreground"
                data-oid="xrwxr25"
              >
                Cards Across Decks
              </CardTitle>
            </CardHeader>
            <CardContent className="p-3 pt-0 md:p-6 md:pt-0" data-oid="5k8e_w3">
              <div
                className="text-xl md:text-3xl font-semibold"
                data-oid="2t.plrk"
              >
                {cardsAcrossDecks}
              </div>
              <p
                className="text-[10px] md:text-xs text-muted-foreground mt-0.5"
                title="Counts cards across deck lists, which is a different figure from the collection total"
              >
                {/* Three columns at 390px leaves ~80px per cell, where the long
                    form wrapped to three lines. */}
                <span className="sm:hidden">Not collection size</span>
                <span className="hidden sm:inline">
                  In deck lists, not collection size
                </span>
              </p>
            </CardContent>
          </Card>
        </div>

        {/* Deck grid + detail view */}
        <div className="grid gap-6 lg:grid-cols-[1fr_1fr]" data-oid="1pzpcl0">
          {/* Deck list */}
          <div className="space-y-3" data-oid="t-_eku1">
            {DECKS.map((deck) => {
              const cardCount = deck.cards.reduce((s, c) => s + c.quantity, 0);
              const isSelected = selectedDeck === deck.id;
              return (
                <Card
                  key={deck.id}
                  // The card was a clickable <div>: usable with a mouse, invisible
                  // to the keyboard and to assistive tech. role + tabIndex + key
                  // handling make it a real control without changing the visuals.
                  role="button"
                  tabIndex={0}
                  aria-pressed={isSelected}
                  aria-label={`${deck.name}, ${cardCount} cards${isSelected ? " (selected)" : ""}`}
                  className={`cursor-pointer transition hover:border-primary/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${isSelected ? "ring-2 ring-primary" : ""}`}
                  onClick={() => selectDeck(isSelected ? null : deck.id)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      selectDeck(isSelected ? null : deck.id);
                    }
                  }}
                  data-oid="s:vnkkz"
                >
                  <CardContent className="p-4" data-oid="_in8wgu">
                    <div
                      className="flex items-start justify-between gap-2"
                      data-oid="117fxyo"
                    >
                      <div
                        className="flex items-center gap-3"
                        data-oid="77z6m3z"
                      >
                        <div
                          className="h-10 w-1.5 rounded-full"
                          style={{ backgroundColor: deck.color }}
                          data-oid="jwx6rve"
                        />
                        <div data-oid="gs39r:z">
                          <p
                            className="text-sm font-semibold"
                            data-oid="x..4wkt"
                          >
                            {deck.name}
                          </p>
                          <div
                            className="flex items-center gap-2 mt-0.5"
                            data-oid="g33:5-h"
                          >
                            <Badge
                              variant="outline"
                              className="text-xs"
                              style={{ borderColor: TCG_COLORS[deck.tcg] }}
                              data-oid="_xw156-"
                            >
                              {deck.tcg}
                            </Badge>
                            <span
                              className="text-xs text-muted-foreground"
                              data-oid="z.v4zkg"
                            >
                              {deck.format}
                            </span>
                          </div>
                        </div>
                      </div>
                      <div className="text-right" data-oid="lpk3sqy">
                        <p className="text-sm font-medium" data-oid="uhbf1xo">
                          {cardCount} cards
                        </p>
                        <Badge
                          variant={deck.isComplete ? "default" : "secondary"}
                          className="text-xs mt-0.5"
                          data-oid="eh14b9a"
                        >
                          {deck.isComplete ? "Complete" : "In Progress"}
                        </Badge>
                      </div>
                    </div>
                    <p
                      className="text-xs text-muted-foreground mt-2 line-clamp-2"
                      data-oid="10hu_2m"
                    >
                      {deck.description}
                    </p>
                  </CardContent>
                </Card>
              );
            })}
          </div>

          {/* Deck detail — the two-column layout only kicks in at lg, so below
              that the empty placeholder is dead weight at the foot of the page.
              A selected deck still renders its detail card on every size. */}
          <div
            ref={detailRef}
            className={activeDeck ? "scroll-mt-20" : "hidden lg:block"}
            data-oid="dldgokf"
          >
            {activeDeck ? (
              <Card className="sticky top-20" data-oid="dsev3su">
                <CardHeader data-oid="b9cp5tj">
                  <div className="flex items-center gap-2" data-oid="k7qob69">
                    <div
                      className="h-6 w-1.5 rounded-full"
                      style={{ backgroundColor: activeDeck.color }}
                      data-oid="j4:805e"
                    />
                    <CardTitle data-oid="_cw8fzq">{activeDeck.name}</CardTitle>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="ml-auto text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                      onClick={() => handleDelete(activeDeck)}
                      aria-label={`Delete ${activeDeck.name}`}
                      title="Delete deck"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                  <CardDescription data-oid="u7f7r1x">
                    {activeDeck.description}
                  </CardDescription>
                  <div
                    className="flex items-center gap-2 mt-1"
                    data-oid="l4vk8xh"
                  >
                    <Badge
                      variant="outline"
                      style={{ borderColor: TCG_COLORS[activeDeck.tcg] }}
                      data-oid=".egf41l"
                    >
                      {activeDeck.tcg}
                    </Badge>
                    <Badge variant="secondary" data-oid="2469m-j">
                      {activeDeck.format}
                    </Badge>
                    <span
                      className="text-xs text-muted-foreground"
                      data-oid="32isdw:"
                    >
                      Updated{" "}
                      {new Date(activeDeck.lastUpdated).toLocaleDateString(
                        undefined,
                        { month: "short", day: "numeric" },
                      )}
                    </span>
                  </div>
                </CardHeader>
                <CardContent data-oid="7b4wlv8">
                  <div className="space-y-1" data-oid="0fzjyfx">
                    <div
                      className="grid grid-cols-[1fr_auto_auto] gap-2 text-xs font-medium text-muted-foreground pb-2 border-b"
                      data-oid="yjo3fj7"
                    >
                      <span data-oid="k1se0fv">Card Name</span>
                      <span className="text-center w-8" data-oid="kboeo.g">
                        Qty
                      </span>
                      <span className="text-right w-24" data-oid="tr9gimg">
                        Type
                      </span>
                    </div>
                    {activeDeck.cards.map((card, i) => (
                      <div
                        key={i}
                        className="grid grid-cols-[1fr_auto_auto] gap-2 items-center py-1.5 text-sm border-b border-border/40 last:border-0"
                        data-oid="bvqhrmr"
                      >
                        <span className="truncate" data-oid="ms-cq25">
                          {card.name}
                        </span>
                        <span
                          className="text-center w-8 text-muted-foreground"
                          data-oid="gwz-r3."
                        >
                          x{card.quantity}
                        </span>
                        <span
                          className="text-right w-24 text-xs text-muted-foreground"
                          data-oid="mrja1a1"
                        >
                          {card.type}
                        </span>
                      </div>
                    ))}
                  </div>
                  <div
                    className="mt-4 flex items-center justify-between text-sm"
                    data-oid="p3x3_8v"
                  >
                    <span className="text-muted-foreground" data-oid="5ofef7x">
                      Total
                    </span>
                    <span className="font-semibold" data-oid="0o:9kq.">
                      {activeDeck.cards.reduce((s, c) => s + c.quantity, 0)}{" "}
                      cards
                    </span>
                  </div>
                </CardContent>
              </Card>
            ) : (
              <Card
                className="flex items-center justify-center p-12"
                data-oid="h68dzf9"
              >
                <div
                  className="text-center text-muted-foreground"
                  data-oid="k2zd.vu"
                >
                  <Layers
                    className="mx-auto h-12 w-12 mb-3 opacity-40"
                    data-oid="3nx4xtn"
                  />
                  <p className="text-sm" data-oid="irnkc3a">
                    Select a deck to view its contents
                  </p>
                </div>
              </Card>
            )}
          </div>
        </div>
      </div>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>New deck</DialogTitle>
            <DialogDescription>
              Start an empty list. You can add cards to it from Card Search.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="deck-name">Deck name</Label>
              <Input
                id="deck-name"
                value={form.name}
                placeholder="e.g. Branded Despia"
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleCreate();
                }}
                autoFocus
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="deck-game">Game</Label>
                <Select
                  value={form.tcg}
                  onValueChange={(value) => setForm({ ...form, tcg: value })}
                >
                  <SelectTrigger id="deck-game">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {["Yu-Gi-Oh!", "Magic", "Pokemon"].map((game) => (
                      <SelectItem key={game} value={game}>
                        {game}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="deck-format">Format</Label>
                <Input
                  id="deck-format"
                  value={form.format}
                  placeholder="e.g. Modern"
                  onChange={(e) => setForm({ ...form, format: e.target.value })}
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleCreate} disabled={!form.name.trim()}>
              Create deck
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {confirmDialog}
    </AppShell>
  );
}
