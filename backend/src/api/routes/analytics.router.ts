import { Router } from 'express';
import { requireAuth, type AuthRequest } from '../middleware/auth';
import { asyncHandler } from '../../utils/async-handler';
import * as analyticsService from '../../modules/analytics/analytics.service';

export const analyticsRouter = Router();

analyticsRouter.use(requireAuth);

// Collection value history
analyticsRouter.get('/value', asyncHandler(async (req, res) => {
  const { id: userId } = (req as AuthRequest).user!;
  const period = req.query.period as string || '30d';
  const days = parseInt(period) || 30;
  const history = await analyticsService.getCollectionValueHistory(userId, days);
  res.json(history);
}));

// Collection value breakdown
analyticsRouter.get('/value/breakdown', asyncHandler(async (req, res) => {
  const { id: userId } = (req as AuthRequest).user!;
  const breakdown = await analyticsService.getCollectionValueBreakdown(userId);
  res.json(breakdown);
}));

// Collection distribution
analyticsRouter.get('/distribution', asyncHandler(async (req, res) => {
  const { id: userId } = (req as AuthRequest).user!;
  const dimension = (req.query.by as string) || 'tcg';
  const distribution = await analyticsService.getCollectionDistribution(userId, dimension);
  res.json(distribution);
}));
