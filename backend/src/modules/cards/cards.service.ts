import { z } from 'zod';

import { adapterRegistry } from '../adapters/adapter-registry';
import type { CardPrintsResult } from '../adapters/types';

const searchSchema = z.object({
  query: z.string().min(1),
  tcg: z.string().optional()
});

export type CardSearchInput = z.infer<typeof searchSchema>;

export async function searchCards(input: CardSearchInput) {
  const { query, tcg } = searchSchema.parse(input);

  if (tcg) {
    const adapter = adapterRegistry.get(tcg);
    return adapter.searchCards(query);
  }

  const adapters = adapterRegistry.list();
  const results = await Promise.all(adapters.map((adapter) => adapter.searchCards(query)));
  return results.flat();
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
