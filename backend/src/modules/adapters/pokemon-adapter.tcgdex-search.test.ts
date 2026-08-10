import type { CardDTO } from './types';

type ProviderMode = 'public' | 'cache';

const baseEnvironment = {
  POKEMON_API_BASE_URL: 'https://pokemon.example.test/v2',
  TCGDEX_API_BASE_URL: 'https://api.tcgdex.net/v2/en',
  SCRYDEX_API_KEY: undefined,
  SCRYDEX_TEAM_ID: undefined
};

async function loadAdapter(mode: ProviderMode) {
  jest.resetModules();
  jest.doMock('../../config/env', () => ({
    env: {
      ...baseEnvironment,
      TCGDEX_API_BASE_URL:
        mode === 'public'
          ? 'https://api.tcgdex.net/v2/en'
          : 'http://tcgdex-cache:4040'
    }
  }));
  const { PokemonAdapter } = await import('./pokemon-adapter');
  return new PokemonAdapter();
}

function jsonResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { 'Content-Type': 'application/json' }
  });
}

function lucarioSummary() {
  return {
    id: 'tk-dp-l-3',
    localId: '3',
    name: 'Lucario'
  };
}

function lucarioDetail() {
  return {
    ...lucarioSummary(),
    rarity: 'None',
    category: 'Pokemon',
    set: {
      id: 'tk-dp-l',
      name: 'DP trainer Kit (Lucario)'
    }
  };
}

describe('PokemonAdapter TCGdex search compatibility', () => {
  beforeEach(() => {
    process.env.POKEMON_MIN_DELAY_MS = '0';
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.resetModules();
    jest.unmock('../../config/env');
    delete process.env.POKEMON_MIN_DELAY_MS;
  });

  it('uses public REST filters and raw array responses for api.tcgdex.net', async () => {
    const requests: URL[] = [];
    jest.spyOn(global, 'fetch').mockImplementation(async (input) => {
      const url = new URL(input.toString());
      requests.push(url);

      if (url.hostname === 'pokemon.example.test') {
        return jsonResponse({ data: [] });
      }
      if (url.pathname.endsWith('/cards/tk-dp-l-3')) {
        return jsonResponse(lucarioDetail());
      }
      return jsonResponse([lucarioSummary()]);
    });
    jest.spyOn(console, 'log').mockImplementation(() => {});

    const adapter = await loadAdapter('public');
    const cards = await adapter.searchCards('Lucario');

    expect(cards.map((card: CardDTO) => card.id)).toEqual(['tk-dp-l-3']);
    expect(cards[0]).toMatchObject({
      setCode: 'tk-dp-l',
      setName: 'DP trainer Kit (Lucario)',
      collectorNumber: '3'
    });

    const publicSearch = requests.find(
      (url) => url.hostname === 'api.tcgdex.net' && url.pathname.endsWith('/cards')
    );
    expect(publicSearch?.searchParams.get('name')).toBe('Lucario');
    expect(publicSearch?.searchParams.get('pagination:page')).toBe('1');
    expect(publicSearch?.searchParams.get('pagination:itemsPerPage')).toBe('20');
    expect(publicSearch?.searchParams.has('q')).toBe(false);
    expect(publicSearch?.searchParams.has('pageSize')).toBe(false);
  });

  it('preserves the cache q/page/pageSize wrapper contract', async () => {
    const requests: URL[] = [];
    jest.spyOn(global, 'fetch').mockImplementation(async (input) => {
      const url = new URL(input.toString());
      requests.push(url);

      if (url.hostname === 'pokemon.example.test') {
        return jsonResponse({ data: [] });
      }
      if (url.pathname.endsWith('/cards/tk-dp-l-3')) {
        return jsonResponse({ data: lucarioDetail() });
      }
      return jsonResponse({
        data: [lucarioSummary()],
        page: 1,
        pageSize: 20,
        count: 1,
        totalCount: 1
      });
    });
    jest.spyOn(console, 'log').mockImplementation(() => {});

    const adapter = await loadAdapter('cache');
    const cards = await adapter.searchCards('Lucario');

    expect(cards.map((card: CardDTO) => card.id)).toEqual(['tk-dp-l-3']);

    const cacheSearch = requests.find(
      (url) => url.hostname === 'tcgdex-cache' && url.pathname.endsWith('/cards')
    );
    expect(cacheSearch?.searchParams.get('q')).toBe('Lucario');
    expect(cacheSearch?.searchParams.has('page')).toBe(false);
    expect(cacheSearch?.searchParams.get('pageSize')).toBe('20');
    expect(cacheSearch?.searchParams.has('name')).toBe(false);
    expect(cacheSearch?.searchParams.has('pagination:itemsPerPage')).toBe(false);
  });

  it('uses the public contract when exhaustive primary-provider search falls back', async () => {
    const requests: URL[] = [];
    jest.spyOn(global, 'fetch').mockImplementation(async (input) => {
      const url = new URL(input.toString());
      requests.push(url);

      if (url.hostname === 'pokemon.example.test') {
        return jsonResponse({ data: [], totalCount: 0 });
      }
      if (url.pathname.endsWith('/cards/tk-dp-l-3')) {
        return jsonResponse(lucarioDetail());
      }
      return jsonResponse([lucarioSummary()]);
    });

    const adapter = await loadAdapter('public');
    const cards = await adapter.fetchCardsByName('Lucario', {
      includeAllPrintings: true,
      limit: 60
    });

    expect(cards.map((card: CardDTO) => card.id)).toEqual(['tk-dp-l-3']);

    const publicSearch = requests.find(
      (url) => url.hostname === 'api.tcgdex.net' && url.pathname.endsWith('/cards')
    );
    expect(publicSearch?.searchParams.get('name')).toBe('Lucario');
    expect(publicSearch?.searchParams.get('pagination:page')).toBe('1');
    expect(publicSearch?.searchParams.get('pagination:itemsPerPage')).toBe('60');
  });
});
