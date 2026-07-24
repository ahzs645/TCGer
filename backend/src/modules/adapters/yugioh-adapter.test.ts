jest.mock('../../config/env', () => ({
  env: {
    YGO_API_BASE_URL: 'https://example.test/api/v7'
  }
}));

import { YugiohAdapter } from './yugioh-adapter';
import { buildYugiohPrintingKey } from './yugioh-printing-key';

const CARD_PAYLOAD = {
  data: [
    {
      id: 46986414,
      name: 'Dark Magician',
      type: 'Normal Monster',
      race: 'Spellcaster',
      attribute: 'DARK',
      level: 7,
      atk: 2500,
      def: 2100,
      card_images: [
        {
          id: 46986414,
          image_url: 'https://images.example/46986414.jpg',
          image_url_small: 'https://images.example/46986414-small.jpg'
        },
        {
          id: 999,
          image_url: 'https://images.example/999.jpg',
          image_url_small: 'https://images.example/999-small.jpg'
        }
      ],
      card_sets: [
        {
          set_code: 'LOB-EN005',
          set_name: 'Legend of Blue Eyes White Dragon',
          set_rarity: 'Ultra Rare'
        },
        {
          set_code: 'LART-EN019',
          set_name: 'The Lost Art Promotion',
          set_rarity: 'Ultra Rare',
          card_image_id: 999
        }
      ]
    }
  ]
};

function mockJsonResponse(payload: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => payload
  } as Response;
}

describe('YugiohAdapter printings', () => {
  const fetchMock = jest.spyOn(global, 'fetch');

  beforeEach(() => {
    fetchMock.mockReset();
  });

  afterAll(() => {
    fetchMock.mockRestore();
  });

  test('keeps search usable by returning one representative printing', async () => {
    fetchMock.mockResolvedValueOnce(mockJsonResponse(CARD_PAYLOAD));

    const cards = await new YugiohAdapter().searchCards('Dark Magician');

    expect(cards).toHaveLength(1);
    expect(cards[0]).toEqual(
      expect.objectContaining({
        id: buildYugiohPrintingKey({
          baseExternalId: '46986414',
          setCode: 'LOB-EN005',
          rarity: 'Ultra Rare',
          artworkId: '46986414'
        }),
        baseExternalId: '46986414',
        printingKey: expect.stringContaining('yugioh:print:v1:46986414:'),
        artworkId: '46986414',
        setCode: 'LOB-EN005',
        collectorNumber: '005',
        language: 'EN'
      })
    );
  });

  test('returns every known set printing without cross-producting alternate art', async () => {
    fetchMock.mockResolvedValueOnce(mockJsonResponse(CARD_PAYLOAD));

    const result = await new YugiohAdapter().fetchCardPrints('46986414');

    expect(result.mode).toBe('simple');
    expect(result.total).toBe(2);
    expect(result.prints).toEqual([
      expect.objectContaining({
        setCode: 'LOB-EN005',
        artworkId: '46986414',
        imageUrl: 'https://images.example/46986414.jpg'
      }),
      expect.objectContaining({
        setCode: 'LART-EN019',
        artworkId: '999',
        imageUrl: 'https://images.example/999.jpg'
      })
    ]);
  });

  test('maps set results to the requested set instead of card_sets[0]', async () => {
    fetchMock.mockResolvedValueOnce(mockJsonResponse(CARD_PAYLOAD));

    const cards = await new YugiohAdapter().fetchSetCards('LART');

    expect(cards).toHaveLength(1);
    expect(cards[0]).toEqual(
      expect.objectContaining({
        setCode: 'LART-EN019',
        setName: 'The Lost Art Promotion',
        artworkId: '999'
      })
    );
    expect(fetchMock.mock.calls[0]?.[0]).toContain('cardset=LART');
  });

  test('also matches a requested set name', async () => {
    fetchMock.mockResolvedValueOnce(mockJsonResponse(CARD_PAYLOAD));

    const cards = await new YugiohAdapter().fetchSetCards('The Lost Art Promotion');

    expect(cards[0]).toEqual(expect.objectContaining({ setCode: 'LART-EN019' }));
  });

  test('resolves an exact printing key through the upstream base card ID', async () => {
    fetchMock.mockResolvedValueOnce(mockJsonResponse(CARD_PAYLOAD));
    const printingKey = buildYugiohPrintingKey({
      baseExternalId: '46986414',
      setCode: 'LART-EN019',
      rarity: 'Ultra Rare',
      artworkId: '999'
    });

    const card = await new YugiohAdapter().fetchCardById(printingKey);

    expect(card).toEqual(
      expect.objectContaining({
        id: printingKey,
        setCode: 'LART-EN019',
        artworkId: '999'
      })
    );
    expect(fetchMock.mock.calls[0]?.[0]).toContain('id=46986414');
  });

  test('does not silently substitute another print for an unknown printing key', async () => {
    fetchMock.mockResolvedValueOnce(mockJsonResponse(CARD_PAYLOAD));
    const unknownPrinting = buildYugiohPrintingKey({
      baseExternalId: '46986414',
      setCode: 'UNKNOWN-EN001',
      rarity: 'Common',
      artworkId: '46986414'
    });

    await expect(new YugiohAdapter().fetchCardById(unknownPrinting)).resolves.toBeNull();
  });
});
