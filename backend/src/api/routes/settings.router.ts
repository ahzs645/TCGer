import { Router } from 'express';
import { updateSettingsSchema } from '@tcg/api-types';

import { getAppSettings, updateAppSettings, stripApiKeys } from '../../modules/settings/settings.service';
import { requireAuth, optionalAuth, type AuthRequest } from '../middleware/auth';
import { asyncHandler } from '../../utils/async-handler';

export const settingsRouter = Router();

settingsRouter.get(
  '/',
  optionalAuth,
  asyncHandler(async (req, res) => {
    const settings = await getAppSettings();
    const user = (req as AuthRequest).user;
    // Only admins see API key fields
    if (user?.isAdmin) {
      res.json(settings);
    } else {
      res.json(stripApiKeys(settings as unknown as Record<string, unknown>));
    }
  })
);

settingsRouter.patch(
  '/',
  requireAuth,
  asyncHandler(async (req, res) => {
    const user = (req as AuthRequest).user;
    if (!user?.isAdmin) {
      res.status(403).json({ error: 'FORBIDDEN', message: 'Admin access required' });
      return;
    }

    const data = updateSettingsSchema.parse(req.body);
    const settings = await updateAppSettings(data);
    res.json(settings);
  })
);
