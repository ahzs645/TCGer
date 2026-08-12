import {
  isSealedProductRow,
  parseCsv,
  sealedProductType,
} from './build-sealed-catalog-packs';

describe('sealed catalog pack builder', () => {
  it('parses quoted commas, quotes, and embedded newlines', () => {
    expect(
      parseCsv('productId,name,extCardText\r\n1,"Box, Special","Line 1\nLine ""2"""\r\n'),
    ).toEqual([
      {
        productId: '1',
        name: 'Box, Special',
        extCardText: 'Line 1\nLine "2"',
      },
    ]);
  });

  it('keeps sealed products while rejecting singles and accessories', () => {
    expect(isSealedProductRow({
      productId: '10',
      name: 'Journey Together Booster Box',
      extRarity: '',
      extNumber: '',
    })).toBe(true);
    expect(isSealedProductRow({
      productId: '11',
      name: 'Charizard ex',
      extRarity: 'Double Rare',
      extNumber: '125',
    })).toBe(false);
    expect(isSealedProductRow({
      productId: '12',
      name: 'Journey Together Deck Box',
      extRarity: '',
      extNumber: '',
    })).toBe(false);
    expect(isSealedProductRow({
      productId: '13',
      name: 'First Partner Collection',
      extUPC: '0196214150522',
      extRarity: '',
      extNumber: '',
    })).toBe(true);
  });

  it('assigns useful product types', () => {
    expect(sealedProductType('Paldean Fates Elite Trainer Box')).toBe('etb');
    expect(sealedProductType('Modern Horizons 3 Draft Booster Box')).toBe('box');
    expect(sealedProductType('Starter Deck: Kaiba')).toBe('deck');
    expect(sealedProductType('The First Chapter Booster Pack')).toBe('booster');
  });
});
