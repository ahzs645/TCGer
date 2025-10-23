import type { CollectionCard } from '@/types/card';

export interface SampleCollection {
  id: string;
  name: string;
  description: string;
  updatedAt: string;
  cards: CollectionCard[];
}

export const SAMPLE_COLLECTIONS: SampleCollection[] = [
  {
    id: 'binder-anchor',
    name: 'Binder Alpha',
    description: 'Flagship deck staples, graded highlights, and tournament-ready foils.',
    updatedAt: '2024-10-12T09:00:00Z',
    cards: [
      {
        id: '46986414',
        tcg: 'yugioh',
        name: 'Dark Magician',
        setCode: 'SDY-006',
        setName: 'Starter Deck: Yugi',
        rarity: 'Ultra Rare',
        imageUrl: 'https://images.ygoprodeck.com/images/cards/46986414.jpg',
        imageUrlSmall: 'https://images.ygoprodeck.com/images/cards_small/46986414.jpg',
        setSymbolUrl: 'https://ygoprodeck.com/pics/icons/sets/SDY-EN.png',
        attributes: {
          type: 'Monster / Spellcaster',
          attribute: 'DARK',
          level: 7,
          atk: 2500,
          def: 2100
        },
        quantity: 2,
        condition: 'Near Mint',
        notes: 'First print, double-sleeved',
        price: 89.99,
        acquisitionPrice: 55,
        priceHistory: [65, 72, 78, 82, 86, 89.99]
      },
      {
        id: '9f292732-5b25-41bd-8c4c-5dd744b501f5',
        tcg: 'magic',
        name: 'Black Lotus',
        setCode: 'lea',
        setName: 'Limited Edition Alpha',
        rarity: 'Rare',
        imageUrl: 'https://c1.scryfall.com/file/scryfall-cards/large/front/9/f/9f292732-5b25-41bd-8c4c-5dd744b501f5.jpg',
        imageUrlSmall: 'https://c1.scryfall.com/file/scryfall-cards/small/front/9/f/9f292732-5b25-41bd-8c4c-5dd744b501f5.jpg',
        setSymbolUrl: 'https://svgs.scryfall.io/sets/lea.svg',
        attributes: {
          mana_cost: '{0}',
          type_line: 'Artifact',
          oracle_text: '{T}, Sacrifice Black Lotus: Add three mana of any one color.'
        },
        quantity: 1,
        condition: 'Lightly Played',
        notes: 'Authenticated, stored in vault',
        price: 275000,
        acquisitionPrice: 210000,
        priceHistory: [180000, 195000, 220000, 245000, 260000, 275000]
      },
      {
        id: 'b3f3fa19-2a94-4f75-b58d-f7f8e98ae035',
        tcg: 'magic',
        name: 'Teferi, Hero of Dominaria',
        setCode: 'dom',
        setName: 'Dominaria',
        rarity: 'Mythic',
        imageUrl: 'https://cards.scryfall.io/large/front/b/3/b3f3fa19-2a94-4f75-b58d-f7f8e98ae035.jpg',
        imageUrlSmall: 'https://cards.scryfall.io/small/front/b/3/b3f3fa19-2a94-4f75-b58d-f7f8e98ae035.jpg',
        setSymbolUrl: 'https://svgs.scryfall.io/sets/dom.svg',
        attributes: {
          mana_cost: '{3}{W}{U}',
          type_line: 'Legendary Planeswalker — Teferi',
          oracle_text:
            '+1: Draw a card. At the beginning of the next end step, untap two lands.\n-3: Put target nonland permanent into its owner\'s library third from the top.\n-8: You get an emblem with "Whenever you draw a card, exile target permanent an opponent controls."'
        },
        quantity: 4,
        condition: 'Near Mint',
        notes: 'Commander deck staple',
        price: 16.75,
        acquisitionPrice: 9.5,
        priceHistory: [10, 11.5, 13, 14.2, 15.6, 16.75]
      }
    ]
  },
  {
    id: 'binder-modern-picks',
    name: 'Modern Staples',
    description: 'Competitive MTG and Yu-Gi-Oh! staples currently in rotation.',
    updatedAt: '2024-09-28T13:30:00Z',
    cards: [
      {
        id: '74677422',
        tcg: 'yugioh',
        name: 'Blue-Eyes White Dragon',
        setCode: 'SDK-001',
        setName: 'Starter Deck: Kaiba',
        rarity: 'Ultra Rare',
        imageUrl: 'https://images.ygoprodeck.com/images/cards/74677422.jpg',
        imageUrlSmall: 'https://images.ygoprodeck.com/images/cards_small/74677422.jpg',
        setSymbolUrl: 'https://ygoprodeck.com/pics/icons/sets/SDK-EN.png',
        attributes: {
          type: 'Monster / Dragon',
          attribute: 'LIGHT',
          level: 8,
          atk: 3000,
          def: 2500
        },
        quantity: 3,
        condition: 'Played',
        notes: 'First edition, some edge wear',
        price: 120,
        acquisitionPrice: 75,
        priceHistory: [80, 90, 95, 100, 110, 120]
      },
      {
        id: 'f9bdbf62-8afd-4f44-a76b-42fa868b137c',
        tcg: 'magic',
        name: 'Ragavan, Nimble Pilferer',
        setCode: 'mh2',
        setName: 'Modern Horizons 2',
        rarity: 'Mythic',
        imageUrl: 'https://cards.scryfall.io/large/front/f/9/f9bdbf62-8afd-4f44-a76b-42fa868b137c.jpg',
        imageUrlSmall: 'https://cards.scryfall.io/small/front/f/9/f9bdbf62-8afd-4f44-a76b-42fa868b137c.jpg',
        setSymbolUrl: 'https://svgs.scryfall.io/sets/mh2.svg',
        attributes: {
          mana_cost: '{R}',
          type_line: 'Legendary Creature — Monkey Pirate',
          oracle_text:
            'Whenever Ragavan, Nimble Pilferer deals combat damage to a player, create a Treasure token and exile the top card of that player\'s library. Until end of turn, you may cast that card.'
        },
        quantity: 2,
        condition: 'Near Mint',
        notes: 'Sleeved since opening',
        price: 68.4,
        acquisitionPrice: 45.0,
        priceHistory: [40, 51, 59, 63, 66, 68.4]
      },
      {
        id: '14648',
        tcg: 'yugioh',
        name: 'Ash Blossom & Joyous Spring',
        setCode: 'DUDE-EN043',
        setName: 'Duel Devastator',
        rarity: 'Ultra Rare',
        imageUrl: 'https://images.ygoprodeck.com/images/cards/14558127.jpg',
        imageUrlSmall: 'https://images.ygoprodeck.com/images/cards_small/14558127.jpg',
        setSymbolUrl: 'https://ygoprodeck.com/pics/icons/sets/DUDE-EN.png',
        attributes: {
          type: 'Monster / Zombie / Tuner',
          attribute: 'FIRE',
          level: 3,
          atk: 0,
          def: 1800
        },
        quantity: 3,
        condition: 'Near Mint',
        notes: 'Main deck hand trap',
        price: 5.5,
        acquisitionPrice: 4.1,
        priceHistory: [4.1, 4.3, 4.7, 5.0, 5.2, 5.5]
      }
    ]
  },
  {
    id: 'binder-pocket-monsters',
    name: 'Pokémon Showcase',
    description: 'Crown jewels of the Pikachu and Eeveelution lines with vintage promos.',
    updatedAt: '2024-08-19T18:45:00Z',
    cards: [
      {
        id: 'xy7-54',
        tcg: 'pokemon',
        name: 'Pikachu',
        setCode: 'xy7',
        setName: 'Ancient Origins',
        rarity: 'Common',
        imageUrl: 'https://images.pokemontcg.io/xy7/54_hires.png',
        imageUrlSmall: 'https://images.pokemontcg.io/xy7/54.png',
        setSymbolUrl: 'https://images.pokemontcg.io/xy7/symbol.png',
        attributes: {
          hp: 60,
          types: ['Lightning'],
          attacks: ['Gnaw', 'Agility']
        },
        quantity: 12,
        condition: 'Mint',
        notes: 'Pulled from booster box',
        price: 2.5,
        acquisitionPrice: 1.25,
        priceHistory: [1.25, 1.3, 1.6, 2.0, 2.3, 2.5]
      },
      {
        id: 'sm35-32',
        tcg: 'pokemon',
        name: 'Shining Mew',
        setCode: 'sm35',
        setName: 'Shining Legends',
        rarity: 'Shining',
        imageUrl: 'https://images.pokemontcg.io/sm35/SM35_EN_32.png',
        imageUrlSmall: 'https://images.pokemontcg.io/sm35/32.png',
        setSymbolUrl: 'https://images.pokemontcg.io/sm35/symbol.png',
        attributes: {
          hp: 30,
          types: ['Psychic'],
          attacks: ['Legendary Guidance', 'Beam']
        },
        quantity: 1,
        condition: 'Mint',
        notes: 'PSA 9 graded',
        price: 75,
        acquisitionPrice: 48,
        priceHistory: [50, 55, 60, 63, 70, 75]
      },
      {
        id: 'swsh12-30',
        tcg: 'pokemon',
        name: 'Charizard VSTAR',
        setCode: 'swsh12',
        setName: 'Silver Tempest',
        rarity: 'Ultra Rare',
        imageUrl: 'https://images.pokemontcg.io/swsh12/30_hires.png',
        imageUrlSmall: 'https://images.pokemontcg.io/swsh12/30.png',
        setSymbolUrl: 'https://images.pokemontcg.io/swsh12/symbol.png',
        attributes: {
          hp: 280,
          types: ['Fire'],
          attacks: ['Explosive Fire', 'Star Blaze']
        },
        quantity: 4,
        condition: 'Near Mint',
        notes: 'Trade binder duplicates',
        price: 8.95,
        acquisitionPrice: 6.5,
        priceHistory: [6.5, 6.7, 7.3, 7.9, 8.2, 8.95]
      }
    ]
  }
];
