jest.mock('./live-pricing.service', () => ({
  resolveCollectionMarketPrice: jest.fn(),
}));

import { resolveCollectionMarketPrice } from './live-pricing.service';
import { enrichCollectionCardPrice } from './collection-price-enrichment';

const resolvePriceMock = resolveCollectionMarketPrice as jest.MockedFunction<
  typeof resolveCollectionMarketPrice
>;

describe('collection price enrichment', () => {
  beforeEach(() => resolvePriceMock.mockReset());

  it('keeps a manually supplied price and skips the provider', async () => {
    const input = { price: 5, cardData: { tcg: 'magic', externalId: 'card-id' } };
    await expect(enrichCollectionCardPrice(input)).resolves.toBe(input);
    expect(resolvePriceMock).not.toHaveBeenCalled();
  });

  it('fills a missing price from the selected market quote', async () => {
    resolvePriceMock.mockResolvedValueOnce(7.25);
    const input = {
      finishCode: 'foil',
      cardData: { tcg: 'magic', externalId: 'card-id' },
    };
    await expect(enrichCollectionCardPrice(input)).resolves.toEqual({ ...input, price: 7.25 });
  });

  it('leaves the input unchanged when no market quote is available', async () => {
    resolvePriceMock.mockResolvedValueOnce(undefined);
    const input = { cardData: { tcg: 'magic', externalId: 'missing' } };
    await expect(enrichCollectionCardPrice(input)).resolves.toBe(input);
  });
});
