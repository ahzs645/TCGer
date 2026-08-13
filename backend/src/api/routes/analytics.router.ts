import { Router } from 'express';
import { requireAuth, type AuthRequest } from '../middleware/auth';
import { asyncHandler } from '../../utils/async-handler';
import * as analyticsService from '../../modules/analytics/analytics.service';
import { parseAnalyticsPeriod } from './analytics-period';

export const analyticsRouter = Router();

analyticsRouter.use(requireAuth);

// Collection value history
analyticsRouter.get(
  '/value',
  asyncHandler(async (req, res) => {
    const { id: userId } = (req as AuthRequest).user!;
    const days = parseAnalyticsPeriod(req.query.period);
    const tcg = typeof req.query.tcg === 'string' ? req.query.tcg : undefined;
    const history = await analyticsService.getCollectionValueHistory(userId, days, tcg);
    res.json(history);
  }),
);

// Collection value breakdown
analyticsRouter.get(
  '/value/breakdown',
  asyncHandler(async (req, res) => {
    const { id: userId } = (req as AuthRequest).user!;
    const breakdown = await analyticsService.getCollectionValueBreakdown(userId);
    res.json(breakdown);
  }),
);

// Collection distribution
analyticsRouter.get(
  '/distribution',
  asyncHandler(async (req, res) => {
    const { id: userId } = (req as AuthRequest).user!;
    const dimension = (req.query.by as string) || 'tcg';
    const tcg = typeof req.query.tcg === 'string' ? req.query.tcg : undefined;
    const distribution = await analyticsService.getCollectionDistribution(userId, dimension, tcg);
    res.json(distribution);
  }),
);

analyticsRouter.get(
  '/duplicates',
  asyncHandler(async (req, res) => {
    const { id: userId } = (req as AuthRequest).user!;
    const rawKeepCount = typeof req.query.keep === 'string' ? req.query.keep.trim() : '';
    const parsedKeepCount = /^\d+$/.test(rawKeepCount) ? Number.parseInt(rawKeepCount, 10) : 1;
    const keepCount = Math.min(100, Math.max(1, parsedKeepCount));
    const tcg = typeof req.query.tcg === 'string' ? req.query.tcg : undefined;
    const duplicates = await analyticsService.getCollectionDuplicates(userId, keepCount, tcg);
    res.json(duplicates);
  }),
);
