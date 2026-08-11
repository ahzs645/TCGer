import { Router } from 'express';

import { requireAuth, type AuthRequest } from '../middleware/auth';
import { enrichCollectionCardPrice } from '../../modules/pricing/collection-price-enrichment';
import { proxyToConvexHttp } from './convex-http.proxy';

export const convexCollectionsRouter = Router();

convexCollectionsRouter.use(requireAuth);
convexCollectionsRouter.use((req, _res, next) => {
  const isCardAdd =
    req.method === 'POST' && /^\/(?:cards|[^/]+\/cards)$/.test(req.path);
  if (!isCardAdd || !req.body || typeof req.body !== 'object') {
    next();
    return;
  }

  enrichCollectionCardPrice(req.body)
    .then((body) => {
      req.body = body;
      next();
    })
    .catch(next);
});
convexCollectionsRouter.use((req, res, next) => {
  proxyToConvexHttp(req as AuthRequest, res).catch(next);
});
