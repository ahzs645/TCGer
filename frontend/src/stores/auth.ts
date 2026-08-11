import { create } from "zustand";
import { persist } from "zustand/middleware";

import {
  getSingleUserAuthUser,
  isSingleUserModeEnabled,
  SINGLE_USER_TOKEN,
} from "@/lib/single-user-mode";
import { AUTH_STORE_STORAGE_KEY } from "@/lib/storage/keys";

import { useModuleStore } from "./preferences";

const DEFAULT_DISPLAY_PREFERENCES = {
  showCardNumbers: true,
  showPricing: true,
};

const DEFAULT_ENABLED_GAMES = {
  enabledYugioh: true,
  enabledMagic: true,
  enabledPokemon: true,
  enabledOnepiece: false,
  enabledLorcana: false,
  enabledDragonball: false,
};

export interface AuthUser {
  id: string;
  email: string;
  username?: string | null;
  isAdmin: boolean;
  showCardNumbers: boolean;
  showPricing: boolean;
  enabledYugioh: boolean;
  enabledMagic: boolean;
  enabledPokemon: boolean;
  enabledOnepiece: boolean;
  enabledLorcana: boolean;
  enabledDragonball: boolean;
}

type DisplayPreferenceKeys = "showCardNumbers" | "showPricing";
type EnabledGamesKeys =
  | "enabledYugioh"
  | "enabledMagic"
  | "enabledPokemon"
  | "enabledOnepiece"
  | "enabledLorcana"
  | "enabledDragonball";

interface AuthState {
  user: AuthUser | null;
  token: string | null;
  isAuthenticated: boolean;
  setupRequired: boolean | null;
  setAuth: (user: AuthUser, token?: string) => void;
  clearAuth: () => void;
  setSetupRequired: (required: boolean) => void;
  updateStoredPreferences: (
    preferences: Partial<
      Pick<AuthUser, DisplayPreferenceKeys | EnabledGamesKeys>
    >,
  ) => void;
}

function getSingleUserAuthState() {
  if (!isSingleUserModeEnabled()) {
    return {
      user: null,
      token: null,
      isAuthenticated: false,
      setupRequired: null,
    };
  }

  return {
    user: getSingleUserAuthUser(),
    token: SINGLE_USER_TOKEN,
    isAuthenticated: true,
    setupRequired: false,
  };
}

function withDisplayDefaults(user: AuthUser | null): AuthUser | null {
  if (!user) {
    return null;
  }

  return {
    ...user,
    showCardNumbers:
      user.showCardNumbers ?? DEFAULT_DISPLAY_PREFERENCES.showCardNumbers,
    showPricing: user.showPricing ?? DEFAULT_DISPLAY_PREFERENCES.showPricing,
    enabledYugioh: user.enabledYugioh ?? DEFAULT_ENABLED_GAMES.enabledYugioh,
    enabledMagic: user.enabledMagic ?? DEFAULT_ENABLED_GAMES.enabledMagic,
    enabledPokemon: user.enabledPokemon ?? DEFAULT_ENABLED_GAMES.enabledPokemon,
    enabledOnepiece:
      user.enabledOnepiece ?? DEFAULT_ENABLED_GAMES.enabledOnepiece,
    enabledLorcana: user.enabledLorcana ?? DEFAULT_ENABLED_GAMES.enabledLorcana,
    enabledDragonball:
      user.enabledDragonball ?? DEFAULT_ENABLED_GAMES.enabledDragonball,
  };
}

function syncDisplayPreferences(
  preferences?: Partial<
    Pick<AuthUser, DisplayPreferenceKeys | EnabledGamesKeys>
  >,
) {
  const { setShowCardNumbers, setShowPricing, setGameEnabled } =
    useModuleStore.getState();

  setShowCardNumbers(
    preferences?.showCardNumbers ?? DEFAULT_DISPLAY_PREFERENCES.showCardNumbers,
  );
  setShowPricing(
    preferences?.showPricing ?? DEFAULT_DISPLAY_PREFERENCES.showPricing,
  );

  setGameEnabled(
    "yugioh",
    preferences?.enabledYugioh ?? DEFAULT_ENABLED_GAMES.enabledYugioh,
  );
  setGameEnabled(
    "magic",
    preferences?.enabledMagic ?? DEFAULT_ENABLED_GAMES.enabledMagic,
  );
  setGameEnabled(
    "pokemon",
    preferences?.enabledPokemon ?? DEFAULT_ENABLED_GAMES.enabledPokemon,
  );
  setGameEnabled(
    "onepiece",
    preferences?.enabledOnepiece ?? DEFAULT_ENABLED_GAMES.enabledOnepiece,
  );
  setGameEnabled(
    "lorcana",
    preferences?.enabledLorcana ?? DEFAULT_ENABLED_GAMES.enabledLorcana,
  );
  setGameEnabled(
    "dragonball",
    preferences?.enabledDragonball ?? DEFAULT_ENABLED_GAMES.enabledDragonball,
  );
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      ...getSingleUserAuthState(),
      setAuth: (user, token) => {
        const normalizedUser = withDisplayDefaults(user);

        set({
          user: normalizedUser,
          token: token ?? null,
          isAuthenticated: true,
          setupRequired: false,
        });

        syncDisplayPreferences(normalizedUser ?? undefined);
      },
      clearAuth: () => {
        if (isSingleUserModeEnabled()) {
          const singleUserState = getSingleUserAuthState();
          set(singleUserState);
          syncDisplayPreferences(singleUserState.user ?? undefined);
          return;
        }

        set({
          user: null,
          token: null,
          isAuthenticated: false,
          setupRequired: null,
        });
        syncDisplayPreferences();
      },
      setSetupRequired: (required) =>
        set({
          setupRequired: required,
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
            preferences.showCardNumbers ??
            currentUser.showCardNumbers ??
            DEFAULT_DISPLAY_PREFERENCES.showCardNumbers,
          showPricing:
            preferences.showPricing ??
            currentUser.showPricing ??
            DEFAULT_DISPLAY_PREFERENCES.showPricing,
          enabledYugioh:
            preferences.enabledYugioh ??
            currentUser.enabledYugioh ??
            DEFAULT_ENABLED_GAMES.enabledYugioh,
          enabledMagic:
            preferences.enabledMagic ??
            currentUser.enabledMagic ??
            DEFAULT_ENABLED_GAMES.enabledMagic,
          enabledPokemon:
            preferences.enabledPokemon ??
            currentUser.enabledPokemon ??
            DEFAULT_ENABLED_GAMES.enabledPokemon,
          enabledOnepiece:
            preferences.enabledOnepiece ??
            currentUser.enabledOnepiece ??
            DEFAULT_ENABLED_GAMES.enabledOnepiece,
          enabledLorcana:
            preferences.enabledLorcana ??
            currentUser.enabledLorcana ??
            DEFAULT_ENABLED_GAMES.enabledLorcana,
          enabledDragonball:
            preferences.enabledDragonball ??
            currentUser.enabledDragonball ??
            DEFAULT_ENABLED_GAMES.enabledDragonball,
        };

        set({ user: updatedUser });
        syncDisplayPreferences(updatedUser);
      },
    }),
    {
      name: AUTH_STORE_STORAGE_KEY,
      merge: (persistedState, currentState) => {
        if (isSingleUserModeEnabled()) {
          return {
            ...currentState,
            ...getSingleUserAuthState(),
          };
        }

        const merged = {
          ...currentState,
          ...(persistedState as Partial<AuthState>),
        };
        return {
          ...merged,
          user: withDisplayDefaults(merged.user),
        };
      },
      partialize: (state) => ({
        user: state.user,
        token: state.token,
        isAuthenticated: state.isAuthenticated,
        setupRequired: state.setupRequired,
      }),
    },
  ),
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
      normalized?.showPricing !== state.user.showPricing ||
      normalized?.enabledYugioh !== state.user.enabledYugioh ||
      normalized?.enabledMagic !== state.user.enabledMagic ||
      normalized?.enabledPokemon !== state.user.enabledPokemon ||
      normalized?.enabledOnepiece !== state.user.enabledOnepiece ||
      normalized?.enabledLorcana !== state.user.enabledLorcana ||
      normalized?.enabledDragonball !== state.user.enabledDragonball
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
