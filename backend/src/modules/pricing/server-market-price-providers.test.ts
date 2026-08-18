import { env } from '../../config/env';
import { getPriceSourceCatalog } from './price-source-catalog';
import { PokeWalletPriceProvider } from './server-market-price-providers';

function jsonResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: jest.fn().mockResolvedValue(body),
  } as unknown as Response;
}

describe('server market price providers', () => {
  const fetchMock = jest.spyOn(global, 'fetch');
  const originalPokeWalletKey = env.POKEWALLET_API_KEY;
  const originalPokeWalletProxy = env.POKEWALLET_PROXY_SECRET;
  const originalEbayClientId = env.EBAY_CLIENT_ID;
  const originalEbayClientSecret = env.EBAY_CLIENT_SECRET;

  beforeEach(() => {
    fetchMock.mockReset();
    env.POKEWALLET_API_KEY = 'test-key';
    env.POKEWALLET_PROXY_SECRET = undefined;
  });

  afterAll(() => {
    fetchMock.mockRestore();
    env.POKEWALLET_API_KEY = originalPokeWalletKey;
    env.POKEWALLET_PROXY_SECRET = originalPokeWalletProxy;
    env.EBAY_CLIENT_ID = originalEbayClientId;
    env.EBAY_CLIENT_SECRET = originalEbayClientSecret;
  });

  it('matches the exact set and number before choosing PokéWallet prices', async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({ data: { id: 'sv4', abbreviation: { official: 'PAR' } } }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          results: [
            {
              card_info: { set_code: 'other', card_number: '42' },
              cardmarket: { prices: [{ variant_type: 'normal', avg1: 999 }] },
            },
            {
              card_info: { set_code: 'PAR', card_number: '042' },
              cardmarket: {
                prices: [
                  { variant_type: 'holo', avg1: 12 },
                  { variant_type: 'normal', avg7: 4.5 },
                ],
              },
              tcgplayer: { prices: [{ mid_price: 6, market_price: 5 }] },
            },
          ],
        }),
      );

    await expect(
      new PokeWalletPriceProvider('cardmarket').fetchPrice('pokemon', 'sv4-42'),
    ).resolves.toMatchObject({ price: 4.5, currency: 'EUR' });
    expect(String(fetchMock.mock.calls[1][0])).toContain('q=PAR+42');
    const [, options] = fetchMock.mock.calls[1];
    expect(options).toEqual(
      expect.objectContaining({ headers: expect.objectContaining({ 'X-API-Key': 'test-key' }) }),
    );
  });

  it('advertises credentialed sources only after server configuration', () => {
    env.POKEWALLET_API_KEY = undefined;
    env.EBAY_CLIENT_ID = undefined;
    env.EBAY_CLIENT_SECRET = undefined;
    expect(getPriceSourceCatalog().sources.map((source) => source.id)).not.toContain(
      'pokewallet-blended',
    );
    expect(getPriceSourceCatalog().sources.map((source) => source.id)).not.toContain('ebay-active');

    env.POKEWALLET_API_KEY = 'configured';
    env.EBAY_CLIENT_ID = 'configured';
    env.EBAY_CLIENT_SECRET = 'configured';
    const configured = getPriceSourceCatalog().sources.map((source) => source.id);
    expect(configured).toContain('pokewallet-blended');
    expect(configured).toContain('ebay-active');
  });
});
