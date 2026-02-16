import { Router } from 'express';

import { env } from '../../config/env';
import { prisma } from '../../lib/prisma';

export const healthRouter = Router();

healthRouter.get('/', (_req, res) => {
  res.json({
    status: 'ok',
    env: env.NODE_ENV
  });
});

healthRouter.get('/ready', async (_req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ status: 'ready' });
  } catch (_error) {
    res.status(503).json({ status: 'not_ready', message: 'Database unavailable' });
  }
});
