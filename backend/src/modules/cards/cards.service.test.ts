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
    SCRYDEX_API_KEY: undefined
  }
}));

import type { TcgAdapter } from '../adapters/types';
import { adapterRegistry } from '../adapters/adapter-registry';
import { searchCards } from './cards.service';

describe('cross-game card search', () => {
  afterEach(() => jest.restoreAllMocks());

  test('returns successful provider results when another adapter fails', async () => {
    const successAdapter = {
      game: 'onepiece',
      searchCards: jest.fn().mockResolvedValue([
        { id: 'OP01-001', tcg: 'onepiece', name: 'Roronoa Zoro' }
      ])
    } as unknown as TcgAdapter;
    const failedAdapter = {
      game: 'dragonball',
      searchCards: jest.fn().mockRejectedValue(new Error('APITCG unavailable'))
    } as unknown as TcgAdapter;
    jest.spyOn(adapterRegistry, 'list').mockReturnValue([successAdapter, failedAdapter]);

    await expect(searchCards({ query: 'hero', tcg: 'all' })).resolves.toEqual([
      { id: 'OP01-001', tcg: 'onepiece', name: 'Roronoa Zoro' }
    ]);
  });

  test('preserves useful errors for a specific game search', async () => {
    const error = Object.assign(new Error('APITCG_API_KEY is required'), {
      status: 503
    });
    jest.spyOn(adapterRegistry, 'get').mockReturnValue({
      game: 'dragonball',
      searchCards: jest.fn().mockRejectedValue(error)
    } as unknown as TcgAdapter);

    await expect(searchCards({ query: 'Goku', tcg: 'dragonball' })).rejects.toBe(error);
  });
});
