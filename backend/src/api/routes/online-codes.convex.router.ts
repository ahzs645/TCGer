import { Router } from 'express';

import { requireAuth, type AuthRequest } from '../middleware/auth';
import { proxyToConvexHttp } from './convex-http.proxy';

export const convexOnlineCodesRouter = Router();

convexOnlineCodesRouter.use(requireAuth);
convexOnlineCodesRouter.use((req, res, next) => {
  proxyToConvexHttp(req as AuthRequest, res).catch(next);
});
