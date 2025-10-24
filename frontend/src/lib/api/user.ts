const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:3000';

export interface UserProfile {
  id: string;
  email: string;
  username: string | null;
  isAdmin: boolean;
  showCardNumbers: boolean;
  showPricing: boolean;
  createdAt: string;
}

export interface UpdateProfileInput {
  username?: string;
  email?: string;
}

export interface ChangePasswordInput {
  currentPassword: string;
  newPassword: string;
}

export async function getUserProfile(token: string): Promise<UserProfile> {
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
