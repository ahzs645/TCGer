import { Router } from 'express';
import {
  createWishlistSchema,
  updateWishlistSchema,
  addWishlistCardSchema
} from '@tcg/api-types';

import { requireAuth, type AuthRequest } from '../middleware/auth';
import {
  getUserWishlists,
  getUserWishlist,
  createWishlist,
  updateWishlist,
  deleteWishlist,
  addCardToWishlist,
  removeCardFromWishlist
} from '../../modules/wishlists/wishlists.service';
import { asyncHandler } from '../../utils/async-handler';

export const wishlistsRouter = Router();

// Get all wishlists for the authenticated user
wishlistsRouter.get(
  '/',
  requireAuth,
  asyncHandler(async (req, res) => {
    const userId = (req as AuthRequest).user!.id;
    const wishlists = await getUserWishlists(userId);
    res.json(wishlists);
  })
);

// Create a new wishlist
wishlistsRouter.post(
  '/',
  requireAuth,
  asyncHandler(async (req, res) => {
    const userId = (req as AuthRequest).user!.id;
    const data = createWishlistSchema.parse(req.body);
    const wishlist = await createWishlist(userId, data);
    res.status(201).json(wishlist);
  })
);

// Get a single wishlist
wishlistsRouter.get(
  '/:wishlistId',
  requireAuth,
  asyncHandler(async (req, res) => {
    const userId = (req as AuthRequest).user!.id;
    const { wishlistId } = req.params;

    try {
      const wishlist = await getUserWishlist(userId, wishlistId);
      res.json(wishlist);
    } catch (error) {
      if (error instanceof Error && error.message === 'Wishlist not found') {
        return res.status(404).json({ error: 'NOT_FOUND', message: 'Wishlist not found' });
      }
      throw error;
    }
  })
);

// Update a wishlist
wishlistsRouter.patch(
  '/:wishlistId',
  requireAuth,
  asyncHandler(async (req, res) => {
    const userId = (req as AuthRequest).user!.id;
    const { wishlistId } = req.params;
    const data = updateWishlistSchema.parse(req.body);

    try {
      const wishlist = await updateWishlist(userId, wishlistId, data);
      res.json(wishlist);
    } catch (error) {
      if (error instanceof Error && error.message === 'Wishlist not found') {
        return res.status(404).json({ error: 'NOT_FOUND', message: 'Wishlist not found' });
      }
      throw error;
    }
  })
);

// Delete a wishlist
wishlistsRouter.delete(
  '/:wishlistId',
  requireAuth,
  asyncHandler(async (req, res) => {
    const userId = (req as AuthRequest).user!.id;
    const { wishlistId } = req.params;

    try {
      await deleteWishlist(userId, wishlistId);
      res.status(204).send();
    } catch (error) {
      if (error instanceof Error && error.message === 'Wishlist not found') {
        return res.status(404).json({ error: 'NOT_FOUND', message: 'Wishlist not found' });
      }
      throw error;
    }
  })
);

// Add a card to a wishlist
wishlistsRouter.post(
  '/:wishlistId/cards',
  requireAuth,
  asyncHandler(async (req, res) => {
    const userId = (req as AuthRequest).user!.id;
    const { wishlistId } = req.params;
    const data = addWishlistCardSchema.parse(req.body);

    try {
      const card = await addCardToWishlist(userId, wishlistId, data);
      res.status(201).json(card);
    } catch (error) {
      if (error instanceof Error && error.message === 'Wishlist not found') {
        return res.status(404).json({ error: 'NOT_FOUND', message: 'Wishlist not found' });
      }
      throw error;
    }
  })
);

// Remove a card from a wishlist
wishlistsRouter.delete(
  '/:wishlistId/cards/:cardId',
  requireAuth,
  asyncHandler(async (req, res) => {
    const userId = (req as AuthRequest).user!.id;
    const { wishlistId, cardId } = req.params;

    try {
      await removeCardFromWishlist(userId, wishlistId, cardId);
      res.status(204).send();
    } catch (error) {
      if (error instanceof Error && error.message === 'Wishlist not found') {
        return res.status(404).json({ error: 'NOT_FOUND', message: 'Wishlist not found' });
      }
      if (error instanceof Error && error.message === 'Wishlist card not found') {
        return res.status(404).json({ error: 'NOT_FOUND', message: 'Wishlist card not found' });
      }
      throw error;
    }
  })
);
