import { Router } from 'express';
import { gradedPriceEstimateInputSchema, psaCertLookupResponseSchema } from '@tcg/api-types';
import { env } from '../../config/env';
import { requireAuth, type AuthRequest } from '../middleware/auth';
import { asyncHandler } from '../../utils/async-handler';
import { fetchGradedPrice } from '../../modules/grading/graded-price.service';
import { GradingProviderError, lookupPsaCert } from '../../modules/grading/psa.service';
import { buildProxyHeaders } from './convex-http.proxy';

async function readPersistentPsaCache(req: AuthRequest, certNumber: string) {
  if (env.BACKEND_MODE !== 'convex') return null;
  const response = await fetch(
    new URL(
      `/provider-cache/psa/${encodeURIComponent(certNumber.replace(/\D/g, ''))}`,
      env.CONVEX_HTTP_ORIGIN,
    ),
    { headers: buildProxyHeaders(req) },
  );
  if (!response.ok) return null;
  const parsed = psaCertLookupResponseSchema.safeParse(await response.json());
  return parsed.success ? parsed.data : null;
}

async function writePersistentPsaCache(req: AuthRequest, result: unknown) {
  if (env.BACKEND_MODE !== 'convex') return;
  const parsed = psaCertLookupResponseSchema.safeParse(result);
  if (!parsed.success) return;
  const headers = buildProxyHeaders(req);
  headers.set('Content-Type', 'application/json');
  await fetch(
    new URL(
      `/provider-cache/psa/${encodeURIComponent(parsed.data.certNumber)}`,
      env.CONVEX_HTTP_ORIGIN,
    ),
    { method: 'PUT', headers, body: JSON.stringify(parsed.data) },
  );
}

export const gradingRouter = Router();
gradingRouter.use(requireAuth);

gradingRouter.get(
  '/psa/certs/:certNumber',
  asyncHandler(async (req, res) => {
    try {
      const authReq = req as AuthRequest;
      const persisted = await readPersistentPsaCache(authReq, req.params.certNumber).catch(
        () => null,
      );
      if (persisted && Date.parse(persisted.refreshAfter) > Date.now()) {
        return res.json({ ...persisted, cached: true });
      }
      let result;
      try {
        result = await lookupPsaCert(req.params.certNumber);
      } catch (error) {
        if (persisted && error instanceof GradingProviderError && error.status >= 500) {
          return res.json({ ...persisted, cached: true, stale: true });
        }
        throw error;
      }
      await writePersistentPsaCache(authReq, result).catch((error) => {
        console.error('[grading] Failed to persist PSA cert cache:', error);
      });
      res.json(result);
    } catch (error) {
      if (error instanceof GradingProviderError) {
        return res
          .status(error.status)
          .json({ error: 'GRADING_PROVIDER_ERROR', message: error.message });
      }
      throw error;
    }
  }),
);

gradingRouter.post(
  '/graded-price',
  asyncHandler(async (req, res) => {
    try {
      res.json(await fetchGradedPrice(gradedPriceEstimateInputSchema.parse(req.body)));
    } catch (error) {
      if (error instanceof GradingProviderError) {
        return res
          .status(error.status)
          .json({ error: 'GRADING_PROVIDER_ERROR', message: error.message });
      }
      throw error;
    }
  }),
);
