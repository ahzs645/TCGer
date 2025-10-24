import { Router } from 'express';
import { z } from 'zod';

import { requireAuth, type AuthRequest } from '../middleware/auth';
import {
  getUserBinders,
  createBinder,
  updateBinder,
  deleteBinder,
  addCardToBinder,
  removeCardFromBinder
} from '../../modules/collections/collections.service';
import { asyncHandler } from '../../utils/async-handler';

export const collectionsRouter = Router();

const createBinderSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  description: z.string().optional()
});

const updateBinderSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().optional()
});

const addCardSchema = z.object({
  cardId: z.string().min(1, 'Card ID is required'),
  quantity: z.number().int().positive().default(1),
  condition: z.string().optional(),
  language: z.string().optional(),
  notes: z.string().optional(),
  price: z.number().optional(),
  acquisitionPrice: z.number().optional(),
  // Card data for creating card if it doesn't exist
  cardData: z.object({
    name: z.string(),
    tcg: z.string(),
    externalId: z.string(),
    setCode: z.string().optional(),
    setName: z.string().optional(),
    rarity: z.string().optional(),
    imageUrl: z.string().optional(),
    imageUrlSmall: z.string().optional()
  }).optional()
});

// Get all binders for the authenticated user
collectionsRouter.get(
  '/',
  requireAuth,
  asyncHandler(async (req, res) => {
    const userId = (req as AuthRequest).user!.id;
    const binders = await getUserBinders(userId);
    res.json(binders);
  })
);

// Create a new binder
collectionsRouter.post(
  '/',
  requireAuth,
  asyncHandler(async (req, res) => {
    const userId = (req as AuthRequest).user!.id;
    const data = createBinderSchema.parse(req.body);
    const binder = await createBinder(userId, data);
    res.status(201).json(binder);
  })
);

// Update a binder
collectionsRouter.patch(
  '/:binderId',
  requireAuth,
  asyncHandler(async (req, res) => {
    const userId = (req as AuthRequest).user!.id;
    const { binderId } = req.params;
    const data = updateBinderSchema.parse(req.body);

    try {
      const binder = await updateBinder(userId, binderId, data);
      res.json(binder);
    } catch (error) {
      if (error instanceof Error && error.message === 'Binder not found') {
        return res.status(404).json({ error: 'NOT_FOUND', message: 'Binder not found' });
      }
      throw error;
    }
  })
);

// Delete a binder
collectionsRouter.delete(
  '/:binderId',
  requireAuth,
  asyncHandler(async (req, res) => {
    const userId = (req as AuthRequest).user!.id;
    const { binderId } = req.params;

    try {
      await deleteBinder(userId, binderId);
      res.status(204).send();
    } catch (error) {
      if (error instanceof Error && error.message === 'Binder not found') {
        return res.status(404).json({ error: 'NOT_FOUND', message: 'Binder not found' });
      }
      throw error;
    }
  })
);

// Add a card to a binder
collectionsRouter.post(
  '/:binderId/cards',
  requireAuth,
  asyncHandler(async (req, res) => {
    const userId = (req as AuthRequest).user!.id;
    const { binderId } = req.params;
    const data = addCardSchema.parse(req.body);

    try {
      const collection = await addCardToBinder(userId, binderId, data);
      res.status(201).json(collection);
    } catch (error) {
      if (error instanceof Error && error.message === 'Binder not found') {
        return res.status(404).json({ error: 'NOT_FOUND', message: 'Binder not found' });
      }
      throw error;
    }
  })
);

// Remove a card from a binder
collectionsRouter.delete(
  '/:binderId/cards/:collectionId',
  requireAuth,
  asyncHandler(async (req, res) => {
    const userId = (req as AuthRequest).user!.id;
    const { binderId, collectionId } = req.params;

    try {
      await removeCardFromBinder(userId, binderId, collectionId);
      res.status(204).send();
    } catch (error) {
      if (error instanceof Error && error.message === 'Collection entry not found') {
        return res.status(404).json({ error: 'NOT_FOUND', message: 'Collection entry not found' });
      }
      throw error;
    }
  })
);
