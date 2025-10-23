import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface User {
  id: string;
  email: string;
  username: string | null;
  isAdmin: boolean;
}

interface AuthState {
  user: User | null;
  token: string | null;
  isAuthenticated: boolean;
  setupRequired: boolean | null;
  setAuth: (user: User, token: string) => void;
  clearAuth: () => void;
  setSetupRequired: (required: boolean) => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      user: null,
      token: null,
      isAuthenticated: false,
      setupRequired: null,
      setAuth: (user, token) =>
        set({
          user,
          token,
          isAuthenticated: true,
          setupRequired: false
        }),
      clearAuth: () =>
        set({
          user: null,
          token: null,
          isAuthenticated: false
        }),
      setSetupRequired: (required) =>
        set({
          setupRequired: required
        })
    }),
    {
      name: 'auth-storage'
    }
  )
);
