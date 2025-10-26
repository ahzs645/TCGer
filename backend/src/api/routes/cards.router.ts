import { Router } from 'express';
import { z } from 'zod';

import { adapterRegistry } from '../../modules/adapters/adapter-registry';
import { getCardPrints, searchCards } from '../../modules/cards/cards.service';
import { asyncHandler } from '../../utils/async-handler';

export const cardsRouter = Router();

const searchQuerySchema = z.object({
  query: z.string().min(1, 'query parameter is required'),
  tcg: z.string().optional()
});
const cardParamsSchema = z.object({
  tcg: z.string(),
  cardId: z.string()
});

cardsRouter.get(
  '/search',
  asyncHandler(async (req, res) => {
    const { query, tcg } = searchQuerySchema.parse(req.query);
    const cards = await searchCards({ query, tcg });
    res.json({ cards, total: cards.length });
  })
);

cardsRouter.get(
  '/:tcg/:cardId/prints',
  asyncHandler(async (req, res) => {
    const { tcg, cardId } = cardParamsSchema.parse(req.params);
    const prints = await getCardPrints({ tcg, cardId });
    res.json({ prints, total: prints.length });
  })
);

cardsRouter.get(
  '/:tcg/:cardId',
  asyncHandler(async (req, res) => {
    const { tcg, cardId } = cardParamsSchema.parse(req.params);
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
