import type { Request, Response, NextFunction } from 'express';

import { verifyToken, getUserById } from '../../modules/users/auth.service';

export interface AuthRequest extends Request {
  user?: {
    id: string;
    email: string;
    username?: string | null;
    isAdmin: boolean;
    showCardNumbers: boolean;
    showPricing: boolean;
  };
}

/** Attach user if token present, but don't block unauthenticated requests */
export async function optionalAuth(req: Request, _res: Response, next: NextFunction): Promise<void> {
  try {
    const authHeader = req.headers.authorization;
    if (authHeader?.startsWith('Bearer ')) {
      const token = authHeader.substring(7);
      const { userId } = await verifyToken(token);
      (req as AuthRequest).user = await getUserById(userId);
    }
  } catch {
    // ignore – user simply stays undefined
  }
  next();
}

export async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      res.status(401).json({ error: 'UNAUTHORIZED', message: 'No token provided' });
      return;
    }

    const token = authHeader.substring(7);
    const { userId } = await verifyToken(token);
    const user = await getUserById(userId);

    (req as AuthRequest).user = user;
    next();
  } catch (error) {
    res.status(401).json({ error: 'UNAUTHORIZED', message: 'Invalid or expired token' });
  }
}
