import { Router } from 'express';
import { requireAuth, type AuthRequest } from '../middleware/auth';
import { asyncHandler } from '../../utils/async-handler';
import { proxyToConvexAuth, proxyToConvexHttp } from './convex-http.proxy';

export const setupRouter = Router();
export const authRouter = Router();

setupRouter.get(
  '/setup-required',
  asyncHandler(async (req, res) => {
    await proxyToConvexHttp(req as AuthRequest, res);
  })
);

setupRouter.post(
  '/setup',
  requireAuth,
  asyncHandler(async (req, res) => {
    await proxyToConvexHttp(req as AuthRequest, res);
  })
);

authRouter.use(
  '/',
  asyncHandler(async (req, res) => {
    await proxyToConvexAuth(req, res);
  })
);
