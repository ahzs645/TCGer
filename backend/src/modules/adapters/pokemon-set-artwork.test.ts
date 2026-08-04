import { resolvePokemonSetArtwork } from './pokemon-set-artwork';

describe('resolvePokemonSetArtwork', () => {
  const symbol = 'https://assets.tcgdex.net/univ/swsh/swsh3/symbol';
  const logo = 'https://assets.tcgdex.net/en/swsh/swsh3/logo';

  it('uses an approved vector first and keeps the TCGdex WebP symbol as fallback', () => {
    expect(
      resolvePokemonSetArtwork('swsh3', symbol, logo, {
        swsh3: 'https://assets.example/pokemon/swsh3.svg',
      }),
    ).toEqual({
      iconUrl: 'https://assets.example/pokemon/swsh3.svg',
      iconFallbackUrl: 'https://assets.tcgdex.net/univ/swsh/swsh3/symbol.webp',
      logoUrl: 'https://assets.tcgdex.net/en/swsh/swsh3/logo.webp',
    });
  });

  it('continues using WebP directly when no approved vector exists', () => {
    expect(resolvePokemonSetArtwork('sv09', symbol, logo)).toEqual({
      iconUrl: 'https://assets.tcgdex.net/univ/swsh/swsh3/symbol.webp',
      iconFallbackUrl: undefined,
      logoUrl: 'https://assets.tcgdex.net/en/swsh/swsh3/logo.webp',
    });
  });

  it('uses the generated, content-hashed vector map for covered sets', () => {
    const artwork = resolvePokemonSetArtwork('swsh3', symbol, logo);

    expect(artwork.iconUrl).toMatch(
      /^https:\/\/assets\.tcger\.ahmadjalil\.com\/catalogs\/pokemon-set-symbols\/swsh3\.[a-f0-9]{16}\.svg$/,
    );
    expect(artwork.iconFallbackUrl).toBe('https://assets.tcgdex.net/univ/swsh/swsh3/symbol.webp');
  });

  it('does not store a duplicate raster when the provider has no symbol', () => {
    const artwork = resolvePokemonSetArtwork('bog', undefined, logo);

    expect(artwork.iconUrl).toMatch(/\/bog\.[a-f0-9]{16}\.svg$/);
    expect(artwork.iconFallbackUrl).toBeUndefined();
  });
});
