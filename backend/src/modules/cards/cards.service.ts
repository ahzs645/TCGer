import { z } from 'zod';
import {
  exhaustiveSearchQuerySchema,
  type ExhaustiveSearchQueryInput,
  type TcgSet
} from '@tcg/api-types';

import { adapterRegistry } from '../adapters/adapter-registry';
import type {
  CardPrintsResult,
  CardDTO,
  CardNameSearchOptions,
  TcgAdapter
} from '../adapters/types';
import { logger } from '../../utils/logger';
import { normalizeSearchText, searchTerms } from '../../utils/search-text';

const searchSchema = z.object({
  query: z.string().min(1),
  tcg: z.string().optional()
});

export type CardSearchInput = z.infer<typeof searchSchema>;

const PROVIDER_TIMEOUT_MS = Number.parseInt(
  process.env.CARD_PROVIDER_REQUEST_TIMEOUT_MS ?? '9000',
  10
);

function withProviderTimeout<T>(game: string, operation: string, promise: Promise<T>): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_resolve, reject) => {
      const timeoutId = setTimeout(() => {
        reject(
          Object.assign(new Error(`${game} ${operation} timed out`), {
            status: 504
          })
        );
      }, PROVIDER_TIMEOUT_MS);
      promise.then(
        () => clearTimeout(timeoutId),
        () => clearTimeout(timeoutId)
      );
    })
  ]);
}

export async function searchCards(input: CardSearchInput) {
  const { query, tcg } = searchSchema.parse(input);

  if (tcg && tcg !== 'all') {
    const adapter = adapterRegistry.get(tcg);
    return searchAdapterWithFallback(adapter, query);
  }

  const adapters = adapterRegistry.list();
  const results = await Promise.allSettled(
    adapters.map((adapter) =>
      withProviderTimeout(adapter.game, 'search', searchAdapterWithFallback(adapter, query))
    )
  );
  return results.flatMap((result, index) => {
    if (result.status === 'fulfilled') return result.value;
    logger.warn(
      {
        provider: adapters[index]?.game,
        error:
          result.reason instanceof Error ? result.reason.message : 'Unknown provider search failure'
      },
      'Card provider search failed; returning partial results'
    );
    return [];
  });
}

async function searchAdapterWithFallback(adapter: TcgAdapter, query: string): Promise<CardDTO[]> {
  const exactResults = await adapter.searchCards(query);
  if (exactResults.length) {
    return exactResults;
  }

  return punctuationInsensitiveFallback(query, (term) => adapter.searchCards(term));
}

async function punctuationInsensitiveFallback(
  query: string,
  search: (term: string) => Promise<CardDTO[]>
): Promise<CardDTO[]> {
  const queryKey = normalizeSearchText(query);
  const terms = [...new Set(searchTerms(query))]
    .filter((term) => normalizeSearchText(term) !== queryKey)
    .sort((left, right) => right.length - left.length);

  // A broad provider retry is only useful for a multi-token name. The final
  // normalized filter prevents a token such as "mime" from returning Mime Jr.
  for (const term of terms) {
    const candidates = await search(term);
    const matches = candidates.filter((card) => normalizeSearchText(card.name).includes(queryKey));
    if (matches.length) {
      return matches;
    }
  }

  return [];
}

/**
 * Exhaustive name search used to expand wishlist rules ("every Darkrai").
 * `limit` applies per game, so an all-games search can return up to
 * `limit * adapters` cards.
 */
export async function searchAllCards(input: ExhaustiveSearchQueryInput): Promise<CardDTO[]> {
  const { query, tcg, unique, limit } = exhaustiveSearchQuerySchema.parse(input);
  const options: CardNameSearchOptions = {
    includeAllPrintings: unique === 'prints',
    limit
  };

  if (tcg && tcg !== 'all') {
    const adapter = adapterRegistry.get(tcg);
    return runExhaustiveSearch(adapter, query, options);
  }

  const adapters = adapterRegistry.list();
  const results = await Promise.allSettled(
    adapters.map((adapter) =>
      withProviderTimeout(
        adapter.game,
        'exhaustive search',
        runExhaustiveSearch(adapter, query, options)
      )
    )
  );
  return results.flatMap((result, index) => {
    if (result.status === 'fulfilled') return result.value;
    logger.warn(
      {
        provider: adapters[index]?.game,
        error:
          result.reason instanceof Error
            ? result.reason.message
            : 'Unknown provider exhaustive search failure'
      },
      'Card provider exhaustive search failed; returning partial results'
    );
    return [];
  });
}

async function runExhaustiveSearch(
  adapter: TcgAdapter,
  query: string,
  options: CardNameSearchOptions
): Promise<CardDTO[]> {
  if (!adapter.fetchCardsByName) {
    // No exhaustive support for this game: a capped preview page is still
    // better than nothing, and callers see the smaller count.
    logger.info(
      { provider: adapter.game },
      'Adapter has no exhaustive name search; falling back to preview search'
    );
    const preview = await searchAdapterWithFallback(adapter, query);
    return preview.slice(0, options.limit);
  }
  const exactResults = await adapter.fetchCardsByName(query, options);
  if (exactResults.length) {
    return exactResults.slice(0, options.limit);
  }

  const fallbackResults = await punctuationInsensitiveFallback(query, (term) =>
    adapter.fetchCardsByName!(term, options)
  );
  return fallbackResults.slice(0, options.limit);
}

export async function getCardPrints(params: { tcg: string; cardId: string }): Promise<CardPrintsResult> {
  const { tcg, cardId } = params;
  const adapter = adapterRegistry.get(tcg);
  if (!adapter.fetchCardPrints) {
    return {
      mode: 'simple',
      prints: [],
      total: 0
    };
  }
  return adapter.fetchCardPrints(cardId);
}

export interface SetCatalogResult {
  sets: TcgSet[];
  failedProviders: string[];
}

export async function getSetsWithStatus(tcg?: string): Promise<SetCatalogResult> {
  if (tcg) {
    const adapter = adapterRegistry.get(tcg);
    if (!adapter.fetchSets) {
      return { sets: [], failedProviders: [adapter.game] };
    }
    const sets = await adapter.fetchSets();
    return { sets, failedProviders: sets.length ? [] : [adapter.game] };
  }

  const adapters = adapterRegistry.list();
  const results = await Promise.allSettled(
    adapters.map((adapter) =>
      adapter.fetchSets
        ? withProviderTimeout(adapter.game, 'sets fetch', adapter.fetchSets())
        : Promise.resolve([])
    )
  );
  const failedProviders = results.flatMap((result, index) => {
    if (result.status === 'rejected') return [adapters[index]!.game];
    if (adapters[index]?.fetchSets && result.value.length === 0) return [adapters[index]!.game];
    return [];
  });
  const sets = results
    .flatMap((result, index) => {
      if (result.status === 'fulfilled') return result.value;
      logger.warn(
        {
          provider: adapters[index]?.game,
          error:
            result.reason instanceof Error ? result.reason.message : 'Unknown provider sets failure'
        },
        'Card provider sets fetch failed; returning partial results'
      );
      return [];
    })
    .sort((a, b) => (b.releaseDate ?? '').localeCompare(a.releaseDate ?? ''));
  return { sets, failedProviders };
}

export async function getSets(tcg?: string): Promise<TcgSet[]> {
  return (await getSetsWithStatus(tcg)).sets;
}

export async function getSetCards(tcg: string, setCode: string): Promise<CardDTO[]> {
  const adapter = adapterRegistry.get(tcg);
  if (!adapter.fetchSetCards) {
    return [];
  }
  return adapter.fetchSetCards(setCode);
}
