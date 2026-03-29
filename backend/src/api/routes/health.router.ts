import { Router } from 'express';

import { env } from '../../config/env';

export const healthRouter = Router();

healthRouter.get('/', (_req, res) => {
  res.json({
    status: 'ok',
    env: env.NODE_ENV
  });
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
      })
    );

    await Promise.all(checks);
    res.json({ status: 'ready' });
  } catch (_error) {
    res.status(503).json({
      status: 'not_ready',
      message:
        env.BACKEND_MODE === 'convex'
          ? 'Convex backend unavailable'
          : 'One or more backing services are unavailable'
    });
  }
});
