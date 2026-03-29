import { Router } from 'express';
import { requireAuth, optionalAuth, type AuthRequest } from '../middleware/auth';
import { asyncHandler } from '../../utils/async-handler';
import { proxyToConvexHttp } from './convex-http.proxy';

export const settingsRouter = Router();

settingsRouter.get(
  '/source-defaults',
  requireAuth,
  asyncHandler(async (req, res) => {
    await proxyToConvexHttp(req as AuthRequest, res);
  })
);

settingsRouter.get(
  '/',
  optionalAuth,
  asyncHandler(async (req, res) => {
    await proxyToConvexHttp(req as AuthRequest, res);
  })
);

settingsRouter.patch(
  '/',
  requireAuth,
  asyncHandler(async (req, res) => {
    await proxyToConvexHttp(req as AuthRequest, res);
  })
);

settingsRouter.post(
  '/test-source',
  requireAuth,
  asyncHandler(async (req, res) => {
    await proxyToConvexHttp(req as AuthRequest, res);
  })
);
