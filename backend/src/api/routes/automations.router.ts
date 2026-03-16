import { Router } from 'express';
import { requireAuth, type AuthRequest } from '../middleware/auth';
import { asyncHandler } from '../../utils/async-handler';
import { createAutomationSchema, updateAutomationSchema } from '@tcg/api-types';
import * as automationsService from '../../modules/automations/automations.service';

export const automationsRouter = Router();

automationsRouter.use(requireAuth);

automationsRouter.get('/', asyncHandler(async (req, res) => {
  const { id: userId } = (req as AuthRequest).user!;
  const automations = await automationsService.getUserAutomations(userId);
  res.json(automations);
}));

automationsRouter.post('/', asyncHandler(async (req, res) => {
  const { id: userId } = (req as AuthRequest).user!;
  const input = createAutomationSchema.parse(req.body);
  const automation = await automationsService.createAutomation(userId, input);
  res.status(201).json(automation);
}));

automationsRouter.patch('/:automationId', asyncHandler(async (req, res) => {
  const { id: userId } = (req as AuthRequest).user!;
  const input = updateAutomationSchema.parse(req.body);
  const automation = await automationsService.updateAutomation(userId, req.params.automationId, input);
  res.json(automation);
}));

automationsRouter.delete('/:automationId', asyncHandler(async (req, res) => {
  const { id: userId } = (req as AuthRequest).user!;
  await automationsService.deleteAutomation(userId, req.params.automationId);
  res.status(204).send();
}));
