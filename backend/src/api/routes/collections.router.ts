import { Router } from 'express';
import {
  createBinderSchema,
  updateBinderSchema,
  addCardSchema,
  addLibraryCardSchema,
  updateCardSchema,
  tagPayloadSchema
} from '@tcg/api-types';

import { requireAuth, type AuthRequest } from '../middleware/auth';
import {
  getUserBinders,
  getUserBinder,
  createBinder,
  updateBinder,
  deleteBinder,
  addCardToBinder,
  addCardToLibrary,
  removeCardFromBinder,
  updateCardInBinder,
  getUserTags,
  createUserTag
} from '../../modules/collections/collections.service';
import { asyncHandler } from '../../utils/async-handler';

export const collectionsRouter = Router();

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

// Tag management
collectionsRouter.get(
  '/tags',
  requireAuth,
  asyncHandler(async (req, res) => {
    const userId = (req as AuthRequest).user!.id;
    const tags = await getUserTags(userId);
    res.json(tags);
  })
);

collectionsRouter.post(
  '/tags',
  requireAuth,
  asyncHandler(async (req, res) => {
    const userId = (req as AuthRequest).user!.id;
    const data = tagPayloadSchema.parse(req.body);
    const tag = await createUserTag(userId, data);
    res.status(201).json(tag);
  })
);

// Get a single binder (or library pseudo-binder) for the authenticated user
collectionsRouter.get(
  '/:binderId',
  requireAuth,
  asyncHandler(async (req, res) => {
    const userId = (req as AuthRequest).user!.id;
    const { binderId } = req.params;

    try {
      const binder = await getUserBinder(userId, binderId);
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

// Add a card to library (no binder)
collectionsRouter.post(
  '/cards',
  requireAuth,
  asyncHandler(async (req, res) => {
    const userId = (req as AuthRequest).user!.id;
    const data = addLibraryCardSchema.parse(req.body);

    const collection = await addCardToLibrary(userId, data);
    res.status(201).json(collection);
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

// Update a card inside a binder
collectionsRouter.patch(
  '/:binderId/cards/:collectionId',
  requireAuth,
  asyncHandler(async (req, res) => {
    const userId = (req as AuthRequest).user!.id;
    const { binderId, collectionId } = req.params;
    const data = updateCardSchema.parse(req.body);

    try {
      const card = await updateCardInBinder(userId, binderId, collectionId, data);
      res.json(card);
    } catch (error) {
      if (error instanceof Error && error.message === 'Collection entry not found') {
        return res.status(404).json({ error: 'NOT_FOUND', message: 'Collection entry not found' });
      }
      throw error;
    }
  })
);
