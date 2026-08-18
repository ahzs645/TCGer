import { Router } from 'express';

import { env } from '../../config/env';

export const healthRouter = Router();

export function getHealthResponse() {
  const supportsLegacyFeatures = env.BACKEND_MODE !== 'convex';

  return {
    status: 'ok' as const,
    env: env.NODE_ENV,
    mode: env.BACKEND_MODE,
    features: {
      decks: true,
      finance: true,
      sealed: true,
      analytics: true,
      trades: true,
      onlineCodes: true,
      prices: supportsLegacyFeatures,
      notifications: supportsLegacyFeatures,
      alerts: supportsLegacyFeatures,
      shops: supportsLegacyFeatures,
      automations: supportsLegacyFeatures,
      shipments: supportsLegacyFeatures,
      public: true,
    },
  };
}

healthRouter.get('/', (_req, res) => {
  res.json(getHealthResponse());
});

healthRouter.get('/ready', async (_req, res) => {
  try {
    const checks: Promise<unknown>[] = [];

    if (env.BACKEND_MODE !== 'convex') {
      checks.push(import('../../lib/prisma').then(({ prisma }) => prisma.$queryRaw`SELECT 1`));
    }

    checks.push(
      fetch(new URL('/health', env.CONVEX_HTTP_ORIGIN)).then((response) => {
        if (!response.ok) {
          throw new Error(`Convex returned ${response.status}`);
        }
      }),
    );

    await Promise.all(checks);
    res.json({ status: 'ready' });
  } catch (_error) {
    res.status(503).json({
      status: 'not_ready',
      message:
        env.BACKEND_MODE === 'convex'
          ? 'Convex backend unavailable'
          : 'One or more backing services are unavailable',
    });
  }
});
