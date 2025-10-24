import { Router } from 'express';
import { z } from 'zod';

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

const updatePreferencesSchema = z
  .object({
    showCardNumbers: z.boolean().optional(),
    showPricing: z.boolean().optional(),
    enabledYugioh: z.boolean().optional(),
    enabledMagic: z.boolean().optional(),
    enabledPokemon: z.boolean().optional()
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: 'At least one preference must be provided'
  });

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

// Update user profile (username, email)
const updateProfileSchema = z
  .object({
    username: z.string().min(1).max(50).optional(),
    email: z.string().email().optional()
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: 'At least one field must be provided'
  });

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

// Change password
const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8, 'Password must be at least 8 characters')
});

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
