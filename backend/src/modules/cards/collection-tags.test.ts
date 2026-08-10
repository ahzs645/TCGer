import { deriveCollectionTags } from '@tcg/api-types';

describe('collection tag derivation', () => {
  it('recognizes Pokémon art media and normalized delta reprints', () => {
    expect(deriveCollectionTags({
      tcg: 'pokemon',
      name: 'Ditto',
      artist: 'Yuka Morii',
      id: 'swshp-SWSH136',
    })).toEqual(expect.arrayContaining([
      'pokemon.art.clay',
      'pokemon.delta-species',
    ]));
  });

  it('keeps lowercase ex and uppercase EX as separate collections', () => {
    expect(deriveCollectionTags({ tcg: 'pokemon', name: 'Charizard ex', suffix: 'ex' }))
      .toContain('pokemon.ex');
    expect(deriveCollectionTags({ tcg: 'pokemon', name: 'Charizard-EX', suffix: 'EX' }))
      .toContain('pokemon.ex-uppercase');
  });

  it('recognizes provider-native special treatments across games', () => {
    expect(deriveCollectionTags({
      tcg: 'magic',
      name: 'Sol Ring',
      treatments: ['showcase', 'extendedart'],
    })).toEqual(expect.arrayContaining(['magic.showcase', 'magic.extended-art']));
    expect(deriveCollectionTags({
      tcg: 'yugioh',
      name: 'Dark Magician Girl',
      rarity: 'Quarter Century Secret Rare',
      setName: 'Lost Art Promotion 2025',
    })).toEqual(expect.arrayContaining([
      'yugioh.quarter-century-secret-rare',
      'yugioh.lost-art',
    ]));
    expect(deriveCollectionTags({
      tcg: 'lorcana',
      name: 'Elsa',
      rarity: 'Enchanted',
      classifications: ['Floodborn', 'Princess'],
    })).toEqual(expect.arrayContaining([
      'lorcana.enchanted',
      'lorcana.classification.floodborn',
      'lorcana.classification.princess',
    ]));
  });
});
