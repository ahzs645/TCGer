import { Router } from 'express';
import { z } from 'zod';

import { getAppSettings, updateAppSettings } from '../../modules/settings/settings.service';
import { asyncHandler } from '../../utils/async-handler';

export const settingsRouter = Router();

const updateSettingsSchema = z.object({
  publicDashboard: z.boolean().optional(),
  publicCollections: z.boolean().optional(),
  requireAuth: z.boolean().optional(),
  appName: z.string().optional()
});

settingsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const settings = await getAppSettings();
    res.json(settings);
  })
);

settingsRouter.patch(
  '/',
  asyncHandler(async (req, res) => {
    // TODO: Add admin authorization check
    const data = updateSettingsSchema.parse(req.body);
    const settings = await updateAppSettings(data);
    res.json(settings);
  })
);
