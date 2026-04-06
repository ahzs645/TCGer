"use client";

import { useState } from "react";
import { Layers, Plus } from "lucide-react";

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

/* ------------------------------------------------------------------ */
/*  Fake deck data                                                      */
/* ------------------------------------------------------------------ */

interface DeckCard {
  name: string;
  quantity: number;
  rarity: string;
  type: string;
}

interface Deck {
  id: string;
  name: string;
  tcg: string;
  format: string;
  description: string;
  color: string;
  cards: DeckCard[];
  lastUpdated: string;
  isComplete: boolean;
}

const DECKS: Deck[] = [
  {
    id: "d1",
    name: "Branded Despia",
    tcg: "Yu-Gi-Oh!",
    format: "Advanced",
    description:
      "Fusion-focused combo deck centered around Branded Fusion and the Despia archetype.",
    color: "#8b5cf6",
    lastUpdated: "2025-03-18",
    isComplete: true,
    cards: [
      {
        name: "Ash Blossom & Joyous Spring",
        quantity: 3,
        rarity: "Ultra Rare",
        type: "Monster",
      },
      {
        name: "Nibiru, the Primal Being",
        quantity: 2,
        rarity: "Secret Rare",
        type: "Monster",
      },
      {
        name: "Effect Veiler",
        quantity: 2,
        rarity: "Ultra Rare",
        type: "Monster",
      },
      {
        name: "Called by the Grave",
        quantity: 1,
        rarity: "Common",
        type: "Spell",
      },
      {
        name: "Pot of Prosperity",
        quantity: 2,
        rarity: "Secret Rare",
        type: "Spell",
      },
      {
        name: "Infinite Impermanence",
        quantity: 3,
        rarity: "Secret Rare",
        type: "Trap",
      },
      {
        name: "Branded Fusion",
        quantity: 3,
        rarity: "Ultra Rare",
        type: "Spell",
      },
      {
        name: "Aluber the Jester of Despia",
        quantity: 3,
        rarity: "Ultra Rare",
        type: "Monster",
      },
      {
        name: "Fallen of Albaz",
        quantity: 2,
        rarity: "Super Rare",
        type: "Monster",
      },
      {
        name: "Dramaturge of Despia",
        quantity: 2,
        rarity: "Super Rare",
        type: "Monster",
      },
      { name: "Branded Opening", quantity: 3, rarity: "Rare", type: "Spell" },
      {
        name: "Branded in Red",
        quantity: 2,
        rarity: "Ultra Rare",
        type: "Trap",
      },
      {
        name: "Solemn Judgment",
        quantity: 1,
        rarity: "Ultra Rare",
        type: "Trap",
      },
      { name: "Raigeki", quantity: 1, rarity: "Ultra Rare", type: "Spell" },
      {
        name: "Monster Reborn",
        quantity: 1,
        rarity: "Ultra Rare",
        type: "Spell",
      },
    ],
  },
  {
    id: "d2",
    name: "Izzet Murktide",
    tcg: "Magic",
    format: "Modern",
    description:
      "Tempo-control deck leveraging Murktide Regent and efficient cantrips.",
    color: "#3b82f6",
    lastUpdated: "2025-03-15",
    isComplete: false,
    cards: [
      {
        name: "Ragavan, Nimble Pilferer",
        quantity: 4,
        rarity: "Mythic Rare",
        type: "Creature",
      },
      {
        name: "Murktide Regent",
        quantity: 4,
        rarity: "Mythic Rare",
        type: "Creature",
      },
      {
        name: "Lightning Bolt",
        quantity: 4,
        rarity: "Uncommon",
        type: "Instant",
      },
      {
        name: "Counterspell",
        quantity: 4,
        rarity: "Uncommon",
        type: "Instant",
      },
      {
        name: "Force of Negation",
        quantity: 2,
        rarity: "Rare",
        type: "Instant",
      },
      { name: "Prismatic Vista", quantity: 2, rarity: "Rare", type: "Land" },
      {
        name: "Mishra's Bauble",
        quantity: 4,
        rarity: "Uncommon",
        type: "Artifact",
      },
      {
        name: "Expressive Iteration",
        quantity: 4,
        rarity: "Uncommon",
        type: "Sorcery",
      },
      { name: "Unholy Heat", quantity: 4, rarity: "Common", type: "Instant" },
      { name: "Consider", quantity: 4, rarity: "Common", type: "Instant" },
    ],
  },
  {
    id: "d3",
    name: "Charizard ex Control",
    tcg: "Pokemon",
    format: "Standard",
    description:
      "Aggressive fire-type deck built around Charizard ex and draw supporters.",
    color: "#ef4444",
    lastUpdated: "2025-03-12",
    isComplete: true,
    cards: [
      {
        name: "Charizard ex",
        quantity: 3,
        rarity: "Special Art Rare",
        type: "Pokemon",
      },
      {
        name: "Arcanine ex",
        quantity: 2,
        rarity: "Double Rare",
        type: "Pokemon",
      },
      {
        name: "Iono",
        quantity: 4,
        rarity: "Special Art Rare",
        type: "Supporter",
      },
      { name: "Boss's Orders", quantity: 3, rarity: "Rare", type: "Supporter" },
      { name: "Rare Candy", quantity: 4, rarity: "Uncommon", type: "Item" },
      { name: "Nest Ball", quantity: 4, rarity: "Uncommon", type: "Item" },
      { name: "Ultra Ball", quantity: 4, rarity: "Uncommon", type: "Item" },
      { name: "Charmander", quantity: 4, rarity: "Common", type: "Pokemon" },
      { name: "Charmeleon", quantity: 1, rarity: "Uncommon", type: "Pokemon" },
      {
        name: "Lumineon V",
        quantity: 1,
        rarity: "Ultra Rare",
        type: "Pokemon",
      },
    ],
  },
  {
    id: "d4",
    name: "Labrynth Control",
    tcg: "Yu-Gi-Oh!",
    format: "Advanced",
    description:
      "Trap-heavy control strategy using the Labrynth archetype to outgrind opponents.",
    color: "#f59e0b",
    lastUpdated: "2025-02-28",
    isComplete: true,
    cards: [
      {
        name: "Infinite Impermanence",
        quantity: 3,
        rarity: "Secret Rare",
        type: "Trap",
      },
      {
        name: "Solemn Judgment",
        quantity: 3,
        rarity: "Ultra Rare",
        type: "Trap",
      },
      {
        name: "Ash Blossom & Joyous Spring",
        quantity: 3,
        rarity: "Ultra Rare",
        type: "Monster",
      },
      {
        name: "Pot of Prosperity",
        quantity: 3,
        rarity: "Secret Rare",
        type: "Spell",
      },
      { name: "Pot of Greed", quantity: 1, rarity: "Rare", type: "Spell" },
      { name: "Mirror Force", quantity: 2, rarity: "Ultra Rare", type: "Trap" },
      {
        name: "Mystical Space Typhoon",
        quantity: 2,
        rarity: "Ultra Rare",
        type: "Spell",
      },
    ],
  },
  {
    id: "d5",
    name: "Lost Zone Giratina",
    tcg: "Pokemon",
    format: "Standard",
    description:
      "Combo deck utilizing Lost Zone mechanics with Giratina VSTAR as the finisher.",
    color: "#6366f1",
    lastUpdated: "2025-03-01",
    isComplete: false,
    cards: [
      { name: "Giratina VSTAR", quantity: 2, rarity: "VSTAR", type: "Pokemon" },
      { name: "Mew ex", quantity: 1, rarity: "Double Rare", type: "Pokemon" },
      {
        name: "Iono",
        quantity: 4,
        rarity: "Special Art Rare",
        type: "Supporter",
      },
      { name: "Boss's Orders", quantity: 2, rarity: "Rare", type: "Supporter" },
      {
        name: "Gardevoir ex",
        quantity: 2,
        rarity: "Double Rare",
        type: "Pokemon",
      },
      { name: "Eevee", quantity: 2, rarity: "Common", type: "Pokemon" },
    ],
  },
  {
    id: "d6",
    name: "Hammer Time",
    tcg: "Magic",
    format: "Modern",
    description:
      "Equipment aggro deck using Colossus Hammer and Sigarda's Aid for explosive wins.",
    color: "#10b981",
    lastUpdated: "2025-02-20",
    isComplete: true,
    cards: [
      { name: "Urza's Saga", quantity: 4, rarity: "Rare", type: "Land" },
      {
        name: "Path to Exile",
        quantity: 3,
        rarity: "Uncommon",
        type: "Instant",
      },
      {
        name: "Mishra's Bauble",
        quantity: 4,
        rarity: "Uncommon",
        type: "Artifact",
      },
      {
        name: "Chalice of the Void",
        quantity: 2,
        rarity: "Rare",
        type: "Artifact",
      },
      {
        name: "Aether Vial",
        quantity: 4,
        rarity: "Uncommon",
        type: "Artifact",
      },
      {
        name: "Sigarda's Aid",
        quantity: 4,
        rarity: "Rare",
        type: "Enchantment",
      },
      {
        name: "Colossus Hammer",
        quantity: 4,
        rarity: "Uncommon",
        type: "Artifact",
      },
      {
        name: "Puresteel Paladin",
        quantity: 4,
        rarity: "Rare",
        type: "Creature",
      },
    ],
  },
];

const TCG_COLORS: Record<string, string> = {
  "Yu-Gi-Oh!": "#ef4444",
  Magic: "#8b5cf6",
  Pokemon: "#f59e0b",
};

export default function DecksPage() {
  const [selectedDeck, setSelectedDeck] = useState<string | null>(null);
  const activeDeck = DECKS.find((d) => d.id === selectedDeck);

  const totalDecks = DECKS.length;
  const completeDecks = DECKS.filter((d) => d.isComplete).length;
  const totalCards = DECKS.reduce(
    (s, d) => s + d.cards.reduce((a, c) => a + c.quantity, 0),
    0,
  );

  return (
    <AppShell data-oid="ikww_uf">
      <div className="space-y-6" data-oid="0cwyc8m">
        <div className="flex items-center justify-between" data-oid="m.-iggr">
          <div data-oid="2nct-a8">
            <h1
              className="text-3xl font-heading font-semibold"
              data-oid="75lwmez"
            >
              Decks
            </h1>
            <p className="text-sm text-muted-foreground" data-oid="dgksmta">
              Build and manage your constructed decks across all games.
            </p>
          </div>
          <Button size="sm" disabled data-oid="av0-pst">
            <Plus className="mr-2 h-4 w-4" data-oid="p.a5a0a" />
            New Deck
          </Button>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-3 gap-3 md:gap-6" data-oid="6h.21ed">
          <Card data-oid="38lyaqo">
            <CardHeader className="p-3 pb-1 md:p-6 md:pb-4" data-oid="3k6up5_">
              <CardTitle
                className="text-xs md:text-sm font-medium text-muted-foreground"
                data-oid="9l6v5c5"
              >
                Total Decks
              </CardTitle>
            </CardHeader>
            <CardContent className="p-3 pt-0 md:p-6 md:pt-0" data-oid="j1edsug">
              <div
                className="text-xl md:text-3xl font-semibold"
                data-oid="g1im5z."
              >
                {totalDecks}
              </div>
            </CardContent>
          </Card>
          <Card data-oid="queih2y">
            <CardHeader className="p-3 pb-1 md:p-6 md:pb-4" data-oid="5_qa4dl">
              <CardTitle
                className="text-xs md:text-sm font-medium text-muted-foreground"
                data-oid="fi8nl9n"
              >
                Complete
              </CardTitle>
            </CardHeader>
            <CardContent className="p-3 pt-0 md:p-6 md:pt-0" data-oid="4336yzv">
              <div
                className="text-xl md:text-3xl font-semibold text-green-500"
                data-oid="c22b4bd"
              >
                {completeDecks}/{totalDecks}
              </div>
            </CardContent>
          </Card>
          <Card data-oid="wl7c5hw">
            <CardHeader className="p-3 pb-1 md:p-6 md:pb-4" data-oid="9lh9:lq">
              <CardTitle
                className="text-xs md:text-sm font-medium text-muted-foreground"
                data-oid="cni.6-b"
              >
                Total Cards
              </CardTitle>
            </CardHeader>
            <CardContent className="p-3 pt-0 md:p-6 md:pt-0" data-oid="4_-cnc2">
              <div
                className="text-xl md:text-3xl font-semibold"
                data-oid="fhfagzu"
              >
                {totalCards}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Deck grid + detail view */}
        <div className="grid gap-6 lg:grid-cols-[1fr_1fr]" data-oid="y_dsuz4">
          {/* Deck list */}
          <div className="space-y-3" data-oid="h2cf3g2">
            {DECKS.map((deck) => {
              const cardCount = deck.cards.reduce((s, c) => s + c.quantity, 0);
              const isSelected = selectedDeck === deck.id;
              return (
                <Card
                  key={deck.id}
                  className={`cursor-pointer transition hover:border-primary/50 ${isSelected ? "ring-2 ring-primary" : ""}`}
                  onClick={() => setSelectedDeck(isSelected ? null : deck.id)}
                  data-oid="7z330i1"
                >
                  <CardContent className="p-4" data-oid="ws2s_yn">
                    <div
                      className="flex items-start justify-between gap-2"
                      data-oid="fcrvi_:"
                    >
                      <div
                        className="flex items-center gap-3"
                        data-oid="vmrqud9"
                      >
                        <div
                          className="h-10 w-1.5 rounded-full"
                          style={{ backgroundColor: deck.color }}
                          data-oid="vzba0_k"
                        />
                        <div data-oid="o8:-1k7">
                          <p
                            className="text-sm font-semibold"
                            data-oid="jdp82gv"
                          >
                            {deck.name}
                          </p>
                          <div
                            className="flex items-center gap-2 mt-0.5"
                            data-oid="d5j51k4"
                          >
                            <Badge
                              variant="outline"
                              className="text-xs"
                              style={{ borderColor: TCG_COLORS[deck.tcg] }}
                              data-oid="0g.uqf-"
                            >
                              {deck.tcg}
                            </Badge>
                            <span
                              className="text-xs text-muted-foreground"
                              data-oid="5:rwc2e"
                            >
                              {deck.format}
                            </span>
                          </div>
                        </div>
                      </div>
                      <div className="text-right" data-oid="669_p:f">
                        <p className="text-sm font-medium" data-oid="t-jrm7u">
                          {cardCount} cards
                        </p>
                        <Badge
                          variant={deck.isComplete ? "default" : "secondary"}
                          className="text-xs mt-0.5"
                          data-oid="wj9:3ge"
                        >
                          {deck.isComplete ? "Complete" : "In Progress"}
                        </Badge>
                      </div>
                    </div>
                    <p
                      className="text-xs text-muted-foreground mt-2 line-clamp-2"
                      data-oid="xtse5um"
                    >
                      {deck.description}
                    </p>
                  </CardContent>
                </Card>
              );
            })}
          </div>

          {/* Deck detail */}
          <div data-oid="346gtuu">
            {activeDeck ? (
              <Card className="sticky top-20" data-oid="j8eou_:">
                <CardHeader data-oid="q.m:_1x">
                  <div className="flex items-center gap-2" data-oid="o-1xis2">
                    <div
                      className="h-6 w-1.5 rounded-full"
                      style={{ backgroundColor: activeDeck.color }}
                      data-oid="bk0f86c"
                    />
                    <CardTitle data-oid="e5.na31">{activeDeck.name}</CardTitle>
                  </div>
                  <CardDescription data-oid=".lnpc1t">
                    {activeDeck.description}
                  </CardDescription>
                  <div
                    className="flex items-center gap-2 mt-1"
                    data-oid="0e-vk29"
                  >
                    <Badge
                      variant="outline"
                      style={{ borderColor: TCG_COLORS[activeDeck.tcg] }}
                      data-oid="_ss405_"
                    >
                      {activeDeck.tcg}
                    </Badge>
                    <Badge variant="secondary" data-oid="ceslf0-">
                      {activeDeck.format}
                    </Badge>
                    <span
                      className="text-xs text-muted-foreground"
                      data-oid="h7h.vum"
                    >
                      Updated{" "}
                      {new Date(activeDeck.lastUpdated).toLocaleDateString(
                        undefined,
                        { month: "short", day: "numeric" },
                      )}
                    </span>
                  </div>
                </CardHeader>
                <CardContent data-oid="300ixb0">
                  <div className="space-y-1" data-oid="c0j-ahy">
                    <div
                      className="grid grid-cols-[1fr_auto_auto] gap-2 text-xs font-medium text-muted-foreground pb-2 border-b"
                      data-oid="yp2f5zc"
                    >
                      <span data-oid="xjhao7w">Card Name</span>
                      <span className="text-center w-8" data-oid="0o:44lz">
                        Qty
                      </span>
                      <span className="text-right w-24" data-oid="nie83z8">
                        Type
                      </span>
                    </div>
                    {activeDeck.cards.map((card, i) => (
                      <div
                        key={i}
                        className="grid grid-cols-[1fr_auto_auto] gap-2 items-center py-1.5 text-sm border-b border-border/40 last:border-0"
                        data-oid="kn-1zhz"
                      >
                        <span className="truncate" data-oid="t-f8_kk">
                          {card.name}
                        </span>
                        <span
                          className="text-center w-8 text-muted-foreground"
                          data-oid="u7zhth3"
                        >
                          x{card.quantity}
                        </span>
                        <span
                          className="text-right w-24 text-xs text-muted-foreground"
                          data-oid="f9-i1y5"
                        >
                          {card.type}
                        </span>
                      </div>
                    ))}
                  </div>
                  <div
                    className="mt-4 flex items-center justify-between text-sm"
                    data-oid="uma-cx0"
                  >
                    <span className="text-muted-foreground" data-oid="bi_g-16">
                      Total
                    </span>
                    <span className="font-semibold" data-oid="j:1dr4i">
                      {activeDeck.cards.reduce((s, c) => s + c.quantity, 0)}{" "}
                      cards
                    </span>
                  </div>
                </CardContent>
              </Card>
            ) : (
              <Card
                className="flex items-center justify-center p-12"
                data-oid="xsb3by4"
              >
                <div
                  className="text-center text-muted-foreground"
                  data-oid="t.--tbr"
                >
                  <Layers
                    className="mx-auto h-12 w-12 mb-3 opacity-40"
                    data-oid="i65rajn"
                  />
                  <p className="text-sm" data-oid="-z4be58">
                    Select a deck to view its contents
                  </p>
                </div>
              </Card>
            )}
          </div>
        </div>
      </div>
    </AppShell>
  );
}
