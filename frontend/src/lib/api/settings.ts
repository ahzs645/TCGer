import type { AppSettings, AdminAppSettings, UpdateSettingsInput } from '@tcg/api-types';
import { API_BASE_URL } from './base-url';

export type { AppSettings, AdminAppSettings, UpdateSettingsInput } from '@tcg/api-types';

export async function getSettings(token?: string | null): Promise<AppSettings> {
  const headers: Record<string, string> = {};
  if (token) headers.Authorization = `Bearer ${token}`;

  const response = await fetch(`${API_BASE_URL}/settings`, { headers });

  if (!response.ok) {
    throw new Error('Failed to fetch settings');
  }

  return response.json();
}

export async function getAdminSettings(token: string): Promise<AdminAppSettings> {
  const response = await fetch(`${API_BASE_URL}/settings`, {
    headers: { Authorization: `Bearer ${token}` }
  });

  if (!response.ok) {
    throw new Error('Failed to fetch admin settings');
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
