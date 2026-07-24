import {
  canonicalizePokemonRarity,
  normalizePokemonEffectText,
  normalizePokemonEnergy,
  normalizePokemonName,
  normalizePokemonTypography
} from './pokemon-normalization';

describe('pokemon normalization', () => {
  it('normalizes source typography deterministically', () => {
    expect(normalizePokemonTypography('Pokémon\u00a0— “Power”… ×2')).toBe(
      'Pokémon - "Power"... x2'
    );
  });

  it('normalizes names without losing word boundaries', () => {
    expect(normalizePokemonName('  Flabébé  ex ')).toBe('flabebe ex');
  });

  it('accepts bracketed and braced energy symbols', () => {
    expect(normalizePokemonEnergy('{G}')).toBe('grass');
    expect(normalizePokemonEnergy('[L]')).toBe('lightning');
    expect(normalizePokemonEnergy('Colorless')).toBe('colorless');
  });

  it('normalizes effect text and expands energy tokens', () => {
    expect(normalizePokemonEffectText('Attach 1 [G] Energy to your Pokémon.')).toBe(
      'attach 1 grass energy to your pokemon'
    );
  });

  it('canonicalizes ambiguous upstream rarity labels using the card name', () => {
    expect(canonicalizePokemonRarity('Rainbow Rare', 'Pikachu VMAX')).toBe(
      'Secret Rare'
    );
    expect(canonicalizePokemonRarity('Shiny Rare V or VMAX', 'Pikachu VMAX')).toBe(
      'Shiny Rare VMAX'
    );
    expect(
      canonicalizePokemonRarity(
        'Trainer Gallery Holo Rare V or VMAX',
        'Mewtwo VSTAR'
      )
    ).toBe('Trainer Gallery Holo Rare VSTAR');
    expect(
      canonicalizePokemonRarity('None', 'Promo', { noneMeansPromo: true })
    ).toBe('Promo');
  });
});
