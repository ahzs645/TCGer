import { isUsablePrice, normalizePriceQuote, selectPriceForFinish } from './pricing.service';

describe('finish-aware pricing rules', () => {
  it('rejects zero, negative, NaN, and infinite prices', () => {
    expect(isUsablePrice(0)).toBe(false);
    expect(isUsablePrice(-1)).toBe(false);
    expect(isUsablePrice(Number.NaN)).toBe(false);
    expect(isUsablePrice(Number.POSITIVE_INFINITY)).toBe(false);
    expect(isUsablePrice(1.25)).toBe(true);
  });

  it('keeps valid quote fields when an upstream field is invalid', () => {
    expect(
      normalizePriceQuote({
        currency: 'usd',
        price: Number.NaN,
        foilPrice: 4.5,
        reverseHoloPrice: 0,
      }),
    ).toEqual({
      currency: 'USD',
      price: undefined,
      foilPrice: 4.5,
      reverseHoloPrice: undefined,
    });
  });

  it('selects the requested finish and falls back safely', () => {
    const quote = {
      currency: 'USD',
      price: 2,
      foilPrice: 5,
    };
    expect(selectPriceForFinish(quote, 'reverse-holo')).toBe(5);
    expect(selectPriceForFinish(quote, 'etched-foil')).toBe(5);
    expect(selectPriceForFinish(quote, 'normal')).toBe(2);
  });
});
