import { Router } from 'express';

import { requireAuth, type AuthRequest } from '../middleware/auth';
import { asyncHandler } from '../../utils/async-handler';
import { proxyToConvexAuth, proxyToConvexHttp } from './convex-http.proxy';

export const usersRouter = Router();

usersRouter.get(
  '/me/preferences',
  requireAuth,
  asyncHandler(async (req, res) => {
    await proxyToConvexHttp(req as AuthRequest, res);
  })
);

usersRouter.patch(
  '/me/preferences',
  requireAuth,
  asyncHandler(async (req, res) => {
    await proxyToConvexHttp(req as AuthRequest, res);
  })
);

usersRouter.get(
  '/me',
  requireAuth,
  asyncHandler(async (req, res) => {
    await proxyToConvexHttp(req as AuthRequest, res);
  })
);

usersRouter.patch(
  '/me',
  requireAuth,
  asyncHandler(async (req, res) => {
    await proxyToConvexHttp(req as AuthRequest, res);
  })
);

usersRouter.post(
  '/me/change-password',
  requireAuth,
  asyncHandler(async (req, res) => {
    await proxyToConvexAuth(req, res, '/api/auth/change-password');
  })
);
