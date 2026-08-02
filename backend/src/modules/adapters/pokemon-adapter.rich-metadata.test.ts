import type { CardDTO } from './types';
import { PokemonAdapter } from './pokemon-adapter';

describe('PokemonAdapter rich TCGdex mapping', () => {
  it('preserves print finishes and builds provider-stable attack costs', () => {
    const adapter = new PokemonAdapter();
    const internals = adapter as unknown as {
      mapTCGdexDetailCard(card: Record<string, unknown>): CardDTO;
      buildFunctionalSignature(card: Record<string, unknown>): {
        key: string;
      };
    };
    const detail = {
      id: 'sv01-25',
      localId: '25',
      name: 'Pikachu',
      hp: 70,
      category: 'Pokemon',
      stage: 'Basic',
      language: 'en',
      regulationMark: 'G',
      set: {
        id: 'sv01',
        name: 'Scarlet & Violet',
        symbol: 'https://assets.tcgdex.net/univ/sv/sv01/symbol',
        logo: 'https://assets.tcgdex.net/en/sv/sv01/logo'
      },
      variants: {
        normal: true,
        holo: true
      },
      attacks: [{
        name: 'Electro Ball',
        cost: ['Lightning', 'Colorless'],
        damage: 30
      }]
    };

    const mapped = internals.mapTCGdexDetailCard(detail);
    const expectedIdentity = internals.buildFunctionalSignature({
      id: detail.id,
      name: detail.name,
      hp: String(detail.hp),
      supertype: detail.category,
      subtypes: [detail.stage],
      regulationMark: detail.regulationMark,
      attacks: [{
        name: 'Electro Ball',
        cost: ['Lightning', 'Colorless'],
        damage: '30',
        convertedEnergyCost: 2
      }]
    });

    expect(mapped.language).toBe('en');
    expect(mapped.pokemonPrint?.finishes).toEqual(['normal', 'holo']);
    expect(mapped.baseExternalId).toBe(expectedIdentity.key);
    expect(mapped.setSymbolUrl).toBe(
      'https://assets.tcgdex.net/univ/sv/sv01/symbol.webp'
    );
    expect(mapped.setLogoUrl).toBe(
      'https://assets.tcgdex.net/en/sv/sv01/logo.webp'
    );
  });
});
