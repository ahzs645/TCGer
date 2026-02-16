import type { AppSettings, UpdateSettingsInput } from '@tcg/api-types';

export type { AppSettings, UpdateSettingsInput } from '@tcg/api-types';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:3000';

export async function getSettings(): Promise<AppSettings> {
  const response = await fetch(`${API_BASE_URL}/settings`);

  if (!response.ok) {
    throw new Error('Failed to fetch settings');
  }

  return response.json();
}

export async function updateSettings(
  data: UpdateSettingsInput,
  token: string
): Promise<AppSettings> {
  const response = await fetch(`${API_BASE_URL}/settings`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify(data)
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.message || 'Failed to update settings');
  }

  return response.json();
}
