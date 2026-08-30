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
  const originalFxRate = env.PRICE_USD_TO_EUR;
  const originalFxSource = env.PRICE_FX_SOURCE;
  const originalFxAsOf = env.PRICE_FX_AS_OF;

  beforeEach(() => {
    fetchMock.mockReset();
    env.POKEWALLET_API_KEY = 'test-key';
    env.POKEWALLET_PROXY_SECRET = undefined;
    env.PRICE_USD_TO_EUR = undefined;
    env.PRICE_FX_SOURCE = undefined;
    env.PRICE_FX_AS_OF = undefined;
  });

  afterAll(() => {
    fetchMock.mockRestore();
    env.POKEWALLET_API_KEY = originalPokeWalletKey;
    env.POKEWALLET_PROXY_SECRET = originalPokeWalletProxy;
    env.EBAY_CLIENT_ID = originalEbayClientId;
    env.EBAY_CLIENT_SECRET = originalEbayClientSecret;
    env.PRICE_USD_TO_EUR = originalFxRate;
    env.PRICE_FX_SOURCE = originalFxSource;
    env.PRICE_FX_AS_OF = originalFxAsOf;
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
    expect(getPriceSourceCatalog().sources.map((source) => source.id)).not.toContain(
      'pokewallet-blended',
    );
    env.PRICE_USD_TO_EUR = 0.9;
    env.PRICE_FX_SOURCE = 'ECB';
    env.PRICE_FX_AS_OF = '2026-08-29T00:00:00.000Z';
    const configured = getPriceSourceCatalog().sources.map((source) => source.id);
    expect(configured).toContain('pokewallet-blended');
    expect(configured).toContain('ebay-active');
  });

  it('retains both native quotes and dated FX provenance when blending', async () => {
    env.PRICE_USD_TO_EUR = 0.9;
    env.PRICE_FX_SOURCE = 'ECB';
    env.PRICE_FX_AS_OF = '2026-08-29T00:00:00.000Z';
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({ data: { id: 'sv5', abbreviation: { official: 'TEF' } } }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          results: [
            {
              card_info: { set_code: 'TEF', card_number: '1' },
              cardmarket: { prices: [{ variant_type: 'normal', avg1: 4 }] },
              tcgplayer: { prices: [{ market_price: 10 }] },
            },
          ],
        }),
      );

    const quote = await new PokeWalletPriceProvider('blended').fetchPrice('pokemon', 'sv5-1');
    expect(quote).toMatchObject({
      currency: 'EUR',
      price: 6.5,
      provenance: {
        provider: 'pokewallet-blended',
        originalQuotes: [
          { amount: 4, currency: 'EUR' },
          { amount: 10, currency: 'USD' },
        ],
        fx: { rate: 0.9, source: 'ECB', asOf: '2026-08-29T00:00:00.000Z' },
      },
    });
  });
});
