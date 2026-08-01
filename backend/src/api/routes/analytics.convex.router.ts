import { Router } from 'express';

import { requireAuth, type AuthRequest } from '../middleware/auth';
import { parseAnalyticsPeriod } from './analytics-period';
import { proxyToConvexHttp } from './convex-http.proxy';

export const convexAnalyticsRouter = Router();

convexAnalyticsRouter.use(requireAuth);
convexAnalyticsRouter.get('/value', (req, res, next) => {
  const periodDays = parseAnalyticsPeriod(req.query.period);
  proxyToConvexHttp(
    req as AuthRequest,
    res,
    `/analytics/value?period=${periodDays}`
  ).catch(next);
});
convexAnalyticsRouter.use((req, res, next) => {
  proxyToConvexHttp(req as AuthRequest, res).catch(next);
});
