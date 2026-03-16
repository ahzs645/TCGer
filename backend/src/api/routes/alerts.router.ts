import { Router } from 'express';
import { requireAuth, type AuthRequest } from '../middleware/auth';
import { asyncHandler } from '../../utils/async-handler';
import { createPriceAlertSchema, updatePriceAlertSchema } from '@tcg/api-types';
import * as alertsService from '../../modules/alerts/alerts.service';

export const alertsRouter = Router();

alertsRouter.use(requireAuth);

alertsRouter.get('/', asyncHandler(async (req, res) => {
  const { id: userId } = (req as AuthRequest).user!;
  const alerts = await alertsService.getUserAlerts(userId);
  res.json(alerts);
}));

alertsRouter.post('/', asyncHandler(async (req, res) => {
  const { id: userId } = (req as AuthRequest).user!;
  const input = createPriceAlertSchema.parse(req.body);
  const alert = await alertsService.createAlert(userId, input);
  res.status(201).json(alert);
}));

alertsRouter.patch('/:alertId', asyncHandler(async (req, res) => {
  const { id: userId } = (req as AuthRequest).user!;
  const input = updatePriceAlertSchema.parse(req.body);
  const alert = await alertsService.updateAlert(userId, req.params.alertId, input);
  res.json(alert);
}));

alertsRouter.delete('/:alertId', asyncHandler(async (req, res) => {
  const { id: userId } = (req as AuthRequest).user!;
  await alertsService.deleteAlert(userId, req.params.alertId);
  res.status(204).send();
}));
