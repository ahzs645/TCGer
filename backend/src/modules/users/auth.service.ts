import type {
  UpdatePreferencesInput,
  UpdateProfileInput,
  ChangePasswordInput
} from '@tcg/api-types';

import { prisma } from '../../lib/prisma';

// Re-export shared types for existing consumers
export type {
  UpdatePreferencesInput as UpdateUserPreferencesInput,
  UpdateProfileInput as UpdateUserProfileInput,
  ChangePasswordInput
} from '@tcg/api-types';

function createHttpError(status: number, message: string): Error & { status: number } {
  const error = new Error(message) as Error & { status: number };
  error.status = status;
  return error;
}

export async function hasAdminUser(): Promise<boolean> {
  const adminCount = await prisma.user.count({ where: { isAdmin: true } });
  return adminCount > 0;
}

export async function setUserAsAdmin(userId: string): Promise<void> {
  await prisma.user.update({
    where: { id: userId },
    data: { isAdmin: true }
  });
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
      enabledPokemon: true,
      defaultGame: true
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
      enabledPokemon: true,
      defaultGame: true
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

  // If username is being changed, check if it's already taken
  if (input.username) {
    const existingUser = await prisma.user.findUnique({
      where: { username: input.username }
    });
    if (existingUser && existingUser.id !== userId) {
      throw createHttpError(409, 'Username is already in use');
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

  // Use Better Auth's API to change password
  // For now, password changes are handled through Better Auth's endpoints
  // This function is kept for API compatibility
  throw createHttpError(501, 'Use the /auth/change-password endpoint instead');
}
