/**
 * Fake card database for the demo mode.
 * ~60 cards across Yu-Gi-Oh!, Magic: The Gathering, and Pokemon.
 * Used by the demo store for card search and adding to collections/wishlists.
 */

export type DemoTcg = 'yugioh' | 'magic' | 'pokemon';

export interface DemoCard {
  id: string;
  tcg: DemoTcg;
  name: string;
  setCode: string;
  setName: string;
  rarity: string;
  price: number;
}

export const DEMO_CARDS: DemoCard[] = [
  // ── Yu-Gi-Oh! ──────────────────────────────────────────────────────
  { id: 'ygo-001', tcg: 'yugioh', name: 'Blue-Eyes White Dragon', setCode: 'SDK-001', setName: 'Starter Deck: Kaiba', rarity: 'Ultra Rare', price: 24.99 },
  { id: 'ygo-002', tcg: 'yugioh', name: 'Dark Magician', setCode: 'SDY-006', setName: 'Starter Deck: Yugi', rarity: 'Ultra Rare', price: 12.50 },
  { id: 'ygo-003', tcg: 'yugioh', name: 'Red-Eyes Black Dragon', setCode: 'LOB-070', setName: 'Legend of Blue Eyes White Dragon', rarity: 'Ultra Rare', price: 8.75 },
  { id: 'ygo-004', tcg: 'yugioh', name: 'Exodia the Forbidden One', setCode: 'LOB-124', setName: 'Legend of Blue Eyes White Dragon', rarity: 'Ultra Rare', price: 38.00 },
  { id: 'ygo-005', tcg: 'yugioh', name: 'Monster Reborn', setCode: 'LOB-118', setName: 'Legend of Blue Eyes White Dragon', rarity: 'Ultra Rare', price: 5.00 },
  { id: 'ygo-006', tcg: 'yugioh', name: 'Pot of Greed', setCode: 'LOB-119', setName: 'Legend of Blue Eyes White Dragon', rarity: 'Rare', price: 3.20 },
  { id: 'ygo-007', tcg: 'yugioh', name: 'Ash Blossom & Joyous Spring', setCode: 'DUDE-EN003', setName: 'Duel Devastator', rarity: 'Ultra Rare', price: 5.50 },
  { id: 'ygo-008', tcg: 'yugioh', name: 'Nibiru, the Primal Being', setCode: 'TN19-EN013', setName: 'Tin of the Pharaoh\'s Gods', rarity: 'Prismatic Secret Rare', price: 8.95 },
  { id: 'ygo-009', tcg: 'yugioh', name: 'Infinite Impermanence', setCode: 'FLOD-EN077', setName: 'Flames of Destruction', rarity: 'Secret Rare', price: 14.25 },
  { id: 'ygo-010', tcg: 'yugioh', name: 'Called by the Grave', setCode: 'FLOD-EN065', setName: 'Flames of Destruction', rarity: 'Common', price: 1.50 },
  { id: 'ygo-011', tcg: 'yugioh', name: 'Effect Veiler', setCode: 'DREV-EN002', setName: 'Duelist Revolution', rarity: 'Ultra Rare', price: 3.80 },
  { id: 'ygo-012', tcg: 'yugioh', name: 'Pot of Prosperity', setCode: 'BLVO-EN065', setName: 'Blazing Vortex', rarity: 'Secret Rare', price: 22.50 },
  { id: 'ygo-013', tcg: 'yugioh', name: 'Accesscode Talker', setCode: 'ETCO-EN046', setName: 'Eternity Code', rarity: 'Ultra Rare', price: 18.00 },
  { id: 'ygo-014', tcg: 'yugioh', name: 'Ghost Ogre & Snow Rabbit', setCode: 'CROS-EN033', setName: 'Crossed Souls', rarity: 'Secret Rare', price: 4.50 },
  { id: 'ygo-015', tcg: 'yugioh', name: 'Maxx "C"', setCode: 'CT09-EN012', setName: 'Tin Wave 2', rarity: 'Super Rare', price: 11.75 },
  { id: 'ygo-016', tcg: 'yugioh', name: 'Raigeki', setCode: 'LOB-053', setName: 'Legend of Blue Eyes White Dragon', rarity: 'Ultra Rare', price: 6.25 },
  { id: 'ygo-017', tcg: 'yugioh', name: 'Mirror Force', setCode: 'MRD-138', setName: 'Metal Raiders', rarity: 'Ultra Rare', price: 4.00 },
  { id: 'ygo-018', tcg: 'yugioh', name: 'Mystical Space Typhoon', setCode: 'MRL-047', setName: 'Magic Ruler', rarity: 'Ultra Rare', price: 2.25 },
  { id: 'ygo-019', tcg: 'yugioh', name: 'Solemn Judgment', setCode: 'LOB-017', setName: 'Legend of Blue Eyes White Dragon', rarity: 'Ultra Rare', price: 5.75 },
  { id: 'ygo-020', tcg: 'yugioh', name: 'Stardust Dragon', setCode: 'TDGS-EN040', setName: 'The Duelist Genesis', rarity: 'Ultra Rare', price: 9.50 },

  // ── Magic: The Gathering ───────────────────────────────────────────
  { id: 'mtg-001', tcg: 'magic', name: 'Lightning Bolt', setCode: 'STA-042', setName: 'Strixhaven Mystical Archive', rarity: 'Uncommon', price: 1.50 },
  { id: 'mtg-002', tcg: 'magic', name: 'Counterspell', setCode: 'STA-016', setName: 'Strixhaven Mystical Archive', rarity: 'Uncommon', price: 2.25 },
  { id: 'mtg-003', tcg: 'magic', name: 'Swords to Plowshares', setCode: 'STA-010', setName: 'Strixhaven Mystical Archive', rarity: 'Uncommon', price: 3.00 },
  { id: 'mtg-004', tcg: 'magic', name: 'Ragavan, Nimble Pilferer', setCode: 'MH2-138', setName: 'Modern Horizons 2', rarity: 'Mythic Rare', price: 68.40 },
  { id: 'mtg-005', tcg: 'magic', name: 'Wrenn and Six', setCode: 'MH1-217', setName: 'Modern Horizons', rarity: 'Mythic Rare', price: 55.00 },
  { id: 'mtg-006', tcg: 'magic', name: 'Force of Negation', setCode: 'MH1-052', setName: 'Modern Horizons', rarity: 'Rare', price: 42.50 },
  { id: 'mtg-007', tcg: 'magic', name: 'Prismatic Vista', setCode: 'MH1-244', setName: 'Modern Horizons', rarity: 'Rare', price: 28.75 },
  { id: 'mtg-008', tcg: 'magic', name: 'Urza\'s Saga', setCode: 'MH2-259', setName: 'Modern Horizons 2', rarity: 'Rare', price: 35.00 },
  { id: 'mtg-009', tcg: 'magic', name: 'Teferi, Hero of Dominaria', setCode: 'DOM-207', setName: 'Dominaria', rarity: 'Mythic Rare', price: 16.75 },
  { id: 'mtg-010', tcg: 'magic', name: 'Murktide Regent', setCode: 'MH2-052', setName: 'Modern Horizons 2', rarity: 'Mythic Rare', price: 18.50 },
  { id: 'mtg-011', tcg: 'magic', name: 'Solitude', setCode: 'MH2-032', setName: 'Modern Horizons 2', rarity: 'Mythic Rare', price: 32.00 },
  { id: 'mtg-012', tcg: 'magic', name: 'Fury', setCode: 'MH2-126', setName: 'Modern Horizons 2', rarity: 'Mythic Rare', price: 12.00 },
  { id: 'mtg-013', tcg: 'magic', name: 'Endurance', setCode: 'MH2-157', setName: 'Modern Horizons 2', rarity: 'Mythic Rare', price: 26.00 },
  { id: 'mtg-014', tcg: 'magic', name: 'Fatal Push', setCode: 'AER-057', setName: 'Aether Revolt', rarity: 'Uncommon', price: 3.50 },
  { id: 'mtg-015', tcg: 'magic', name: 'Thoughtseize', setCode: 'THS-107', setName: 'Theros', rarity: 'Rare', price: 14.00 },
  { id: 'mtg-016', tcg: 'magic', name: 'Path to Exile', setCode: 'CON-015', setName: 'Conflux', rarity: 'Uncommon', price: 4.25 },
  { id: 'mtg-017', tcg: 'magic', name: 'Aether Vial', setCode: 'DST-091', setName: 'Darksteel', rarity: 'Uncommon', price: 22.00 },
  { id: 'mtg-018', tcg: 'magic', name: 'Mishra\'s Bauble', setCode: 'IMA-219', setName: 'Iconic Masters', rarity: 'Uncommon', price: 1.75 },
  { id: 'mtg-019', tcg: 'magic', name: 'Chalice of the Void', setCode: 'MMA-203', setName: 'Modern Masters', rarity: 'Rare', price: 45.00 },
  { id: 'mtg-020', tcg: 'magic', name: 'Grief', setCode: 'MH2-087', setName: 'Modern Horizons 2', rarity: 'Mythic Rare', price: 8.50 },

  // ── Pokemon ────────────────────────────────────────────────────────
  { id: 'pkm-001', tcg: 'pokemon', name: 'Charizard ex', setCode: 'PAL-199', setName: 'Paldea Evolved', rarity: 'Special Art Rare', price: 85.00 },
  { id: 'pkm-002', tcg: 'pokemon', name: 'Pikachu VMAX', setCode: 'VIV-044', setName: 'Vivid Voltage', rarity: 'VMAX', price: 24.50 },
  { id: 'pkm-003', tcg: 'pokemon', name: 'Mew ex', setCode: 'MEW-151', setName: 'Pokemon 151', rarity: 'Double Rare', price: 18.75 },
  { id: 'pkm-004', tcg: 'pokemon', name: 'Mewtwo VSTAR', setCode: 'PGO-031', setName: 'Pokemon GO', rarity: 'VSTAR', price: 7.50 },
  { id: 'pkm-005', tcg: 'pokemon', name: 'Iono', setCode: 'PAL-185', setName: 'Paldea Evolved', rarity: 'Special Art Rare', price: 32.00 },
  { id: 'pkm-006', tcg: 'pokemon', name: 'Gardevoir ex', setCode: 'SVI-086', setName: 'Scarlet & Violet', rarity: 'Double Rare', price: 6.25 },
  { id: 'pkm-007', tcg: 'pokemon', name: 'Miraidon ex', setCode: 'SVI-081', setName: 'Scarlet & Violet', rarity: 'Double Rare', price: 8.00 },
  { id: 'pkm-008', tcg: 'pokemon', name: 'Koraidon ex', setCode: 'SVI-124', setName: 'Scarlet & Violet', rarity: 'Double Rare', price: 5.50 },
  { id: 'pkm-009', tcg: 'pokemon', name: 'Umbreon ex', setCode: 'OBF-130', setName: 'Obsidian Flames', rarity: 'Special Art Rare', price: 42.00 },
  { id: 'pkm-010', tcg: 'pokemon', name: 'Arcanine ex', setCode: 'OBF-032', setName: 'Obsidian Flames', rarity: 'Double Rare', price: 4.75 },
  { id: 'pkm-011', tcg: 'pokemon', name: 'Boss\'s Orders', setCode: 'PAL-172', setName: 'Paldea Evolved', rarity: 'Rare', price: 2.50 },
  { id: 'pkm-012', tcg: 'pokemon', name: 'Charizard VSTAR', setCode: 'SWSH12-030', setName: 'Silver Tempest', rarity: 'Ultra Rare', price: 8.95 },
  { id: 'pkm-013', tcg: 'pokemon', name: 'Pikachu', setCode: 'XY7-054', setName: 'Ancient Origins', rarity: 'Common', price: 2.50 },
  { id: 'pkm-014', tcg: 'pokemon', name: 'Shining Mew', setCode: 'SM35-032', setName: 'Shining Legends', rarity: 'Shining', price: 75.00 },
  { id: 'pkm-015', tcg: 'pokemon', name: 'Eevee', setCode: 'SVI-133', setName: 'Scarlet & Violet', rarity: 'Common', price: 0.75 },
  { id: 'pkm-016', tcg: 'pokemon', name: 'Gengar VMAX', setCode: 'FST-157', setName: 'Fusion Strike', rarity: 'VMAX', price: 15.25 },
  { id: 'pkm-017', tcg: 'pokemon', name: 'Rayquaza VMAX', setCode: 'EVS-218', setName: 'Evolving Skies', rarity: 'Alt Art VMAX', price: 195.00 },
  { id: 'pkm-018', tcg: 'pokemon', name: 'Lugia VSTAR', setCode: 'SIT-139', setName: 'Silver Tempest', rarity: 'VSTAR', price: 22.00 },
  { id: 'pkm-019', tcg: 'pokemon', name: 'Giratina VSTAR', setCode: 'LOR-131', setName: 'Lost Origin', rarity: 'VSTAR', price: 16.50 },
  { id: 'pkm-020', tcg: 'pokemon', name: 'Palkia VSTAR', setCode: 'ASR-040', setName: 'Astral Radiance', rarity: 'VSTAR', price: 9.75 }
];

const GAME_LABELS: Record<DemoTcg, string> = {
  yugioh: 'Yu-Gi-Oh!',
  magic: 'Magic: The Gathering',
  pokemon: 'Pok\u00e9mon'
};

export function getGameLabel(tcg: DemoTcg): string {
  return GAME_LABELS[tcg];
}

export function searchDemoCards(query: string, tcg?: DemoTcg | 'all'): DemoCard[] {
  const term = query.toLowerCase().trim();
  if (!term) return [];

  return DEMO_CARDS.filter((card) => {
    if (tcg && tcg !== 'all' && card.tcg !== tcg) return false;
    return (
      card.name.toLowerCase().includes(term) ||
      card.setCode.toLowerCase().includes(term) ||
      card.setName.toLowerCase().includes(term) ||
      card.rarity.toLowerCase().includes(term)
    );
  });
}
