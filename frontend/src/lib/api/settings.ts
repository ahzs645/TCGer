import type { AppSettings, UpdateSettingsInput } from '@tcg/api-types';

export type { AppSettings, UpdateSettingsInput } from '@tcg/api-types';

import { isDemoMode } from '@/lib/demo-mode';
import * as demo from './demo-adapter';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:3000';

export async function getSettings(): Promise<AppSettings> {
  if (isDemoMode()) return demo.demoGetSettings();
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
  if (isDemoMode()) return demo.demoUpdateSettings(data);
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
