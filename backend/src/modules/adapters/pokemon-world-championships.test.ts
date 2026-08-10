import {
  parsePokemonWorldChampionshipCatalog,
  searchPokemonWorldChampionshipCatalog,
  type TcgCsvWorldChampionshipProduct
} from './pokemon-world-championships';

const products: TcgCsvWorldChampionshipProduct[] = [
  {
    productId: 900,
    name: '2025 World Championship Deck: Yuya Okita (Dragapult Dominion)',
    extendedData: []
  },
  {
    productId: 901,
    name: 'Dragapult ex - 2025 (Yuya Okita)',
    imageUrl: 'https://example.test/901_200w.jpg',
    url: 'https://example.test/product/901',
    modifiedOn: '2025-09-01T00:00:00Z',
    extendedData: [
      { name: 'Number', value: '130/167' },
      { name: 'Rarity', value: 'Double Rare' },
      { name: 'Card Type', value: 'Psychic' },
      { name: 'HP', value: '320' },
      { name: 'Stage', value: 'Stage 2' }
    ]
  },
  {
    productId: 902,
    name: 'Dragapult ex - 2025 (Yuya Okita) [Gold Stamped]',
    imageUrl: 'https://example.test/902_200w.jpg',
    extendedData: []
  },
  {
    productId: 903,
    name: 'Code Card - 2025 World Championships digital bundle',
    extendedData: [{ name: 'Rarity', value: 'Code Card' }]
  },
  {
    productId: 904,
    name: 'Jet Energy - 2023 (Gabriel Fernandez)a',
    extendedData: [
      { name: 'Number', value: '190/193' },
      { name: 'Rarity', value: 'Uncommon' },
      { name: 'Card Type', value: 'Special Energy' }
    ]
  }
];

describe('Pokemon World Championship catalog', () => {
  it('models player deck cards as exact, non-sanctioned replica printings', () => {
    const catalog = parsePokemonWorldChampionshipCatalog(products);

    expect(catalog.cards).toHaveLength(3);
    expect(catalog.cards[0]).toMatchObject({
      id: 'wcd-901',
      printingKey: 'pokemon:wcd:2025:yuya-okita:901',
      printingKind: 'replica',
      sanctionedPlayLegal: false,
      setCode: 'wcd2025',
      imageUrl: 'https://example.test/901_in_1000x1000.jpg',
      pokemonPrint: {
        finishes: ['normal'],
        worldChampionship: {
          year: 2025,
          playerName: 'Yuya Okita',
          deckName: 'Dragapult Dominion',
          printedSignature: true,
          cardBack: 'world-championship'
        }
      }
    });
    expect(catalog.cards.find((card) => card.id === 'wcd-902')?.pokemonPrint
      ?.worldChampionship?.stamp).toBe('gold-stamped');
    expect(catalog.cards.find((card) => card.id === 'wcd-904')).toMatchObject({
      name: 'Jet Energy',
      supertype: 'Energy'
    });
    expect(catalog.sets).toEqual([
      expect.objectContaining({
        code: 'wcd2025',
        setType: 'memorabilia',
        releaseYear: 2025,
        totalCards: 2
      }),
      expect.objectContaining({
        code: 'wcd2023',
        totalCards: 1
      })
    ]);
  });

  it('searches card, player, deck, year, and Worlds aliases', () => {
    const catalog = parsePokemonWorldChampionshipCatalog(products);

    expect(searchPokemonWorldChampionshipCatalog(catalog, 'worlds 2025 yuya'))
      .toHaveLength(2);
    expect(searchPokemonWorldChampionshipCatalog(catalog, 'Dragapult Dominion'))
      .toHaveLength(2);
    expect(searchPokemonWorldChampionshipCatalog(catalog, 'gold stamped'))
      .toHaveLength(1);
  });
});
