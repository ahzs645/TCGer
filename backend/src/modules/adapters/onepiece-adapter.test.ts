jest.mock('../../config/env', () => ({
  env: {
    ONEPIECE_API_BASE_URL: 'https://onepiece.example.test/api'
  }
}));

import { OnePieceAdapter } from './onepiece-adapter';

function jsonResponse(payload: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => payload
  } as Response;
}

const printings = [
  {
    card_name: 'Roronoa Zoro (001)',
    set_name: 'Romance Dawn',
    set_id: 'OP-01',
    rarity: 'L',
    card_set_id: 'OP01-001',
    card_color: 'Red',
    card_type: 'Leader',
    card_power: '5000',
    counter_amount: null,
    attribute: 'Slash',
    card_text: '[DON!! x1] All Characters gain +1000 power.',
    card_image_id: 'OP01-001',
    card_image: 'https://images.example/OP01-001.jpg'
  },
  {
    card_name: 'Roronoa Zoro (001) (Parallel)',
    set_name: 'Romance Dawn',
    set_id: 'OP-01',
    rarity: 'L',
    card_set_id: 'OP01-001',
    card_image_id: 'OP01-001_p1',
    card_image: 'https://images.example/OP01-001_p1.jpg'
  }
];

describe('OnePieceAdapter contract', () => {
  const fetchMock = jest.spyOn(global, 'fetch');

  beforeEach(() => fetchMock.mockReset());
  afterAll(() => fetchMock.mockRestore());

  test('returns no results for an empty query without calling upstream', async () => {
    await expect(new OnePieceAdapter().searchCards('  ')).resolves.toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('validates the live array shape and keeps alternate print identities distinct', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(printings));
    const cards = await new OnePieceAdapter().searchCards('Zoro');
    expect(cards).toEqual([
      expect.objectContaining({
        id: 'OP01-001',
        baseExternalId: 'OP01-001',
        printingKey: 'onepiece:OP01-001',
        artworkId: 'OP01-001',
        setCode: 'OP-01',
        collectorNumber: 'OP01-001'
      }),
      expect.objectContaining({
        id: 'OP01-001_p1',
        baseExternalId: 'OP01-001',
        printingKey: 'onepiece:OP01-001_p1',
        artworkId: 'OP01-001_p1'
      })
    ]);
    expect(cards[0]?.attributes).toEqual(
      expect.objectContaining({
        counter: undefined,
        attribute: 'Slash',
        effect: '[DON!! x1] All Characters gain +1000 power.'
      })
    );
    expect(fetchMock.mock.calls[0]?.[1]).toEqual(
      expect.objectContaining({ headers: { Accept: 'application/json' } })
    );
  });

  test('rejects a malformed payload', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ results: [] }));
    await expect(new OnePieceAdapter().searchCards('Zoro')).rejects.toThrow(
      'malformed payload'
    );
  });

  test('returns null for a single-card 404', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({}, 404));
    await expect(new OnePieceAdapter().fetchCardById('OP01-999')).resolves.toBeNull();
  });

  test('selects a requested alternate printing from the single-card array', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(printings));
    await expect(new OnePieceAdapter().fetchCardById('onepiece:OP01-001_p1')).resolves.toEqual(
      expect.objectContaining({ id: 'OP01-001_p1', printingKey: 'onepiece:OP01-001_p1' })
    );
    expect(fetchMock.mock.calls[0]?.[0]).toContain('/sets/card/OP01-001/');
  });

  test('surfaces upstream 5xx errors', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({}, 503));
    await expect(new OnePieceAdapter().searchCards('Zoro')).rejects.toMatchObject({
      status: 502
    });
  });
});
