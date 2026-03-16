import { Router } from 'express';
import { requireAuth, type AuthRequest } from '../middleware/auth';
import { asyncHandler } from '../../utils/async-handler';
import { createSealedInventorySchema, updateSealedInventorySchema } from '@tcg/api-types';
import * as sealedService from '../../modules/sealed/sealed.service';

export const sealedRouter = Router();

sealedRouter.use(requireAuth);

// Products catalog
sealedRouter.get('/products', asyncHandler(async (req, res) => {
  const tcg = req.query.tcg as string | undefined;
  const products = await sealedService.getSealedProducts(tcg);
  res.json(products);
}));

// Pack opening simulation
sealedRouter.post('/open-pack', asyncHandler(async (req, res) => {
  const { tcg, setCode } = req.body;
  const result = await sealedService.simulatePackOpening(tcg, setCode);
  res.json(result);
}));

// Sealed inventory
sealedRouter.get('/inventory', asyncHandler(async (req, res) => {
  const { id: userId } = (req as AuthRequest).user!;
  const inventory = await sealedService.getUserSealedInventory(userId);
  res.json(inventory);
}));

sealedRouter.post('/inventory', asyncHandler(async (req, res) => {
  const { id: userId } = (req as AuthRequest).user!;
  const input = createSealedInventorySchema.parse(req.body);
  const item = await sealedService.addSealedInventory(userId, input);
  res.status(201).json(item);
}));

sealedRouter.patch('/inventory/:itemId', asyncHandler(async (req, res) => {
  const { id: userId } = (req as AuthRequest).user!;
  const input = updateSealedInventorySchema.parse(req.body);
  const item = await sealedService.updateSealedInventory(userId, req.params.itemId, input);
  res.json(item);
}));

sealedRouter.delete('/inventory/:itemId', asyncHandler(async (req, res) => {
  const { id: userId } = (req as AuthRequest).user!;
  await sealedService.deleteSealedInventory(userId, req.params.itemId);
  res.status(204).send();
}));
