import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import type {
  SignupInput,
  LoginInput,
  AuthResponse,
  UpdatePreferencesInput,
  UpdateProfileInput,
  ChangePasswordInput
} from '@tcg/api-types';

import { env } from '../../config/env';
import { prisma } from '../../lib/prisma';

// Re-export shared types for existing consumers
export type {
  SignupInput,
  LoginInput,
  AuthResponse,
  UpdatePreferencesInput as UpdateUserPreferencesInput,
  UpdateProfileInput as UpdateUserProfileInput,
  ChangePasswordInput
} from '@tcg/api-types';

// Backend-specific extension: signup service also accepts isAdmin flag
interface SignupServiceInput extends SignupInput {
  isAdmin?: boolean;
}

interface AuthTokenPayload {
  userId: string;
  email: string;
  isAdmin: boolean;
}

function createHttpError(status: number, message: string): Error & { status: number } {
  const error = new Error(message) as Error & { status: number };
  error.status = status;
  return error;
}

function signAuthToken(payload: AuthTokenPayload): string {
  return jwt.sign(payload, env.JWT_SECRET, { expiresIn: '7d' });
}

export async function signup(input: SignupServiceInput): Promise<AuthResponse> {
  const { email, password, username, isAdmin = false } = input;

  // Check if user already exists
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    throw createHttpError(409, 'User with this email already exists');
  }

  // Hash password
  const passwordHash = await bcrypt.hash(password, 10);

  // Create user
  const user = await prisma.user.create({
    data: {
      email,
      username,
      passwordHash,
      isAdmin
    }
  });

  // Generate JWT
  const token = signAuthToken({ userId: user.id, email: user.email, isAdmin: user.isAdmin });

  return {
    user: {
      id: user.id,
      email: user.email,
      username: user.username,
      isAdmin: user.isAdmin,
      showCardNumbers: user.showCardNumbers,
      showPricing: user.showPricing,
      enabledYugioh: user.enabledYugioh,
      enabledMagic: user.enabledMagic,
      enabledPokemon: user.enabledPokemon
    },
    token
  };
}

export async function login(input: LoginInput): Promise<AuthResponse> {
  const { email, password } = input;

  // Find user
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    throw createHttpError(401, 'Invalid email or password');
  }

  // Verify password
  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) {
    throw createHttpError(401, 'Invalid email or password');
  }

  // Generate JWT
  const token = signAuthToken({ userId: user.id, email: user.email, isAdmin: user.isAdmin });

  return {
    user: {
      id: user.id,
      email: user.email,
      username: user.username,
      isAdmin: user.isAdmin,
      showCardNumbers: user.showCardNumbers,
      showPricing: user.showPricing,
      enabledYugioh: user.enabledYugioh,
      enabledMagic: user.enabledMagic,
      enabledPokemon: user.enabledPokemon
    },
    token
  };
}

export async function hasAdminUser(): Promise<boolean> {
  const adminCount = await prisma.user.count({ where: { isAdmin: true } });
  return adminCount > 0;
}

export async function setupInitialAdmin(input: SignupServiceInput): Promise<AuthResponse> {
  // Check if admin already exists
  const hasAdmin = await hasAdminUser();
  if (hasAdmin) {
    throw createHttpError(409, 'Admin user already exists');
  }

  // Create admin user
  return signup({ ...input, isAdmin: true });
}

export async function verifyToken(token: string): Promise<{ userId: string; email: string }> {
  try {
    const decoded = jwt.verify(token, env.JWT_SECRET);
    if (typeof decoded === 'string') {
      throw createHttpError(401, 'Invalid token payload');
    }

    const payload = decoded as jwt.JwtPayload & { userId?: unknown; email?: unknown };
    if (typeof payload.userId !== 'string' || typeof payload.email !== 'string') {
      throw createHttpError(401, 'Invalid token payload');
    }

    return { userId: payload.userId, email: payload.email };
  } catch (error) {
    throw createHttpError(401, 'Invalid or expired token');
  }
}

export async function getUserById(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      email: true,
      username: true,
      isAdmin: true,
      showCardNumbers: true,
      showPricing: true,
      enabledYugioh: true,
      enabledMagic: true,
      enabledPokemon: true,
      createdAt: true
    }
  });

  if (!user) {
    throw createHttpError(404, 'User not found');
  }

  return user;
}

export async function getUserPreferences(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      showCardNumbers: true,
      showPricing: true,
      enabledYugioh: true,
      enabledMagic: true,
      enabledPokemon: true
    }
  });

  if (!user) {
    throw createHttpError(404, 'User not found');
  }

  return user;
}

export async function updateUserPreferences(userId: string, input: UpdatePreferencesInput) {
  const user = await prisma.user.update({
    where: { id: userId },
    data: input,
    select: {
      showCardNumbers: true,
      showPricing: true,
      enabledYugioh: true,
      enabledMagic: true,
      enabledPokemon: true
    }
  });

  return user;
}

export async function updateUserProfile(userId: string, input: UpdateProfileInput) {
  // If email is being changed, check if it's already taken
  if (input.email) {
    const existingUser = await prisma.user.findUnique({
      where: { email: input.email }
    });
    if (existingUser && existingUser.id !== userId) {
      throw createHttpError(409, 'Email is already in use');
    }
  }

  const user = await prisma.user.update({
    where: { id: userId },
    data: input,
    select: {
      id: true,
      email: true,
      username: true,
      isAdmin: true,
      showCardNumbers: true,
      showPricing: true,
      enabledYugioh: true,
      enabledMagic: true,
      enabledPokemon: true
    }
  });

  return user;
}

export async function changePassword(userId: string, input: ChangePasswordInput) {
  const { currentPassword, newPassword } = input;

  // Get user with password hash
  const user = await prisma.user.findUnique({
    where: { id: userId }
  });

  if (!user) {
    throw createHttpError(404, 'User not found');
  }

  // Verify current password
  const valid = await bcrypt.compare(currentPassword, user.passwordHash);
  if (!valid) {
    throw createHttpError(400, 'Current password is incorrect');
  }

  // Hash new password
  const passwordHash = await bcrypt.hash(newPassword, 10);

  // Update password
  await prisma.user.update({
    where: { id: userId },
    data: { passwordHash }
  });

  return { success: true };
}
