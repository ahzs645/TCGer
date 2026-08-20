import {
  JustTcgPriceProvider,
  LorcastPriceProvider,
  ScryfallPriceProvider,
  TcgDexPriceProvider,
} from './market-price-providers';
import { env } from '../../config/env';

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: jest.fn().mockResolvedValue(body),
  } as unknown as Response;
}

describe('market price providers', () => {
  const fetchMock = jest.spyOn(global, 'fetch');

  beforeEach(() => {
    fetchMock.mockReset();
  });

  afterAll(() => {
    fetchMock.mockRestore();
  });

  describe('TCGdex / Cardmarket', () => {
    it.each([
      [{ avg: 4.5, 'avg-holo': 6.5, low: 2, avg1: 4 }, 4.5],
      [{ avg: null, 'avg-holo': '6.50', low: 2, avg1: 4 }, 6.5],
      [{ avg: 0, 'avg-holo': null, low: 2, avg1: 4 }, 2],
      [{ avg: null, 'avg-holo': null, low: null, avg1: '4.00' }, 4],
    ])('uses avg, avg-holo, low, then avg1 in order', async (cardmarket, expected) => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse({ pricing: { cardmarket: { unit: 'EUR', ...cardmarket } } }),
      );

      await expect(
        new TcgDexPriceProvider().fetchPrice('pokemon', 'sv01-001'),
      ).resolves.toMatchObject({
        price: expected,
        currency: 'EUR',
      });
    });

    it('does not substitute avg-holo when avg is available', async () => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse({ pricing: { cardmarket: { unit: 'eur', avg: 4.5, 'avg-holo': 7 } } }),
      );

      await expect(new TcgDexPriceProvider().fetchPrice('pokemon', 'sv01-001')).resolves.toEqual({
        price: 4.5,
        foilPrice: undefined,
        etchedPrice: undefined,
        reverseHoloPrice: undefined,
        currency: 'EUR',
      });
    });
  });

  describe('Scryfall', () => {
    it('returns regular, foil, and etched USD prices', async () => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse({
          prices: { usd: '3.25', usd_foil: '8.10', usd_etched: '9.40', eur: '2.90' },
        }),
      );

      await expect(
        new ScryfallPriceProvider().fetchPrice('magic', 'card-id'),
      ).resolves.toMatchObject({
        price: 3.25,
        foilPrice: 8.1,
        etchedPrice: 9.4,
        currency: 'USD',
      });
    });

    it('falls back to EUR only when the USD base price is unavailable', async () => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse({ prices: { usd: null, usd_foil: '9.00', eur: '2.90', eur_foil: '7.50' } }),
      );

      await expect(
        new ScryfallPriceProvider().fetchPrice('magic', 'card-id'),
      ).resolves.toMatchObject({
        price: 2.9,
        foilPrice: 7.5,
        currency: 'EUR',
      });
    });
  });

  describe('Lorcast', () => {
    it('uses USD and falls back to USD foil for collection value', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse({ prices: { usd: null, usd_foil: '12.40' } }));

      await expect(
        new LorcastPriceProvider().fetchPrice('lorcana', 'crd_123'),
      ).resolves.toMatchObject({
        price: 12.4,
        currency: 'USD',
      });
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringMatching(/\/cards\/crd_123$/),
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      );
    });

    it('translates TCGer set:collector IDs to Lorcast card routes', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse({ prices: { usd: '3.20' } }));

      await new LorcastPriceProvider().fetchPrice('lorcana', '1:42');
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringMatching(/\/cards\/1\/42$/),
        expect.any(Object),
      );
    });
  });

  describe('JustTCG', () => {
    it('uses the Scryfall identifier and Near Mint variants for Magic', async () => {
      const originalAPIKey = env.JUSTTCG_API_KEY;
      env.JUSTTCG_API_KEY = 'test-key';
      fetchMock.mockResolvedValueOnce(
        jsonResponse({
          data: [
            {
              variants: [
                { condition: 'Lightly Played', printing: 'Normal', price: 1.5 },
                { condition: 'Near Mint', printing: 'Normal', price: 2.25 },
                { condition: 'Near Mint', printing: 'Foil', price: 5.75 },
              ],
            },
          ],
        }),
      );

      try {
        await expect(
          new JustTcgPriceProvider().fetchPrice('magic', 'scryfall-uuid'),
        ).resolves.toEqual({
          price: 2.25,
          foilPrice: 5.75,
          etchedPrice: undefined,
          reverseHoloPrice: undefined,
          currency: 'USD',
        });
        const [url, options] = fetchMock.mock.calls[0];
        expect(String(url)).toContain('/cards?scryfallId=scryfall-uuid');
        expect(options).toEqual(
          expect.objectContaining({
            headers: expect.objectContaining({ 'x-api-key': 'test-key' }),
          }),
        );
      } finally {
        env.JUSTTCG_API_KEY = originalAPIKey;
      }
    });

    it('uses canonical TCGplayer IDs and explicitly prefers language for Pokemon', async () => {
      const originalAPIKey = env.JUSTTCG_API_KEY;
      env.JUSTTCG_API_KEY = 'test-key';
      fetchMock.mockResolvedValueOnce(
        jsonResponse({
          data: [{
            variants: [
              { condition: 'Near Mint', printing: 'Normal', language: 'English', price: 7.25 },
              { condition: 'Near Mint', printing: 'Normal', language: 'Japanese', price: 9 },
            ],
          }],
        }),
      );

      try {
        await expect(
          new JustTcgPriceProvider().fetchPrice('pokemon', 'sv1-001', {
            identifiers: { tcgplayerId: '219042' },
            language: 'Japanese',
            condition: 'Near Mint',
          }),
        ).resolves.toMatchObject({ price: 9, currency: 'USD' });
        expect(String(fetchMock.mock.calls[0][0])).toContain('/cards?tcgplayerId=219042');
      } finally {
        env.JUSTTCG_API_KEY = originalAPIKey;
      }
    });
  });

  it('does not call an upstream API for an unsupported game', async () => {
    await expect(new ScryfallPriceProvider().fetchPrice('pokemon', 'card-id')).resolves.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('treats a missing upstream card as no quote', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({}, 404));
    await expect(new LorcastPriceProvider().fetchPrice('lorcana', 'missing')).resolves.toBeNull();
  });
});
