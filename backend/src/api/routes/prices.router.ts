import { Router } from 'express';
import { requireAuth, type AuthRequest } from '../middleware/auth';
import { asyncHandler } from '../../utils/async-handler';
import * as pricingService from '../../modules/pricing/pricing.service';

export const pricesRouter = Router();

pricesRouter.use(requireAuth);

// Get prices for a card from all providers
pricesRouter.get('/:tcg/:cardId', asyncHandler(async (req, res) => {
  const { tcg, cardId } = req.params;
  const prices = await pricingService.fetchCardPrices(tcg, cardId);
  res.json(prices);
}));

// Get price movers
pricesRouter.get('/analytics/movers', asyncHandler(async (req, res) => {
  const tcg = req.query.tcg as string | undefined;
  const period = parseInt(req.query.period as string) || 7;
  const movers = await pricingService.getPriceAnalyticsMovers(tcg, period);
  res.json(movers);
}));
