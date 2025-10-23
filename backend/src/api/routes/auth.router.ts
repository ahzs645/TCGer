import { Router } from 'express';
import { z } from 'zod';

import {
  login,
  signup,
  verifyToken,
  getUserById,
  hasAdminUser,
  setupInitialAdmin
} from '../../modules/users/auth.service';
import { asyncHandler } from '../../utils/async-handler';

export const authRouter = Router();

const signupSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  username: z.string().optional()
});

const loginSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(1, 'Password is required')
});

authRouter.post(
  '/signup',
  asyncHandler(async (req, res) => {
    const data = signupSchema.parse(req.body);
    const result = await signup(data);
    res.status(201).json(result);
  })
);

authRouter.post(
  '/login',
  asyncHandler(async (req, res) => {
    const data = loginSchema.parse(req.body);
    const result = await login(data);
    res.json(result);
  })
);

authRouter.get(
  '/me',
  asyncHandler(async (req, res) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'UNAUTHORIZED', message: 'No token provided' });
    }

    const token = authHeader.substring(7);
    const { userId } = await verifyToken(token);
    const user = await getUserById(userId);

    res.json({ user });
  })
);

authRouter.post(
  '/logout',
  asyncHandler(async (req, res) => {
    // Since we're using JWT, logout is handled client-side by removing the token
    res.json({ message: 'Logged out successfully' });
  })
);

authRouter.get(
  '/setup-required',
  asyncHandler(async (req, res) => {
    const setupRequired = !(await hasAdminUser());
    res.json({ setupRequired });
  })
);

authRouter.post(
  '/setup',
  asyncHandler(async (req, res) => {
    const data = signupSchema.parse(req.body);
    const result = await setupInitialAdmin(data);
    res.status(201).json(result);
  })
);
