import { Router } from 'express';

import { env } from '../../config/env';
import { prisma } from '../../lib/prisma';
import { requireAuth, type AuthRequest } from '../middleware/auth';
import { asyncHandler } from '../../utils/async-handler';
import {
  fetchConvexAuth,
  proxyToConvexAuth,
  proxyToConvexHttp,
  sendProxyResponse,
} from './convex-http.proxy';

export const usersRouter = Router();

usersRouter.get(
  '/me/preferences',
  requireAuth,
  asyncHandler(async (req, res) => {
    await proxyToConvexHttp(req as AuthRequest, res);
  }),
);

usersRouter.patch(
  '/me/preferences',
  requireAuth,
  asyncHandler(async (req, res) => {
    await proxyToConvexHttp(req as AuthRequest, res);
  }),
);

usersRouter.get(
  '/me',
  requireAuth,
  asyncHandler(async (req, res) => {
    await proxyToConvexHttp(req as AuthRequest, res);
  }),
);

usersRouter.patch(
  '/me',
  requireAuth,
  asyncHandler(async (req, res) => {
    await proxyToConvexHttp(req as AuthRequest, res);
  }),
);

usersRouter.post(
  '/me/change-password',
  requireAuth,
  asyncHandler(async (req, res) => {
    await proxyToConvexAuth(req, res, '/api/auth/change-password');
  }),
);

usersRouter.delete(
  '/me',
  requireAuth,
  asyncHandler(async (req, res) => {
    if (env.SINGLE_USER_MODE) {
      res.status(400).json({ message: 'Single-user server accounts cannot be deleted.' });
      return;
    }

    const authRequest = req as AuthRequest;
    const proxyResponse = await fetchConvexAuth(req, '/api/auth/delete-user', 'POST');

    if (proxyResponse.ok && env.BACKEND_MODE !== 'convex' && authRequest.user) {
      await prisma.user.deleteMany({ where: { id: authRequest.user.id } });
    }

    await sendProxyResponse(proxyResponse, res);
  }),
);
