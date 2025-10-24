import { create } from 'zustand';

import { GAME_LABELS, type SupportedGame } from '@/lib/utils';
import { useModuleStore } from '@/stores/preferences';

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

useModuleStore.subscribe((state) => {
  const enabledEntries = Object.entries(state.enabledGames) as Array<[Exclude<SupportedGame, 'all'>, boolean]>;
  const activeGames = new Set(
    enabledEntries.filter(([, enabled]) => enabled).map(([game]) => game)
  );

  const { selectedGame, setGame } = useGameFilterStore.getState();

  if (selectedGame !== 'all' && !activeGames.has(selectedGame)) {
    const fallback = enabledEntries.find(([, enabled]) => enabled)?.[0];
    setGame(fallback ?? 'all');
  }
});
