import { z } from 'zod';

import { adapterRegistry } from '../adapters/adapter-registry';

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
