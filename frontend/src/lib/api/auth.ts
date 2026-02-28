import type { SignupInput, LoginInput, AuthUser, AuthResponse, SetupCheckResponse } from '@tcg/api-types';

export type { SignupInput, LoginInput, AuthUser, AuthResponse, SetupCheckResponse } from '@tcg/api-types';

import { isDemoMode } from '@/lib/demo-mode';
import * as demo from './demo-adapter';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:3000';

export async function signup(data: SignupInput): Promise<AuthResponse> {
  if (isDemoMode()) return demo.demoSignup();
  const response = await fetch(`${API_BASE_URL}/auth/signup`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(data)
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.message || 'Signup failed');
  }

  return response.json();
}

export async function login(data: LoginInput): Promise<AuthResponse> {
  if (isDemoMode()) return demo.demoLogin();
  const response = await fetch(`${API_BASE_URL}/auth/login`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(data)
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.message || 'Login failed');
  }

  return response.json();
}

export async function logout(token: string): Promise<void> {
  if (isDemoMode()) return demo.demoLogout();
  await fetch(`${API_BASE_URL}/auth/logout`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`
    }
  });
}

export async function getCurrentUser(token: string): Promise<{ user: AuthUser }> {
  if (isDemoMode()) return demo.demoGetCurrentUser();
  const response = await fetch(`${API_BASE_URL}/auth/me`, {
    headers: {
      Authorization: `Bearer ${token}`
    }
  });

  if (!response.ok) {
    throw new Error('Failed to fetch user');
  }

  return response.json();
}

export async function checkSetupRequired(): Promise<SetupCheckResponse> {
  if (isDemoMode()) return demo.demoCheckSetupRequired();
  const response = await fetch(`${API_BASE_URL}/auth/setup-required`);

  if (!response.ok) {
    throw new Error('Failed to check setup status');
  }

  return response.json();
}

export async function setupAdmin(data: SignupInput): Promise<AuthResponse> {
  if (isDemoMode()) return demo.demoSetupAdmin();
  const response = await fetch(`${API_BASE_URL}/auth/setup`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(data)
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.message || 'Setup failed');
  }

  return response.json();
}
