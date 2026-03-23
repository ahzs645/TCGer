import { Router } from 'express';
import { z } from 'zod';
import { updateSettingsSchema } from '@tcg/api-types';

import { env } from '../../config/env';
import { getAppSettings, updateAppSettings, stripApiKeys } from '../../modules/settings/settings.service';
import { requireAuth, optionalAuth, type AuthRequest } from '../middleware/auth';
import { asyncHandler } from '../../utils/async-handler';

export const settingsRouter = Router();

settingsRouter.get(
  '/source-defaults',
  requireAuth,
  asyncHandler(async (req, res) => {
    const user = (req as AuthRequest).user;
    if (!user?.isAdmin) {
      res.status(403).json({ error: 'FORBIDDEN', message: 'Admin access required' });
      return;
    }

    res.json({
      scryfall: { url: env.SCRYFALL_API_BASE_URL, label: 'Scryfall (Magic)' },
      yugioh: { url: env.YGO_API_BASE_URL, label: 'YGOPRODeck (Yu-Gi-Oh)' },
      pokemon: { url: env.POKEMON_API_BASE_URL, label: 'Scrydex (Pokémon)' },
      tcgdex: { url: env.TCGDEX_API_BASE_URL, label: 'TCGdex (Pokémon Variants)' },
    });
  })
);

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

const testSourceSchema = z.object({
  source: z.enum(['scryfall', 'yugioh', 'pokemon', 'tcgdex'])
});

settingsRouter.post(
  '/test-source',
  requireAuth,
  asyncHandler(async (req, res) => {
    const user = (req as AuthRequest).user;
    if (!user?.isAdmin) {
      res.status(403).json({ error: 'FORBIDDEN', message: 'Admin access required' });
      return;
    }

    const { source } = testSourceSchema.parse(req.body);
    const settings = await getAppSettings();
    const s = settings as Record<string, unknown>;

    let url: string;
    switch (source) {
      case 'scryfall': {
        const base = (s.scryfallApiBaseUrl as string) || env.SCRYFALL_API_BASE_URL;
        url = `${base}/cards/named?exact=Lightning+Bolt`;
        break;
      }
      case 'yugioh': {
        const base = (s.ygoApiBaseUrl as string) || env.YGO_API_BASE_URL;
        url = `${base}/cardinfo.php?name=Dark+Magician`;
        break;
      }
      case 'pokemon': {
        const base = (s.scrydexApiBaseUrl as string) || env.POKEMON_API_BASE_URL;
        const isScrydex = base.includes('scrydex');
        url = isScrydex
          ? `${base}/pokemon/v1/cards?q=name:pikachu&pageSize=1`
          : `${base}/cards?q=name:pikachu&pageSize=1`;
        break;
      }
      case 'tcgdex': {
        const base = (s.tcgdexApiBaseUrl as string) || env.TCGDEX_API_BASE_URL;
        url = `${base}/cards/swsh1-1`;
        break;
      }
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const start = Date.now();

    try {
      const response = await fetch(url, { signal: controller.signal });
      const latencyMs = Date.now() - start;
      if (response.ok) {
        res.json({ ok: true, latencyMs });
      } else {
        res.json({ ok: false, latencyMs, error: `HTTP ${response.status}` });
      }
    } catch (err: unknown) {
      const latencyMs = Date.now() - start;
      const message = err instanceof Error ? err.message : 'Unknown error';
      res.json({ ok: false, latencyMs, error: message });
    } finally {
      clearTimeout(timeout);
    }
  })
);
