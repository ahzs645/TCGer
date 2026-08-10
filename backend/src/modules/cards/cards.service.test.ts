jest.mock('../../config/env', () => ({
  env: {
    YGO_API_BASE_URL: 'https://ygo.example.test/api',
    SCRYFALL_API_BASE_URL: 'https://magic.example.test/api',
    POKEMON_API_BASE_URL: 'https://pokemon.example.test/api',
    TCGDEX_API_BASE_URL: 'https://tcgdex.example.test/api',
    ONEPIECE_API_BASE_URL: 'https://onepiece.example.test/api',
    LORCANA_API_BASE_URL: 'https://lorcana.example.test/api',
    APITCG_API_BASE_URL: 'https://apitcg.example.test',
    APITCG_API_KEY: undefined,
    SCRYDEX_API_KEY: undefined,
  },
}));

import type { TcgAdapter } from '../adapters/types';
import { adapterRegistry } from '../adapters/adapter-registry';
import { searchAllCards, searchCards, searchCardsByArtist } from './cards.service';

describe('cross-game card search', () => {
  afterEach(() => jest.restoreAllMocks());

  test('returns successful provider results when another adapter fails', async () => {
    const successAdapter = {
      game: 'onepiece',
      searchCards: jest
        .fn()
        .mockResolvedValue([{ id: 'OP01-001', tcg: 'onepiece', name: 'Roronoa Zoro' }]),
    } as unknown as TcgAdapter;
    const failedAdapter = {
      game: 'dragonball',
      searchCards: jest.fn().mockRejectedValue(new Error('APITCG unavailable')),
    } as unknown as TcgAdapter;
    jest.spyOn(adapterRegistry, 'list').mockReturnValue([successAdapter, failedAdapter]);

    await expect(searchCards({ query: 'hero', tcg: 'all' })).resolves.toEqual([
      { id: 'OP01-001', tcg: 'onepiece', name: 'Roronoa Zoro' },
    ]);
  });

  test('preserves useful errors for a specific game search', async () => {
    const error = Object.assign(new Error('APITCG_API_KEY is required'), {
      status: 503,
    });
    jest.spyOn(adapterRegistry, 'get').mockReturnValue({
      game: 'dragonball',
      searchCards: jest.fn().mockRejectedValue(error),
    } as unknown as TcgAdapter);

    await expect(searchCards({ query: 'Goku', tcg: 'dragonball' })).rejects.toBe(error);
  });

  test.each(['Mr Mime', 'Mr.mime'])(
    'falls back to normalized name tokens for %s without aliases',
    async (query) => {
      const searchCardsMock = jest.fn(async (providerQuery: string) => {
        if (providerQuery.toLowerCase() === 'mime') {
          return [
            { id: 'mr-mime', tcg: 'pokemon', name: 'Mr. Mime' },
            { id: 'mime-jr', tcg: 'pokemon', name: 'Mime Jr.' },
          ];
        }
        return [];
      });
      jest.spyOn(adapterRegistry, 'get').mockReturnValue({
        game: 'pokemon',
        searchCards: searchCardsMock,
      } as unknown as TcgAdapter);

      await expect(searchCards({ query, tcg: 'pokemon' })).resolves.toEqual([
        { id: 'mr-mime', tcg: 'pokemon', name: 'Mr. Mime' },
      ]);
      expect(searchCardsMock).toHaveBeenCalledWith(query);
      expect(searchCardsMock).toHaveBeenCalledWith('mime');
    },
  );
});

describe('exhaustive name search', () => {
  afterEach(() => jest.restoreAllMocks());

  const card = (id: string) => ({ id, tcg: 'pokemon', name: 'Darkrai' });

  test('asks the adapter for every printing and honours the limit', async () => {
    const fetchCardsByName = jest.fn().mockResolvedValue([card('a'), card('b'), card('c')]);
    jest.spyOn(adapterRegistry, 'get').mockReturnValue({
      game: 'pokemon',
      searchCards: jest.fn(),
      fetchCardsByName,
    } as unknown as TcgAdapter);

    const results = await searchAllCards({
      query: 'darkrai',
      tcg: 'pokemon',
      unique: 'prints',
      limit: 2,
    });

    expect(fetchCardsByName).toHaveBeenCalledWith('darkrai', {
      includeAllPrintings: true,
      limit: 2,
    });
    expect(results).toHaveLength(2);
  });

  test('collapses to distinct cards when unique=cards', async () => {
    const fetchCardsByName = jest.fn().mockResolvedValue([card('a')]);
    jest.spyOn(adapterRegistry, 'get').mockReturnValue({
      game: 'pokemon',
      searchCards: jest.fn(),
      fetchCardsByName,
    } as unknown as TcgAdapter);

    await searchAllCards({ query: 'darkrai', tcg: 'pokemon', unique: 'cards', limit: 10 });

    expect(fetchCardsByName).toHaveBeenCalledWith('darkrai', {
      includeAllPrintings: false,
      limit: 10,
    });
  });

  test('falls back to the preview search for adapters without exhaustive support', async () => {
    const searchCardsMock = jest.fn().mockResolvedValue([card('a'), card('b')]);
    jest.spyOn(adapterRegistry, 'get').mockReturnValue({
      game: 'onepiece',
      searchCards: searchCardsMock,
    } as unknown as TcgAdapter);

    const results = await searchAllCards({
      query: 'zoro',
      tcg: 'onepiece',
      unique: 'prints',
      limit: 50,
    });

    expect(searchCardsMock).toHaveBeenCalledWith('zoro');
    expect(results).toHaveLength(2);
  });

  test('returns partial results when one game fails', async () => {
    const workingAdapter = {
      game: 'pokemon',
      searchCards: jest.fn(),
      fetchCardsByName: jest.fn().mockResolvedValue([card('a')]),
    } as unknown as TcgAdapter;
    const brokenAdapter = {
      game: 'dragonball',
      searchCards: jest.fn(),
      fetchCardsByName: jest.fn().mockRejectedValue(new Error('APITCG unavailable')),
    } as unknown as TcgAdapter;
    jest.spyOn(adapterRegistry, 'list').mockReturnValue([workingAdapter, brokenAdapter]);

    await expect(
      searchAllCards({ query: 'darkrai', unique: 'prints', limit: 100 }),
    ).resolves.toEqual([card('a')]);
  });
});

describe('artist search', () => {
  afterEach(() => jest.restoreAllMocks());

  test('uses exact adapter artist lookup with printing options', async () => {
    const clayCards = [{ id: 'sm6-1', tcg: 'pokemon', name: 'Exeggcute', artist: 'Yuka Morii' }];
    const fetchCardsByArtist = jest.fn().mockResolvedValue(clayCards);
    jest.spyOn(adapterRegistry, 'get').mockReturnValue({
      game: 'pokemon',
      searchCards: jest.fn(),
      fetchCardsByArtist,
    } as unknown as TcgAdapter);

    await expect(
      searchCardsByArtist({
        artist: 'Yuka Morii',
        tcg: 'pokemon',
        unique: 'prints',
        limit: 500,
      }),
    ).resolves.toEqual(clayCards);
    expect(fetchCardsByArtist).toHaveBeenCalledWith('Yuka Morii', {
      includeAllPrintings: true,
      limit: 500,
    });
  });
});
