import { Router } from 'express';
import { requireAuth, type AuthRequest } from '../middleware/auth';
import { asyncHandler } from '../../utils/async-handler';
import { createShopConnectionSchema } from '@tcg/api-types';
import * as shopService from '../../modules/shops/shop.service';

export const shopsRouter = Router();

shopsRouter.use(requireAuth);

shopsRouter.get('/connections', asyncHandler(async (req, res) => {
  const { id: userId } = (req as AuthRequest).user!;
  const connections = await shopService.getUserShopConnections(userId);
  res.json(connections);
}));

shopsRouter.post('/connections', asyncHandler(async (req, res) => {
  const { id: userId } = (req as AuthRequest).user!;
  const input = createShopConnectionSchema.parse(req.body);
  const conn = await shopService.createShopConnection(userId, input);
  res.status(201).json(conn);
}));

shopsRouter.delete('/connections/:connectionId', asyncHandler(async (req, res) => {
  const { id: userId } = (req as AuthRequest).user!;
  await shopService.deleteShopConnection(userId, req.params.connectionId);
  res.status(204).send();
}));

shopsRouter.post('/sync/:connectionId', asyncHandler(async (req, res) => {
  const { id: userId } = (req as AuthRequest).user!;
  const result = await shopService.syncShopStock(userId, req.params.connectionId);
  res.json(result);
}));
