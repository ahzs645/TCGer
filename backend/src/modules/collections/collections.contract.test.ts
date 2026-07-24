import {
  addCardSchema,
  addWishlistCardSchema,
  cardDataPayloadSchema,
  createBinderSchema,
  pokemonFinishTypeSchema,
  updateBinderSchema,
  updateCardSchema
} from '@tcg/api-types';

describe('rich collection contracts', () => {
  it('preserves rich printing metadata and open-ended finish codes', () => {
    const cardData = cardDataPayloadSchema.parse({
      name: 'Pikachu',
      tcg: 'pokemon',
      externalId: 'svp-101',
      collectorNumber: '101',
      releasedAt: '2026-01-01',
      regulationMark: 'I',
      language: 'EN',
      supertype: 'Pokémon',
      formatLegality: { standard: true, expanded: true },
      dexEntries: [{ number: 25, name: 'Pikachu' }],
      region: 'International',
      pokemonPrint: {
        finishes: ['cosmos-holo', 'water-web-holo']
      },
      provenance: {
        source: 'pokemon-tcg-api',
        sourceId: 'svp-101'
      },
      legalityPeriods: [{
        format: 'Standard',
        rotation: '2026',
        validFrom: '2026-04-10',
        legal: true
      }],
      evolution: {
        evolvesFrom: 'Pichu',
        evolvesTo: ['Raichu']
      },
      functionalIdentity: {
        key: 'pokemon:example',
        normalizedRules: 'example'
      }
    });

    expect(cardData.pokemonPrint?.finishes).toEqual(['cosmos-holo', 'water-web-holo']);
    expect(pokemonFinishTypeSchema.parse('confetti-holo')).toBe('confetti-holo');
  });

  it('accepts collectible variant identity while retaining isFoil', () => {
    const input = addCardSchema.parse({
      cardId: 'card-1',
      isFoil: true,
      finishCode: 'cosmos-holo',
      finishLabel: 'Cosmos Holo',
      edition: 'First Edition',
      stamp: 'Prerelease',
      isSealedPromo: true,
      isOversized: false,
      isPeelOff: false,
      gradingCompany: 'PSA',
      gradingScore: '10',
      certNumber: '12345678',
      storageLocation: 'Display case'
    });

    expect(input.isFoil).toBe(true);
    expect(input.finishCode).toBe('cosmos-holo');
    expect(input.gradingCompany).toBe('PSA');
  });

  it('preserves rich metadata in wishlist card snapshots', () => {
    const input = addWishlistCardSchema.parse({
      externalId: 'svp-101',
      printingKey: 'pokemon:svp-101',
      tcg: 'pokemon',
      name: 'Pikachu',
      collectorNumber: '101',
      releasedAt: '2026-01-01',
      pokemonPrint: { finishes: ['cosmos-holo'] },
      provenance: { source: 'pokemon-tcg-api', sourceId: 'svp-101' },
      functionalIdentity: { key: 'pokemon:example' }
    });

    expect(input.printingKey).toBe('pokemon:svp-101');
    expect(input.pokemonPrint?.finishes).toEqual(['cosmos-holo']);
  });

  it.each(['onepiece', 'lorcana', 'dragonball'] as const)(
    'accepts %s across generic card, binder, and wishlist contracts',
    (tcg) => {
      expect(cardDataPayloadSchema.parse({
        name: 'Example Card',
        tcg,
        externalId: `${tcg}-card`
      }).tcg).toBe(tcg);
      expect(addWishlistCardSchema.parse({
        externalId: `${tcg}-card`,
        printingKey: `${tcg}:${tcg}-card`,
        tcg,
        name: 'Example Card'
      }).tcg).toBe(tcg);
      expect(createBinderSchema.parse({
        name: 'New Game Binder',
        associatedTcg: tcg
      }).associatedTcg).toBe(tcg);
    }
  );

  it('allows nullable string variant fields to be cleared on update', () => {
    expect(updateCardSchema.parse({
      finishCode: null,
      finishLabel: null,
      edition: null,
      stamp: null,
      gradingCompany: null,
      gradingScore: null,
      certNumber: null,
      storageLocation: null
    })).toMatchObject({
      finishCode: null,
      finishLabel: null,
      edition: null,
      stamp: null,
      gradingCompany: null,
      gradingScore: null,
      certNumber: null,
      storageLocation: null
    });
  });

  it('rejects unsupported games and blank identity keys', () => {
    expect(() => cardDataPayloadSchema.parse({
      name: 'Pikachu',
      tcg: 'other',
      externalId: 'card-1'
    })).toThrow();
    expect(() => addWishlistCardSchema.parse({
      externalId: 'card-1',
      printingKey: '   ',
      tcg: 'pokemon',
      name: 'Pikachu'
    })).toThrow();
  });

  it('validates container presentation and set-association metadata', () => {
    expect(createBinderSchema.parse({
      name: 'Legend of Blue Eyes',
      containerType: 'storage-box',
      imageUrl: 'https://example.com/box.jpg',
      associatedTcg: 'yugioh',
      associatedSetCode: 'LOB',
      associatedSetName: 'Legend of Blue Eyes White Dragon'
    })).toMatchObject({
      containerType: 'storage-box',
      associatedTcg: 'yugioh',
      associatedSetCode: 'LOB'
    });

    expect(updateBinderSchema.parse({
      imageUrl: null,
      associatedTcg: null,
      associatedSetCode: null,
      associatedSetName: null
    })).toMatchObject({
      imageUrl: null,
      associatedTcg: null
    });
  });
});
