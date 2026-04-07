import type { Request, Response, NextFunction } from 'express';

import { env } from '../../config/env';
import { getSingleUserSessionUser } from '../../lib/single-user';

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

interface SessionUser {
  id: string;
  email: string;
  username?: string | null;
  isAdmin?: boolean;
  showCardNumbers?: boolean;
  showPricing?: boolean;
}

function buildSessionHeaders(req: Request) {
  const headers = new Headers();
  const authorization = req.header('authorization');
  const cookie = req.header('cookie');

  if (authorization) {
    headers.set('Authorization', authorization);
  }
  if (cookie) {
    headers.set('Cookie', cookie);
  }

  return headers;
}

export async function getSessionUserFromRequest(req: Request): Promise<SessionUser | null> {
  if (env.SINGLE_USER_MODE) {
    return getSingleUserSessionUser();
  }

  const response = await fetch(new URL('/api/auth/get-session', env.CONVEX_HTTP_ORIGIN), {
    method: 'GET',
    headers: buildSessionHeaders(req)
  });

  if (!response.ok) {
    return null;
  }

  const session = (await response.json().catch(() => null)) as { user?: SessionUser } | null;
  return session?.user ?? null;
}

/** Attach user if token present, but don't block unauthenticated requests */
export async function optionalAuth(req: Request, _res: Response, next: NextFunction): Promise<void> {
  try {
    const user = await getSessionUserFromRequest(req);
    if (user) {
      (req as AuthRequest).user = {
        id: user.id,
        email: user.email,
        username: user.username ?? null,
        isAdmin: user.isAdmin ?? false,
        showCardNumbers: user.showCardNumbers ?? true,
        showPricing: user.showPricing ?? true
      };
    }
  } catch {
    // ignore – user simply stays undefined
  }
  next();
}

export async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const user = await getSessionUserFromRequest(req);

    if (!user) {
      res.status(401).json({ error: 'UNAUTHORIZED', message: 'Not authenticated' });
      return;
    }

    (req as AuthRequest).user = {
      id: user.id,
      email: user.email,
      username: user.username ?? null,
      isAdmin: user.isAdmin ?? false,
      showCardNumbers: user.showCardNumbers ?? true,
      showPricing: user.showPricing ?? true
    };
    next();
  } catch {
    res.status(401).json({ error: 'UNAUTHORIZED', message: 'Invalid or expired session' });
  }
}
