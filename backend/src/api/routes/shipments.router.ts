import { Router } from 'express';
import { requireAuth, type AuthRequest } from '../middleware/auth';
import { asyncHandler } from '../../utils/async-handler';
import { createShipmentSchema } from '@tcg/api-types';
import * as shippingService from '../../modules/shipping/shipping.service';

export const shipmentsRouter = Router();

shipmentsRouter.use(requireAuth);

shipmentsRouter.get('/', asyncHandler(async (req, res) => {
  const { id: userId } = (req as AuthRequest).user!;
  const shipments = await shippingService.getUserShipments(userId);
  res.json(shipments);
}));

shipmentsRouter.post('/', asyncHandler(async (req, res) => {
  const { id: userId } = (req as AuthRequest).user!;
  const input = createShipmentSchema.parse(req.body);
  const shipment = await shippingService.createShipment(userId, input);
  res.status(201).json(shipment);
}));

shipmentsRouter.get('/:shipmentId/status', asyncHandler(async (req, res) => {
  const { id: userId } = (req as AuthRequest).user!;
  const status = await shippingService.getShipmentStatus(userId, req.params.shipmentId);
  res.json(status);
}));

shipmentsRouter.delete('/:shipmentId', asyncHandler(async (req, res) => {
  const { id: userId } = (req as AuthRequest).user!;
  await shippingService.deleteShipment(userId, req.params.shipmentId);
  res.status(204).send();
}));
