import { Router } from 'express';
import {
  updatePreferencesSchema,
  updateProfileSchema,
  changePasswordSchema
} from '@tcg/api-types';

import { requireAuth, type AuthRequest } from '../middleware/auth';
import { asyncHandler } from '../../utils/async-handler';
import {
  getUserPreferences,
  updateUserPreferences,
  updateUserProfile,
  changePassword,
  getUserById
} from '../../modules/users/auth.service';

export const usersRouter = Router();

usersRouter.get(
  '/me/preferences',
  requireAuth,
  asyncHandler(async (req, res) => {
    const user = (req as AuthRequest).user;
    if (!user) {
      res.status(401).json({ error: 'UNAUTHORIZED', message: 'User not authenticated' });
      return;
    }

    const preferences = await getUserPreferences(user.id);
    res.json(preferences);
  })
);

usersRouter.patch(
  '/me/preferences',
  requireAuth,
  asyncHandler(async (req, res) => {
    const user = (req as AuthRequest).user;
    if (!user) {
      res.status(401).json({ error: 'UNAUTHORIZED', message: 'User not authenticated' });
      return;
    }

    const data = updatePreferencesSchema.parse(req.body);
    const preferences = await updateUserPreferences(user.id, data);
    res.json(preferences);
  })
);

// Get current user profile
usersRouter.get(
  '/me',
  requireAuth,
  asyncHandler(async (req, res) => {
    const user = (req as AuthRequest).user;
    if (!user) {
      res.status(401).json({ error: 'UNAUTHORIZED', message: 'User not authenticated' });
      return;
    }

    const profile = await getUserById(user.id);
    res.json(profile);
  })
);

usersRouter.patch(
  '/me',
  requireAuth,
  asyncHandler(async (req, res) => {
    const user = (req as AuthRequest).user;
    if (!user) {
      res.status(401).json({ error: 'UNAUTHORIZED', message: 'User not authenticated' });
      return;
    }

    const data = updateProfileSchema.parse(req.body);
    const updatedUser = await updateUserProfile(user.id, data);
    res.json(updatedUser);
  })
);

usersRouter.post(
  '/me/change-password',
  requireAuth,
  asyncHandler(async (req, res) => {
    const user = (req as AuthRequest).user;
    if (!user) {
      res.status(401).json({ error: 'UNAUTHORIZED', message: 'User not authenticated' });
      return;
    }

    const data = changePasswordSchema.parse(req.body);
    const result = await changePassword(user.id, data);
    res.json(result);
  })
);
