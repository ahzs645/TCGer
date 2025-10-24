import { Router } from 'express';
import { z } from 'zod';

import { requireAuth, type AuthRequest } from '../middleware/auth';
import { asyncHandler } from '../../utils/async-handler';
import { getUserPreferences, updateUserPreferences } from '../../modules/users/auth.service';

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
    showPricing: z.boolean().optional()
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
