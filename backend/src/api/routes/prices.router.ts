import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import { asyncHandler } from '../../utils/async-handler';
import { fetchLiveCardPrices } from '../../modules/pricing/live-pricing.service';
import { env } from '../../config/env';
import { trackedPricesRequestSchema } from '@tcg/api-types';
import { trackedPricingService } from '../../modules/pricing/tracked-pricing.service';

export const pricesRouter = Router();

pricesRouter.use(requireAuth);

// Get price movers
pricesRouter.get(
  '/analytics/movers',
  asyncHandler(async (req, res) => {
    if (env.BACKEND_MODE === 'convex') {
      return res.status(501).json({
        error: 'NOT_IMPLEMENTED',
        message: 'Price-history analytics are not available in Convex mode yet',
      });
    }
    const tcg = req.query.tcg as string | undefined;
    const period = Math.min(365, Math.max(1, parseInt(req.query.period as string) || 7));
    const { getPriceAnalyticsMovers } = await import('../../modules/pricing/pricing.service');
    const movers = await getPriceAnalyticsMovers(tcg, period);
    res.json(movers);
  }),
);

// Refresh only the unique cards the client is actively tracking. This route
// intentionally precedes /:tcg/:cardId so "tracked" is not parsed as a game.
pricesRouter.post(
  '/tracked',
  asyncHandler(async (req, res) => {
    const input = trackedPricesRequestSchema.parse(req.body);
    res.json(await trackedPricingService.getTrackedPrices(input.items, input.force));
  }),
);

// Get prices for a card from all providers
pricesRouter.get(
  '/:tcg/:cardId',
  asyncHandler(async (req, res) => {
    const { tcg, cardId } = req.params;
    const finishCode = typeof req.query.finish === 'string' ? req.query.finish : undefined;
    const prices =
      env.BACKEND_MODE === 'convex'
        ? await fetchLiveCardPrices(tcg, cardId, finishCode)
        : await (
            await import('../../modules/pricing/pricing.service')
          ).fetchCardPrices(tcg, cardId, finishCode);
    res.json(prices);
  }),
);
