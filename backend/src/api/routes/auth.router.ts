import { Router } from 'express';
import { fromNodeHeaders } from 'better-auth/node';

import { auth } from '../../lib/auth';
import {
  hasAdminUser,
  setUserAsAdmin
} from '../../modules/users/auth.service';
import { asyncHandler } from '../../utils/async-handler';

// Custom setup endpoints — Better Auth handles sign-up/sign-in/sign-out at /auth/*
export const setupRouter = Router();

setupRouter.get(
  '/setup-required',
  asyncHandler(async (req, res) => {
    const setupRequired = !(await hasAdminUser());
    res.json({ setupRequired });
  })
);

setupRouter.post(
  '/setup',
  asyncHandler(async (req, res) => {
    // Check if admin already exists
    const adminExists = await hasAdminUser();
    if (adminExists) {
      res.status(409).json({ error: 'CONFLICT', message: 'Admin user already exists' });
      return;
    }

    // The user should already be signed up via Better Auth.
    // This endpoint promotes the current session user to admin.
    const session = await auth.api.getSession({
      headers: fromNodeHeaders(req.headers)
    });

    if (!session?.user) {
      res.status(401).json({ error: 'UNAUTHORIZED', message: 'Sign up first, then call setup' });
      return;
    }

    await setUserAsAdmin(session.user.id);
    res.status(200).json({ message: 'Admin account configured successfully' });
  })
);
