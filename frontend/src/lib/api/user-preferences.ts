import type { UserPreferences } from '@tcg/api-types';

export type { UserPreferences } from '@tcg/api-types';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:3000';

export async function getUserPreferences(token: string): Promise<UserPreferences> {
  const response = await fetch(`${API_BASE_URL}/users/me/preferences`, {
    headers: {
      Authorization: `Bearer ${token}`
    }
  });

  if (!response.ok) {
    throw new Error('Failed to load user preferences');
  }

  return response.json();
}

export async function updateUserPreferences(
  data: Partial<UserPreferences>,
  token: string
): Promise<UserPreferences> {
  const response = await fetch(`${API_BASE_URL}/users/me/preferences`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify(data)
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.message || 'Failed to update user preferences');
  }

  return response.json();
}
