import { Router } from 'express';
import { env } from '../../config/env';
import { requireAuth, type AuthRequest } from '../middleware/auth';
import { proxyToConvexHttp } from './convex-http.proxy';

export const backupsRouter = Router();
backupsRouter.use(requireAuth);
backupsRouter.use((_req, res, next) => {
  if (env.BACKEND_MODE !== 'convex') {
    res.status(409).json({ error: 'Portable server backups require the unified Convex backend. Export each legacy collection before migrating.' });
    return;
  }
  next();
});
backupsRouter.use((req, res, next) => proxyToConvexHttp(req as AuthRequest, res).catch(next));
