import type { Request, Response, NextFunction } from 'express';
import { fromNodeHeaders } from 'better-auth/node';

import { auth } from '../../lib/auth';

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
    const session = await auth.api.getSession({
      headers: fromNodeHeaders(req.headers)
    });
    if (session?.user) {
      const user = session.user as Record<string, unknown>;
      (req as AuthRequest).user = {
        id: user.id as string,
        email: user.email as string,
        username: (user.username as string) ?? null,
        isAdmin: (user.isAdmin as boolean) ?? false,
        showCardNumbers: (user.showCardNumbers as boolean) ?? true,
        showPricing: (user.showPricing as boolean) ?? true
      };
    }
  } catch {
    // ignore – user simply stays undefined
  }
  next();
}

export async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const session = await auth.api.getSession({
      headers: fromNodeHeaders(req.headers)
    });

    if (!session?.user) {
      res.status(401).json({ error: 'UNAUTHORIZED', message: 'Not authenticated' });
      return;
    }

    const user = session.user as Record<string, unknown>;
    (req as AuthRequest).user = {
      id: user.id as string,
      email: user.email as string,
      username: (user.username as string) ?? null,
      isAdmin: (user.isAdmin as boolean) ?? false,
      showCardNumbers: (user.showCardNumbers as boolean) ?? true,
      showPricing: (user.showPricing as boolean) ?? true
    };
    next();
  } catch (error) {
    res.status(401).json({ error: 'UNAUTHORIZED', message: 'Invalid or expired session' });
  }
}
