import { Router } from 'express';

import { requireAuth, type AuthRequest } from '../middleware/auth';
import { proxyToConvexHttp } from './convex-http.proxy';

export const convexCatalogCorrectionsRouter = Router();

convexCatalogCorrectionsRouter.use(requireAuth);
convexCatalogCorrectionsRouter.use((request, response, next) => {
  proxyToConvexHttp(request as AuthRequest, response).catch(next);
});
