import { Router } from 'express';
import {
  createBinderSchema,
  updateBinderSchema,
  addCardSchema,
  addLibraryCardSchema,
  updateCardSchema,
  tagPayloadSchema,
  exportFormatSchema
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
  createUserTag,
  addImageToCollection,
  removeImageFromCollection
} from '../../modules/collections/collections.service';
import { exportCollectionAsJson, exportCollectionAsCsv } from '../../modules/collections/export.service';
import { asyncHandler } from '../../utils/async-handler';
import { uploadImages, getImagePublicPath, deleteImageFile } from '../../utils/upload';

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

// Export collection as JSON or CSV
collectionsRouter.get(
  '/export',
  requireAuth,
  asyncHandler(async (req, res) => {
    const userId = (req as AuthRequest).user!.id;
    const format = exportFormatSchema.parse(req.query.format ?? 'json');

    if (format === 'csv') {
      const csv = await exportCollectionAsCsv(userId);
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', 'attachment; filename="collection-export.csv"');
      res.send(csv);
    } else {
      const data = await exportCollectionAsJson(userId);
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Content-Disposition', 'attachment; filename="collection-export.json"');
      res.json(data);
    }
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

// Upload images to a collection card copy
collectionsRouter.post(
  '/:binderId/cards/:collectionId/images',
  requireAuth,
  uploadImages.array('images', 5),
  asyncHandler(async (req, res) => {
    const userId = (req as AuthRequest).user!.id;
    const { collectionId } = req.params;
    const files = req.files as Express.Multer.File[];

    if (!files?.length) {
      return res.status(400).json({ error: 'BAD_REQUEST', message: 'No images provided' });
    }

    try {
      let imageUrls: string[] = [];
      for (const file of files) {
        const publicPath = getImagePublicPath(file.filename);
        imageUrls = await addImageToCollection(userId, collectionId, publicPath);
      }
      res.status(201).json({ imageUrls });
    } catch (error) {
      // Clean up uploaded files on error
      for (const file of files) {
        deleteImageFile(getImagePublicPath(file.filename));
      }
      if (error instanceof Error && error.message === 'Collection entry not found') {
        return res.status(404).json({ error: 'NOT_FOUND', message: 'Collection entry not found' });
      }
      throw error;
    }
  })
);

// Delete an image from a collection card copy
collectionsRouter.delete(
  '/:binderId/cards/:collectionId/images/:imageIndex',
  requireAuth,
  asyncHandler(async (req, res) => {
    const userId = (req as AuthRequest).user!.id;
    const { collectionId, imageIndex } = req.params;

    try {
      const removedUrl = await removeImageFromCollection(userId, collectionId, parseInt(imageIndex, 10));
      deleteImageFile(removedUrl);
      res.status(204).send();
    } catch (error) {
      if (error instanceof Error && (error.message === 'Collection entry not found' || error.message === 'Image index out of range')) {
        return res.status(404).json({ error: 'NOT_FOUND', message: error.message });
      }
      throw error;
    }
  })
);
