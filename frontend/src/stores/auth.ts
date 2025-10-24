import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { AuthUser } from '@/lib/api/auth';

interface AuthState {
  user: AuthUser | null;
  token: string | null;
  isAuthenticated: boolean;
  setAuth: (user: AuthUser, token: string) => void;
  clearAuth: () => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      user: null,
      token: null,
      isAuthenticated: false,
      setAuth: (user, token) =>
        set({
          user,
          token,
          isAuthenticated: true
        }),
      clearAuth: () =>
        set({
          user: null,
          token: null,
          isAuthenticated: false
        })
    }),
    {
      name: 'tcg-auth-store',
      version: 1
    }
  )
);
