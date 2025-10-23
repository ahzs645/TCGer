import { Router } from 'express';

import { env } from '../../config/env';

export const healthRouter = Router();

healthRouter.get('/', (_req, res) => {
  res.json({
    status: 'ok',
    env: env.NODE_ENV
  });
});

healthRouter.get('/ready', (_req, res) => {
  // TODO: check dependencies (database, redis) once available
  res.json({ status: 'ready' });
});
