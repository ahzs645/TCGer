import { create } from 'zustand';

import type { SupportedGame } from '@/lib/utils';

export type ManageableGame = Exclude<SupportedGame, 'all'>;

interface ModuleState {
  enabledGames: Record<ManageableGame, boolean>;
  toggleGame: (game: ManageableGame) => void;
  setGameEnabled: (game: ManageableGame, enabled: boolean) => void;
  showCardNumbers: boolean;
  setShowCardNumbers: (show: boolean) => void;
  showPricing: boolean;
  setShowPricing: (show: boolean) => void;
}

const initialState: Record<ManageableGame, boolean> = {
  yugioh: true,
  magic: true,
  pokemon: true
};

export const useModuleStore = create<ModuleState>((set) => ({
  enabledGames: initialState,
  toggleGame: (game) =>
    set((state) => ({
      enabledGames: { ...state.enabledGames, [game]: !state.enabledGames[game] }
    })),
  setGameEnabled: (game, enabled) =>
    set((state) => ({
      enabledGames: { ...state.enabledGames, [game]: enabled }
    })),
  showCardNumbers: true,
  setShowCardNumbers: (show) => set({ showCardNumbers: show }),
  showPricing: true,
  setShowPricing: (show) => set({ showPricing: show })
}));

export function getActiveGames(enabledGames: Record<ManageableGame, boolean>): ManageableGame[] {
  return (Object.entries(enabledGames) as Array<[ManageableGame, boolean]>)
    .filter(([, enabled]) => enabled)
    .map(([game]) => game);
}
