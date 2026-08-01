import { Router, type RequestHandler } from 'express';

import { requireAuth } from '../middleware/auth';

export function notImplementedHandler(feature: string): RequestHandler {
  return (_req, res) => {
    res.status(501).json({
      error: 'NOT_IMPLEMENTED',
      message: `${feature} is not available on the Convex backend yet`
    });
  };
}

export function createNotImplementedRouter(feature: string) {
  const router = Router();
  router.use(requireAuth);
  router.use(notImplementedHandler(feature));
  return router;
}
