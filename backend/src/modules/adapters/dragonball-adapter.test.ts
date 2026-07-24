jest.mock('../../config/env', () => ({
  env: {
    APITCG_API_BASE_URL: 'https://apitcg.example.test',
    APITCG_API_KEY: 'test-api-key'
  }
}));

import { env } from '../../config/env';
import { DragonBallAdapter } from './dragonball-adapter';

function jsonResponse(payload: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => payload
  } as Response;
}

const product = {
  _id: 1024,
  type: 'card',
  name: 'Son Goku',
  tcg: 'dragon-ball-super-fusion-world',
  set: {
    _id: 'dragon-ball-super-fusion-world-awakened-pulse',
    name: 'Awakened Pulse',
    code: 'FB01',
    release_date: '2024-02-23T00:00:00.000Z'
  },
  code: 'FB01-001',
  cardNumber: '001',
  images: [
    {
      small: 'https://images.example/goku-small.jpg',
      large: 'https://images.example/goku-large.jpg'
    }
  ],
  attributes: {
    Rarity: 'L',
    Color: 'Red',
    Power: '15000',
    'Combo Power': '10000',
    Energy: '1',
    'Combo Energy': '0',
    Era: 'Saiyan',
    Character: 'Son Goku',
    'Special Trait': 'Saiyan',
    Skill: 'When Attacking'
  }
};

describe('DragonBallAdapter APITCG contract', () => {
  const fetchMock = jest.spyOn(global, 'fetch');
  const mockedEnv = env as typeof env & { APITCG_API_KEY?: string };

  beforeEach(() => {
    fetchMock.mockReset();
    mockedEnv.APITCG_API_KEY = 'test-api-key';
  });
  afterAll(() => fetchMock.mockRestore());

  test('returns no results for an empty query without requiring configuration', async () => {
    delete mockedEnv.APITCG_API_KEY;
    await expect(new DragonBallAdapter().searchCards(' ')).resolves.toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('returns a clear missing-key configuration error', async () => {
    delete mockedEnv.APITCG_API_KEY;
    await expect(new DragonBallAdapter().searchCards('Goku')).rejects.toMatchObject({
      status: 503,
      code: 'APITCG_NOT_CONFIGURED',
      message: expect.stringContaining('APITCG_API_KEY')
    });
  });

  test('sends the API key, pagination, slug, and maps official product fields', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ success: true, data: [product], total: 1 })
    );
    const cards = await new DragonBallAdapter().searchCards('Goku');
    expect(cards).toEqual([
      expect.objectContaining({
        id: '1024',
        printingKey: 'dragonball:1024',
        setCode: 'FB01',
        setName: 'Awakened Pulse',
        rarity: 'L',
        collectorNumber: '001',
        imageUrl: 'https://images.example/goku-large.jpg'
      })
    ]);
    expect(cards[0]?.attributes).toEqual(
      expect.objectContaining({
        color: 'Red',
        comboPower: '10000',
        comboEnergy: '0',
        specialTrait: 'Saiyan'
      })
    );
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(String(url)).toContain(
      'tcg=dragon-ball-super-fusion-world&type=card&limit=20&page=1'
    );
    expect(String(url)).toContain('name=Goku');
    expect(init).toEqual(
      expect.objectContaining({
        headers: expect.objectContaining({ 'x-api-key': 'test-api-key' })
      })
    );
  });

  test('rejects a malformed payload', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ success: true, products: [] }));
    await expect(new DragonBallAdapter().searchCards('Goku')).rejects.toThrow(
      'malformed payload'
    );
  });

  test('returns null for a single-card 404', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({}, 404));
    await expect(new DragonBallAdapter().fetchCardById('1024')).resolves.toBeNull();
  });

  test('surfaces upstream 5xx errors', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({}, 502));
    await expect(new DragonBallAdapter().searchCards('Goku')).rejects.toMatchObject({
      status: 502
    });
  });

  test('paginates set cards with the provider limit', async () => {
    const firstPage = Array.from({ length: 100 }, (_, index) => ({
      ...product,
      _id: index + 1
    }));
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({ success: true, data: firstPage, total: 101 })
      )
      .mockResolvedValueOnce(
        jsonResponse({ success: true, data: [{ ...product, _id: 101 }], total: 101 })
      );
    const cards = await new DragonBallAdapter().fetchSetCards(
      'dragon-ball-super-fusion-world-awakened-pulse'
    );
    expect(cards).toHaveLength(101);
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain('limit=100&page=1');
    expect(String(fetchMock.mock.calls[1]?.[0])).toContain('limit=100&page=2');
  });
});
