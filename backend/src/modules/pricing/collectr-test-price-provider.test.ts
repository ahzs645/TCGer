import { CollectrTestPriceProvider } from './collectr-test-price-provider';

describe('Collectr test price provider', () => {
  it('reads Collectr market_price without contacting the private service', async () => {
    const loader = jest.fn().mockResolvedValue({
      id: 'collectr-product-1',
      market_price: '42.75',
      currency: 'cad',
      external_ids: [{ external_id: 'sv04-214', product_sub_type: 'Normal', grade_id: 'ungraded' }],
    });
    const provider = new CollectrTestPriceProvider(loader);

    await expect(provider.fetchPrice('pokemon', 'sv04-214')).resolves.toEqual({
      currency: 'CAD',
      price: 42.75,
      foilPrice: undefined,
      etchedPrice: undefined,
      reverseHoloPrice: undefined,
    });
    expect(loader).toHaveBeenCalledWith('pokemon', 'sv04-214');
  });

  it.each([
    { data: { market_price: 8.5 } },
    { product: { market_price: '8.50' } },
    { data: { product_details: { market_price: '8.50' } } },
    { productDetails: { market_price: 8.5 } },
  ])('accepts captured response wrappers', async (payload) => {
    const provider = new CollectrTestPriceProvider(async () => payload);
    await expect(provider.fetchPrice('magic', 'card-id')).resolves.toMatchObject({
      currency: 'USD',
      price: 8.5,
    });
  });

  it('rejects missing, zero, and malformed market prices', async () => {
    for (const marketPrice of [undefined, null, 0, 'not-a-price']) {
      const provider = new CollectrTestPriceProvider(async () => ({
        market_price: marketPrice,
      }));
      await expect(provider.fetchPrice('lorcana', '1:42')).resolves.toBeNull();
    }
  });
});
