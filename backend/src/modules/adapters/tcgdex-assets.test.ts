import { resolveTcgdexAssetUrl } from './tcgdex-assets';

describe('resolveTcgdexAssetUrl', () => {
  it('adds a WebP extension to TCGdex asset roots', () => {
    expect(resolveTcgdexAssetUrl('https://assets.tcgdex.net/univ/swsh/swsh3/symbol')).toBe(
      'https://assets.tcgdex.net/univ/swsh/swsh3/symbol.webp',
    );
  });

  it('preserves concrete and non-TCGdex image URLs', () => {
    expect(resolveTcgdexAssetUrl('https://assets.tcgdex.net/en/swsh/swsh3/logo.png')).toBe(
      'https://assets.tcgdex.net/en/swsh/swsh3/logo.png',
    );
    expect(resolveTcgdexAssetUrl('https://images.example/set-symbol')).toBe(
      'https://images.example/set-symbol',
    );
  });

  it('returns undefined for missing values', () => {
    expect(resolveTcgdexAssetUrl()).toBeUndefined();
    expect(resolveTcgdexAssetUrl('  ')).toBeUndefined();
  });
});
