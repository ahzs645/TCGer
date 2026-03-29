import { Router } from 'express';

import { requireAuth, type AuthRequest } from '../middleware/auth';
import { proxyToConvexHttp } from './convex-http.proxy';

export const convexWishlistsRouter = Router();

convexWishlistsRouter.use(requireAuth);
convexWishlistsRouter.use((req, res, next) => {
  proxyToConvexHttp(req as AuthRequest, res).catch(next);
});
