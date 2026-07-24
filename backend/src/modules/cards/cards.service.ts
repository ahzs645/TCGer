import { z } from 'zod';
import type { TcgSet } from '@tcg/api-types';

import { adapterRegistry } from '../adapters/adapter-registry';
import type { CardPrintsResult, CardDTO } from '../adapters/types';
import { logger } from '../../utils/logger';

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
    return adapter.searchCards(query);
  }

  const adapters = adapterRegistry.list();
  const results = await Promise.allSettled(
    adapters.map((adapter) =>
      withProviderTimeout(adapter.game, 'search', adapter.searchCards(query))
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

export async function getSets(tcg?: string): Promise<TcgSet[]> {
  if (tcg) {
    const adapter = adapterRegistry.get(tcg);
    if (!adapter.fetchSets) {
      return [];
    }
    return adapter.fetchSets();
  }

  const adapters = adapterRegistry.list();
  const results = await Promise.allSettled(
    adapters.map((adapter) =>
      adapter.fetchSets
        ? withProviderTimeout(adapter.game, 'sets fetch', adapter.fetchSets())
        : Promise.resolve([])
    )
  );
  return results
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
}

export async function getSetCards(tcg: string, setCode: string): Promise<CardDTO[]> {
  const adapter = adapterRegistry.get(tcg);
  if (!adapter.fetchSetCards) {
    return [];
  }
  return adapter.fetchSetCards(setCode);
}
