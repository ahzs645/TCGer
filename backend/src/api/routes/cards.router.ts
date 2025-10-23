import { Router } from 'express';
import { z } from 'zod';

import { adapterRegistry } from '../../modules/adapters/adapter-registry';
import { searchCards } from '../../modules/cards/cards.service';
import { asyncHandler } from '../../utils/async-handler';

export const cardsRouter = Router();

const searchQuerySchema = z.object({
  query: z.string().min(1, 'query parameter is required'),
  tcg: z.string().optional()
});

cardsRouter.get(
  '/search',
  asyncHandler(async (req, res) => {
    const { query, tcg } = searchQuerySchema.parse(req.query);
    const cards = await searchCards({ query, tcg });
    res.json({ cards });
  })
);

cardsRouter.get(
  '/:tcg/:cardId',
  asyncHandler(async (req, res) => {
    const paramsSchema = z.object({
      tcg: z.string(),
      cardId: z.string()
    });
    const { tcg, cardId } = paramsSchema.parse(req.params);
    const adapter = adapterRegistry.get(tcg);
    const card =
      (await adapter.fetchCardById(cardId)) ??
      (await (async () => {
        // Temporary placeholder until adapters support fetchCardById.
        const results = await searchCards({ query: cardId, tcg });
        return results.find((entry) => entry.id.includes(cardId)) ?? null;
      })());

    if (!card) {
      return res.status(404).json({ error: 'NOT_FOUND', message: 'Card not found' });
    }

    res.json({ card });
  })
);
