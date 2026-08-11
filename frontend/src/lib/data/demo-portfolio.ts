/**
 * Seed data for the demo's decks, trades and sealed inventory.
 *
 * These used to be page-local constants, which meant the pages could only ever
 * display them — creating anything was disabled. Owning them here lets the demo
 * store seed and mutate them like binders and wishlists, so the create flows in
 * the demo behave the way they do in the real app.
 */

export interface TradeCard {
  name: string;
  tcg: string;
  value: number;
}

export interface Trade {
  id: string;
  partner: string;
  status: "completed" | "pending" | "declined";
  date: string;
  giving: TradeCard[];
  receiving: TradeCard[];
}

export const DEMO_TRADES: Trade[] = [
  {
    id: "t1",
    partner: "CardMaster42",
    status: "completed",
    date: "2025-03-15",
    giving: [
      { name: "Fury", tcg: "Magic", value: 12.0 },
      { name: "Grief", tcg: "Magic", value: 8.5 },
    ],

    receiving: [
      { name: "Ash Blossom & Joyous Spring", tcg: "Yu-Gi-Oh!", value: 5.5 },
      { name: "Nibiru, the Primal Being", tcg: "Yu-Gi-Oh!", value: 8.95 },
      { name: "Effect Veiler", tcg: "Yu-Gi-Oh!", value: 3.8 },
    ],
  },
  {
    id: "t2",
    partner: "PikachuCollector",
    status: "completed",
    date: "2025-03-10",
    giving: [
      { name: "Mewtwo VSTAR", tcg: "Pokemon", value: 7.5 },
      { name: "Pikachu", tcg: "Pokemon", value: 2.5 },
    ],

    receiving: [{ name: "Iono", tcg: "Pokemon", value: 32.0 }],
  },
  {
    id: "t3",
    partner: "ModernMage",
    status: "pending",
    date: "2025-03-18",
    giving: [{ name: "Solitude", tcg: "Magic", value: 32.0 }],

    receiving: [
      { name: "Ragavan, Nimble Pilferer", tcg: "Magic", value: 68.4 },
    ],
  },
  {
    id: "t4",
    partner: "DuelistKing",
    status: "completed",
    date: "2025-02-28",
    giving: [
      { name: "Pot of Greed", tcg: "Yu-Gi-Oh!", value: 3.2 },
      { name: "Monster Reborn", tcg: "Yu-Gi-Oh!", value: 5.0 },
      { name: "Raigeki", tcg: "Yu-Gi-Oh!", value: 6.25 },
    ],

    receiving: [{ name: "Accesscode Talker", tcg: "Yu-Gi-Oh!", value: 18.0 }],
  },
  {
    id: "t5",
    partner: "VintageVault",
    status: "declined",
    date: "2025-03-05",
    giving: [{ name: "Charizard ex", tcg: "Pokemon", value: 85.0 }],

    receiving: [
      { name: "Lightning Bolt", tcg: "Magic", value: 1.5 },
      { name: "Counterspell", tcg: "Magic", value: 2.25 },
    ],
  },
  {
    id: "t6",
    partner: "TradeKing99",
    status: "pending",
    date: "2025-03-19",
    giving: [
      { name: "Endurance", tcg: "Magic", value: 26.0 },
      { name: "Fatal Push", tcg: "Magic", value: 3.5 },
    ],

    receiving: [{ name: "Wrenn and Six", tcg: "Magic", value: 55.0 }],
  },
  {
    id: "t7",
    partner: "PKMNTrader",
    status: "completed",
    date: "2025-02-14",
    giving: [{ name: "Palkia VSTAR", tcg: "Pokemon", value: 9.75 }],

    receiving: [
      { name: "Gardevoir ex", tcg: "Pokemon", value: 6.25 },
      { name: "Eevee", tcg: "Pokemon", value: 0.75 },
      { name: "Boss's Orders", tcg: "Pokemon", value: 2.5 },
    ],
  },
];

export interface DeckCard {
  name: string;
  quantity: number;
  rarity: string;
  type: string;
}

export interface Deck {
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

export const DEMO_DECKS: Deck[] = [
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

export interface SealedProduct {
  id: string;
  name: string;
  tcg: string;
  type: string;
  purchasePrice: number;
  currentValue: number;
  quantity: number;
  purchaseDate: string;
  set: string;
}

export const DEMO_SEALED_PRODUCTS: SealedProduct[] = [
  {
    id: "s1",
    name: "Paldea Evolved Booster Box",
    tcg: "Pokemon",
    type: "Booster Box",
    purchasePrice: 105.0,
    currentValue: 128.0,
    quantity: 2,
    purchaseDate: "2024-08-15",
    set: "Paldea Evolved",
  },
  {
    id: "s2",
    name: "Modern Horizons 2 Draft Box",
    tcg: "Magic",
    type: "Draft Booster Box",
    purchasePrice: 240.0,
    currentValue: 310.0,
    quantity: 1,
    purchaseDate: "2024-03-20",
    set: "Modern Horizons 2",
  },
  {
    id: "s3",
    name: "25th Anniversary Tin",
    tcg: "Yu-Gi-Oh!",
    type: "Tin",
    purchasePrice: 29.99,
    currentValue: 45.0,
    quantity: 4,
    purchaseDate: "2024-06-10",
    set: "25th Anniversary",
  },
  {
    id: "s4",
    name: "Pokemon 151 ETB",
    tcg: "Pokemon",
    type: "Elite Trainer Box",
    purchasePrice: 49.99,
    currentValue: 72.0,
    quantity: 3,
    purchaseDate: "2024-01-05",
    set: "Pokemon 151",
  },
  {
    id: "s5",
    name: "Battles of Legend Chapter 1",
    tcg: "Yu-Gi-Oh!",
    type: "Booster Box",
    purchasePrice: 70.0,
    currentValue: 65.0,
    quantity: 1,
    purchaseDate: "2024-09-12",
    set: "Battles of Legend",
  },
  {
    id: "s6",
    name: "Commander Masters Collector Box",
    tcg: "Magic",
    type: "Collector Booster Box",
    purchasePrice: 290.0,
    currentValue: 255.0,
    quantity: 1,
    purchaseDate: "2024-11-01",
    set: "Commander Masters",
  },
  {
    id: "s7",
    name: "Obsidian Flames Booster Bundle",
    tcg: "Pokemon",
    type: "Booster Bundle",
    purchasePrice: 32.0,
    currentValue: 38.0,
    quantity: 5,
    purchaseDate: "2024-07-22",
    set: "Obsidian Flames",
  },
  {
    id: "s8",
    name: "Maze of Millennia Booster Box",
    tcg: "Yu-Gi-Oh!",
    type: "Booster Box",
    purchasePrice: 75.0,
    currentValue: 82.0,
    quantity: 2,
    purchaseDate: "2024-04-18",
    set: "Maze of Millennia",
  },
  {
    id: "s9",
    name: "Lord of the Rings Set Booster Box",
    tcg: "Magic",
    type: "Set Booster Box",
    purchasePrice: 170.0,
    currentValue: 215.0,
    quantity: 1,
    purchaseDate: "2024-02-14",
    set: "Tales of Middle-earth",
  },
  {
    id: "s10",
    name: "Scarlet & Violet ETB",
    tcg: "Pokemon",
    type: "Elite Trainer Box",
    purchasePrice: 42.0,
    currentValue: 55.0,
    quantity: 2,
    purchaseDate: "2024-05-30",
    set: "Scarlet & Violet",
  },
];
