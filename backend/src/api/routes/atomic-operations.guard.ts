import type { RequestHandler } from 'express';
import { env } from '../../config/env';

/** Do not commit one half of an operation into a different provider's ledger. */
export const requireAtomicInventoryProvider: RequestHandler = (_req, res, next) => {
  if (env.BACKEND_MODE !== 'convex') {
    res.status(501).json({
      error: 'ATOMIC_OPERATION_UNAVAILABLE',
      message: 'This operation requires a fully Convex-backed server. No inventory or finance records were changed.',
    });
    return;
  }
  next();
};
