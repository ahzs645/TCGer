import { create } from 'zustand';
import { persist } from 'zustand/middleware';

import type { AuthUser } from '@/lib/api/auth';
import { useModuleStore } from './preferences';

const DEFAULT_DISPLAY_PREFERENCES = {
  showCardNumbers: true,
  showPricing: true
};

const DEFAULT_ENABLED_GAMES = {
  enabledYugioh: true,
  enabledMagic: true,
  enabledPokemon: true
};

type DisplayPreferenceKeys = 'showCardNumbers' | 'showPricing';
type EnabledGamesKeys = 'enabledYugioh' | 'enabledMagic' | 'enabledPokemon';

interface AuthState {
  user: AuthUser | null;
  token: string | null;
  isAuthenticated: boolean;
  setupRequired: boolean | null;
  setAuth: (user: AuthUser, token: string) => void;
  clearAuth: () => void;
  setSetupRequired: (required: boolean) => void;
  updateStoredPreferences: (preferences: Partial<Pick<AuthUser, DisplayPreferenceKeys>>) => void;
}

function withDisplayDefaults(user: AuthUser | null): AuthUser | null {
  if (!user) {
    return null;
  }

  return {
    ...user,
    showCardNumbers: user.showCardNumbers ?? DEFAULT_DISPLAY_PREFERENCES.showCardNumbers,
    showPricing: user.showPricing ?? DEFAULT_DISPLAY_PREFERENCES.showPricing,
    enabledYugioh: user.enabledYugioh ?? DEFAULT_ENABLED_GAMES.enabledYugioh,
    enabledMagic: user.enabledMagic ?? DEFAULT_ENABLED_GAMES.enabledMagic,
    enabledPokemon: user.enabledPokemon ?? DEFAULT_ENABLED_GAMES.enabledPokemon
  };
}

function syncDisplayPreferences(
  preferences?: Partial<Pick<AuthUser, DisplayPreferenceKeys | EnabledGamesKeys>>
) {
  const { setShowCardNumbers, setShowPricing, setGameEnabled } = useModuleStore.getState();

  setShowCardNumbers(preferences?.showCardNumbers ?? DEFAULT_DISPLAY_PREFERENCES.showCardNumbers);
  setShowPricing(preferences?.showPricing ?? DEFAULT_DISPLAY_PREFERENCES.showPricing);

  setGameEnabled('yugioh', preferences?.enabledYugioh ?? DEFAULT_ENABLED_GAMES.enabledYugioh);
  setGameEnabled('magic', preferences?.enabledMagic ?? DEFAULT_ENABLED_GAMES.enabledMagic);
  setGameEnabled('pokemon', preferences?.enabledPokemon ?? DEFAULT_ENABLED_GAMES.enabledPokemon);
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      user: null,
      token: null,
      isAuthenticated: false,
      setupRequired: null,
      setAuth: (user, token) => {
        const normalizedUser = withDisplayDefaults(user);

        set({
          user: normalizedUser,
          token,
          isAuthenticated: true,
          setupRequired: false
        });

        syncDisplayPreferences(normalizedUser ?? undefined);
      },
      clearAuth: () => {
        set({
          user: null,
          token: null,
          isAuthenticated: false,
          setupRequired: null
        });
        syncDisplayPreferences();
      },
      setSetupRequired: (required) =>
        set({
          setupRequired: required
        }),
      updateStoredPreferences: (preferences) => {
        const currentUser = get().user;

        if (!currentUser) {
          syncDisplayPreferences(preferences);
          return;
        }

        const updatedUser = {
          ...currentUser,
          showCardNumbers:
            preferences.showCardNumbers ?? currentUser.showCardNumbers ?? DEFAULT_DISPLAY_PREFERENCES.showCardNumbers,
          showPricing:
            preferences.showPricing ?? currentUser.showPricing ?? DEFAULT_DISPLAY_PREFERENCES.showPricing,
          enabledYugioh:
            (preferences as any).enabledYugioh ?? currentUser.enabledYugioh ?? DEFAULT_ENABLED_GAMES.enabledYugioh,
          enabledMagic:
            (preferences as any).enabledMagic ?? currentUser.enabledMagic ?? DEFAULT_ENABLED_GAMES.enabledMagic,
          enabledPokemon:
            (preferences as any).enabledPokemon ?? currentUser.enabledPokemon ?? DEFAULT_ENABLED_GAMES.enabledPokemon
        };

        set({ user: updatedUser });
        syncDisplayPreferences(updatedUser);
      }
    }),
    {
      name: 'tcg-auth-store',
      partialize: (state) => ({
        user: state.user,
        token: state.token,
        isAuthenticated: state.isAuthenticated,
        setupRequired: state.setupRequired
      })
    }
  )
);

syncDisplayPreferences();

useAuthStore.subscribe((state, previousState) => {
  if (state.user === previousState?.user) {
    return;
  }

  if (state.user) {
    const normalized = withDisplayDefaults(state.user);
    if (
      normalized?.showCardNumbers !== state.user.showCardNumbers ||
      normalized?.showPricing !== state.user.showPricing
    ) {
      useAuthStore.setState({ user: normalized });
      syncDisplayPreferences(normalized ?? undefined);
      return;
    }

    syncDisplayPreferences(state.user);
  } else {
    syncDisplayPreferences();
  }
});
