jest.mock('../../config/env', () => ({ env: { SCRYFALL_API_BASE_URL: 'https://api.scryfall.com' } }));

import { MagicAdapter } from './magic-adapter';

describe('Scryfall request boundary', () => {
  afterEach(() => jest.restoreAllMocks());

  test('identifies the application and accepts JSON for searches', async () => {
    const transport = jest.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ data: [] }));
    await expect(new MagicAdapter().searchCards('Black Lotus')).resolves.toEqual([]);
    const headers = new Headers(transport.mock.calls[0][1]?.headers);
    expect(headers.get('user-agent')).toContain('TCGer/');
    expect(headers.get('accept')).toBe('application/json');
  });

  test('treats Scryfall 404 as a successful empty search', async () => {
    jest.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('', { status: 404 }));
    await expect(new MagicAdapter().searchCards('unmatched-name')).resolves.toEqual([]);
  });

  test.each(['preview', 'exhaustive'])('surfaces %s upstream failures instead of empty results', async (mode) => {
    jest.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('', { status: 429 }));
    jest.spyOn(console, 'error').mockImplementation(() => {});
    const adapter = new MagicAdapter();
    const result = mode === 'preview' ? adapter.searchCards('Black Lotus') : adapter.fetchCardsByName('Black Lotus', { includeAllPrintings: true, limit: 100 });
    await expect(result).rejects.toMatchObject({ status: 503, code: 'CARD_SEARCH_UNAVAILABLE' });
  });
});
