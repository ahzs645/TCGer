import { Router } from 'express';
import { searchQuerySchema, cardParamsSchema } from '@tcg/api-types';

import { adapterRegistry } from '../../modules/adapters/adapter-registry';
import { getCardPrints, searchCards, getSets, getSetCards } from '../../modules/cards/cards.service';
import { asyncHandler } from '../../utils/async-handler';
import { requireAuth } from '../middleware/auth';

export const cardsRouter = Router();
cardsRouter.use(requireAuth);

cardsRouter.get(
  '/search',
  asyncHandler(async (req, res) => {
    const { query, tcg } = searchQuerySchema.parse(req.query);
    const cards = await searchCards({ query, tcg });
    res.json({ cards, total: cards.length });
  })
);

// Browse sets
cardsRouter.get(
  '/sets',
  asyncHandler(async (req, res) => {
    const tcg = typeof req.query.tcg === 'string' ? req.query.tcg : undefined;
    const sets = await getSets(tcg);
    res.json({ sets, total: sets.length });
  })
);

// Get cards in a specific set
cardsRouter.get(
  '/sets/:tcg/:setCode',
  asyncHandler(async (req, res) => {
    const { tcg, setCode } = req.params;
    const cards = await getSetCards(tcg, setCode);
    res.json({ cards, total: cards.length });
  })
);

cardsRouter.get(
  '/:tcg/:cardId/prints',
  asyncHandler(async (req, res) => {
    const { tcg, cardId } = cardParamsSchema.parse(req.params);
    const result = await getCardPrints({ tcg, cardId });
    res.json(result);
  })
);

cardsRouter.get(
  '/:tcg/:cardId',
  asyncHandler(async (req, res) => {
    const { tcg, cardId } = cardParamsSchema.parse(req.params);
    const adapter = adapterRegistry.get(tcg);
    const card = await adapter.fetchCardById(cardId);

    if (!card) {
      return res.status(404).json({ error: 'NOT_FOUND', message: 'Card not found' });
    }

    res.json({ card });
  })
);
