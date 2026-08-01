import { Router } from 'express';

import type { AuthRequest } from '../middleware/auth';
import { proxyToConvexHttp } from './convex-http.proxy';

export const convexPublicRouter = Router();

convexPublicRouter.use((req, res, next) => {
  proxyToConvexHttp(req as AuthRequest, res).catch(next);
});
