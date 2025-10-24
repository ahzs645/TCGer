import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { PrismaClient } from '@prisma/client';

import { env } from '../../config/env';

const prisma = new PrismaClient();

export interface SignupInput {
  email: string;
  password: string;
  username?: string;
  isAdmin?: boolean;
}

export interface LoginInput {
  email: string;
  password: string;
}

export interface AuthResponse {
  user: {
    id: string;
    email: string;
    username: string | null;
    isAdmin: boolean;
    showCardNumbers: boolean;
    showPricing: boolean;
    enabledYugioh: boolean;
    enabledMagic: boolean;
    enabledPokemon: boolean;
  };
  token: string;
}

export async function signup(input: SignupInput): Promise<AuthResponse> {
  const { email, password, username, isAdmin = false } = input;

  // Check if user already exists
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    throw new Error('User with this email already exists');
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
  const token = jwt.sign(
    { userId: user.id, email: user.email, isAdmin: user.isAdmin },
    env.JWT_SECRET,
    { expiresIn: '7d' }
  );

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
    throw new Error('Invalid email or password');
  }

  // Verify password
  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) {
    throw new Error('Invalid email or password');
  }

  // Generate JWT
  const token = jwt.sign(
    { userId: user.id, email: user.email, isAdmin: user.isAdmin },
    env.JWT_SECRET,
    { expiresIn: '7d' }
  );

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

export async function setupInitialAdmin(input: SignupInput): Promise<AuthResponse> {
  // Check if admin already exists
  const hasAdmin = await hasAdminUser();
  if (hasAdmin) {
    throw new Error('Admin user already exists');
  }

  // Create admin user
  return signup({ ...input, isAdmin: true });
}

export async function verifyToken(token: string): Promise<{ userId: string; email: string }> {
  try {
    const decoded = jwt.verify(token, env.JWT_SECRET) as { userId: string; email: string };
    return decoded;
  } catch (error) {
    throw new Error('Invalid or expired token');
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
    throw new Error('User not found');
  }

  return user;
}

export interface UpdateUserPreferencesInput {
  showCardNumbers?: boolean;
  showPricing?: boolean;
  enabledYugioh?: boolean;
  enabledMagic?: boolean;
  enabledPokemon?: boolean;
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
    throw new Error('User not found');
  }

  return user;
}

export async function updateUserPreferences(userId: string, input: UpdateUserPreferencesInput) {
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

export interface UpdateUserProfileInput {
  username?: string;
  email?: string;
}

export async function updateUserProfile(userId: string, input: UpdateUserProfileInput) {
  // If email is being changed, check if it's already taken
  if (input.email) {
    const existingUser = await prisma.user.findUnique({
      where: { email: input.email }
    });
    if (existingUser && existingUser.id !== userId) {
      throw new Error('Email is already in use');
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

export interface ChangePasswordInput {
  currentPassword: string;
  newPassword: string;
}

export async function changePassword(userId: string, input: ChangePasswordInput) {
  const { currentPassword, newPassword } = input;

  // Get user with password hash
  const user = await prisma.user.findUnique({
    where: { id: userId }
  });

  if (!user) {
    throw new Error('User not found');
  }

  // Verify current password
  const valid = await bcrypt.compare(currentPassword, user.passwordHash);
  if (!valid) {
    throw new Error('Current password is incorrect');
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
