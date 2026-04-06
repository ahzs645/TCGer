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
    <AppShell data-oid="gs5l5na">
      <div className="space-y-6" data-oid="70ey5tw">
        <div className="flex items-center justify-between" data-oid="dd48z1d">
          <div data-oid="o4d11r0">
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
          <Button size="sm" disabled data-oid="3r454mu">
            <Plus className="mr-2 h-4 w-4" data-oid="vzyog62" />
            New Deck
          </Button>
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
                Total Cards
              </CardTitle>
            </CardHeader>
            <CardContent className="p-3 pt-0 md:p-6 md:pt-0" data-oid="5k8e_w3">
              <div
                className="text-xl md:text-3xl font-semibold"
                data-oid="2t.plrk"
              >
                {totalCards}
              </div>
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
                  className={`cursor-pointer transition hover:border-primary/50 ${isSelected ? "ring-2 ring-primary" : ""}`}
                  onClick={() => setSelectedDeck(isSelected ? null : deck.id)}
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

          {/* Deck detail */}
          <div data-oid="dldgokf">
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
    </AppShell>
  );
}
