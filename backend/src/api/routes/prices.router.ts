import { Router } from 'express';
import { requireAuth, type AuthRequest } from '../middleware/auth';
import { asyncHandler } from '../../utils/async-handler';
import { fetchLiveCardPrices } from '../../modules/pricing/live-pricing.service';
import { env } from '../../config/env';
import { priceSourceSchema, trackedPricesRequestSchema } from '@tcg/api-types';
import { trackedPricingService } from '../../modules/pricing/tracked-pricing.service';
import { getPriceSourceCatalog } from '../../modules/pricing/price-source-catalog';
import { buildProxyHeaders, proxyToConvexHttp } from './convex-http.proxy';

function snapshotsFromTracked(
  prices: Awaited<ReturnType<typeof trackedPricingService.getTrackedPrices>>['prices'],
) {
  return prices.flatMap((result) => {
    if (!result.price || !result.currency || !result.source || !result.updatedAt) return [];
    const provenance = result.provenance;
    const common = {
      tcg: result.tcg,
      externalId: result.externalId,
      finishCode: result.finishCode,
      capturedAt: Date.now(),
      sourceUpdatedAt: Date.parse(result.updatedAt),
      fxRate: provenance?.fx?.rate,
      fxSource: provenance?.fx?.source,
      fxAsOf: provenance?.fx?.asOf,
      matchMethod: provenance?.match?.method,
      matchConfidence: provenance?.match?.confidence,
      providerProductId: provenance?.match?.providerProductId,
      language: result.language,
      provider: provenance?.provider,
    };
    const originals = provenance?.originalQuotes ?? [];
    if (originals.length) {
      return originals.map((quote) => ({
        ...common,
        source: quote.source,
        nativePrice: quote.amount,
        nativeCurrency: quote.currency,
        ...(quote.currency !== result.currency
          ? { convertedPrice: result.price, convertedCurrency: result.currency }
          : {}),
      }));
    }
    return [
      {
        ...common,
        source: result.source,
        nativePrice: result.price,
        nativeCurrency: result.currency,
      },
    ];
  });
}

export const pricesRouter = Router();

pricesRouter.use(requireAuth);

pricesRouter.get('/sources', (_req, res) => {
  res.json(getPriceSourceCatalog());
});

// Get price movers
pricesRouter.get(
  '/analytics/movers',
  asyncHandler(async (req, res) => {
    if (env.BACKEND_MODE === 'convex') {
      return proxyToConvexHttp(req as AuthRequest, res);
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
    const result = await trackedPricingService.getTrackedPrices(
      input.items,
      input.force,
      input.source,
    );
    if (env.BACKEND_MODE === 'convex') {
      const snapshots = snapshotsFromTracked(result.prices);
      if (snapshots.length) {
        try {
          const snapshotResponse = await fetch(new URL('/prices/snapshots', env.CONVEX_HTTP_ORIGIN), {
            method: 'POST',
            headers: buildProxyHeaders(req as AuthRequest),
            body: JSON.stringify({ snapshots }),
          });
          if (!snapshotResponse.ok) {
            throw new Error(`Snapshot persistence returned ${snapshotResponse.status}`);
          }
          const evaluationResponse = await fetch(new URL('/alerts/evaluate', env.CONVEX_HTTP_ORIGIN), {
            method: 'POST',
            headers: buildProxyHeaders(req as AuthRequest),
          });
          if (!evaluationResponse.ok) {
            throw new Error(`Alert evaluation returned ${evaluationResponse.status}`);
          }
        } catch (error) {
          console.error('[pricing] Failed to persist history or evaluate alerts:', error);
        }
      }
    }
    res.json(result);
  }),
);

// Get prices for a card from all providers
pricesRouter.get(
  '/:tcg/:cardId',
  asyncHandler(async (req, res) => {
    const { tcg, cardId } = req.params;
    const finishCode = typeof req.query.finish === 'string' ? req.query.finish : undefined;
    const parsedSource = priceSourceSchema.safeParse(req.query.source ?? 'automatic');
    const comparison = req.query.compare === 'true';
    if (!parsedSource.success) {
      return res.status(400).json({ message: 'Unsupported price source' });
    }
    const prices =
      env.BACKEND_MODE === 'convex'
        ? await fetchLiveCardPrices(tcg, cardId, finishCode, parsedSource.data, undefined, comparison)
        : await (
            await import('../../modules/pricing/pricing.service')
          ).fetchCardPrices(tcg, cardId, finishCode, parsedSource.data, undefined, comparison);
    res.json(prices);
  }),
);
