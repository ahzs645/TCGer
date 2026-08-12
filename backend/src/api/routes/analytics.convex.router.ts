import { Router } from 'express';

import { requireAuth, type AuthRequest } from '../middleware/auth';
import { parseAnalyticsPeriod } from './analytics-period';
import { proxyToConvexHttp } from './convex-http.proxy';

export const convexAnalyticsRouter = Router();

convexAnalyticsRouter.use(requireAuth);
convexAnalyticsRouter.get('/value', (req, res, next) => {
  const periodDays = parseAnalyticsPeriod(req.query.period);
  const params = new URLSearchParams({ period: String(periodDays) });
  if (typeof req.query.tcg === 'string') params.set('tcg', req.query.tcg);
  proxyToConvexHttp(req as AuthRequest, res, `/analytics/value?${params.toString()}`).catch(next);
});
convexAnalyticsRouter.use((req, res, next) => {
  proxyToConvexHttp(req as AuthRequest, res).catch(next);
});
