import { API_BASE_URL } from './base-url';

// Re-export Better Auth client for convenience
export { authClient, signIn, signUp, signOut, useSession } from '@/lib/auth-client';

export interface SetupCheckResponse {
  setupRequired: boolean;
}

export async function checkSetupRequired(): Promise<SetupCheckResponse> {
  const response = await fetch(`${API_BASE_URL}/setup/setup-required`);

  if (!response.ok) {
    throw new Error('Failed to check setup status');
  }

  return response.json();
}

export async function promoteToAdmin(): Promise<{ message: string }> {
  const response = await fetch(`${API_BASE_URL}/setup/setup`, {
    method: 'POST',
    credentials: 'include'
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.message || 'Setup failed');
  }

  return response.json();
}
