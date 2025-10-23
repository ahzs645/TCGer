import { create } from 'zustand';

import { GAME_LABELS, type SupportedGame } from '@/lib/utils';

interface GameFilterState {
  selectedGame: SupportedGame;
  setGame: (game: SupportedGame) => void;
}

export const useGameFilterStore = create<GameFilterState>((set) => ({
  selectedGame: 'all',
  setGame: (game) => set({ selectedGame: game })
}));

export const supportedGames: SupportedGame[] = ['all', 'yugioh', 'magic', 'pokemon'];
export const supportedGameOptions = supportedGames.map((value) => ({ value, label: GAME_LABELS[value] }));
