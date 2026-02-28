import type { UserProfile, UpdateProfileInput, ChangePasswordInput } from '@tcg/api-types';

export type { UserProfile, UpdateProfileInput, ChangePasswordInput } from '@tcg/api-types';

import { isDemoMode } from '@/lib/demo-mode';
import * as demo from './demo-adapter';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:3000';

export async function getUserProfile(token: string): Promise<UserProfile> {
  if (isDemoMode()) return demo.demoGetUserProfile();
  const response = await fetch(`${API_BASE_URL}/users/me`, {
    headers: {
      Authorization: `Bearer ${token}`
    }
  });

  if (!response.ok) {
    throw new Error('Failed to load user profile');
  }

  return response.json();
}

export async function updateUserProfile(
  data: UpdateProfileInput,
  token: string
): Promise<Omit<UserProfile, 'createdAt'>> {
  if (isDemoMode()) return demo.demoUpdateUserProfile(data);
  const response = await fetch(`${API_BASE_URL}/users/me`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify(data)
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.message || 'Failed to update profile');
  }

  return response.json();
}

export async function changePassword(
  data: ChangePasswordInput,
  token: string
): Promise<{ success: boolean }> {
  if (isDemoMode()) return demo.demoChangePassword();
  const response = await fetch(`${API_BASE_URL}/users/me/change-password`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify(data)
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.message || 'Failed to change password');
  }

  return response.json();
}
