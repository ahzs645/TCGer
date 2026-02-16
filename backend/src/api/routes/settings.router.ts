import { Router } from 'express';
import { updateSettingsSchema } from '@tcg/api-types';

import { getAppSettings, updateAppSettings } from '../../modules/settings/settings.service';
import { requireAuth, type AuthRequest } from '../middleware/auth';
import { asyncHandler } from '../../utils/async-handler';

export const settingsRouter = Router();

settingsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const settings = await getAppSettings();
    res.json(settings);
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
