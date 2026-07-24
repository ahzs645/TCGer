jest.mock('../../config/env', () => ({
  env: {
    LORCANA_API_BASE_URL: 'https://lorcana.example.test/v0'
  }
}));

import { LorcanaAdapter } from './lorcana-adapter';

function jsonResponse(payload: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => payload
  } as Response;
}

const card = {
  id: 'crd_elsa',
  name: 'Elsa',
  version: 'Concerned Sister',
  released_at: '2026-02-13',
  image_uris: {
    digital: {
      small: 'https://images.example/elsa-small.avif',
      large: 'https://images.example/elsa-large.avif'
    }
  },
  cost: 3,
  inkwell: true,
  ink: 'Ruby',
  type: ['Character'],
  classifications: ['Storyborn', 'Hero'],
  text: null,
  keywords: [],
  move_cost: null,
  strength: 2,
  willpower: 2,
  lore: 2,
  rarity: 'Uncommon',
  illustrators: ['Hollie Hibbert'],
  collector_number: '125',
  lang: 'en',
  flavor_text: null,
  set: {
    id: 'set_winterspell',
    code: '11',
    name: 'Winterspell'
  }
};

describe('LorcanaAdapter contract', () => {
  const fetchMock = jest.spyOn(global, 'fetch');

  beforeEach(() => fetchMock.mockReset());
  afterAll(() => fetchMock.mockRestore());

  test('returns no results for an empty query without calling upstream', async () => {
    await expect(new LorcanaAdapter().searchCards('')).resolves.toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('maps results, nested digital images, nullable fields, and exact printing IDs', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ results: [card] }));
    const cards = await new LorcanaAdapter().searchCards('Elsa');
    expect(cards).toEqual([
      expect.objectContaining({
        id: 'crd_elsa',
        name: 'Elsa - Concerned Sister',
        printingKey: 'lorcana:crd_elsa',
        artworkId: 'crd_elsa',
        collectorNumber: '125',
        language: 'en',
        imageUrl: 'https://images.example/elsa-large.avif',
        imageUrlSmall: 'https://images.example/elsa-small.avif'
      })
    ]);
    expect(fetchMock.mock.calls[0]?.[0]).toContain('unique=prints');
  });

  test('validates the documented results envelope', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse([card]));
    await expect(new LorcanaAdapter().searchCards('Elsa')).rejects.toThrow(
      'malformed payload'
    );
  });

  test('uses the documented set/collector route and returns null on 404', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({}, 404));
    await expect(new LorcanaAdapter().fetchCardById('11/125')).resolves.toBeNull();
    expect(fetchMock.mock.calls[0]?.[0]).toContain('/cards/11/125');
  });

  test('does not call the undocumented opaque-ID route', async () => {
    await expect(new LorcanaAdapter().fetchCardById('crd_elsa')).resolves.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('validates the sets results envelope', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        results: [
          {
            id: 'set_winterspell',
            name: 'Winterspell',
            code: '11',
            released_at: '2026-02-13'
          }
        ]
      })
    );
    await expect(new LorcanaAdapter().fetchSets()).resolves.toEqual([
      expect.objectContaining({
        code: '11',
        name: 'Winterspell',
        tcg: 'lorcana',
        releaseDate: '2026-02-13'
      })
    ]);
  });

  test('surfaces upstream 5xx errors', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({}, 500));
    await expect(new LorcanaAdapter().searchCards('Elsa')).rejects.toMatchObject({
      status: 502
    });
  });
});
