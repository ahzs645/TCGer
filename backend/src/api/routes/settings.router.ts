import { Router } from 'express';
import { updateSettingsSchema } from '@tcg/api-types';

import { getAppSettings, updateAppSettings } from '../../modules/settings/settings.service';
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
  asyncHandler(async (req, res) => {
    // TODO: Add admin authorization check
    const data = updateSettingsSchema.parse(req.body);
    const settings = await updateAppSettings(data);
    res.json(settings);
  })
);
