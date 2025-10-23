'use client';

import { Sparkles, Swords, Wand2 } from 'lucide-react';

import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { GAME_LABELS, type SupportedGame } from '@/lib/utils';
import { supportedGames, useGameFilterStore } from '@/stores/game-filter';

const icons: Record<Exclude<SupportedGame, 'all'>, React.ComponentType<{ className?: string }>> = {
  yugioh: Swords,
  magic: Wand2,
  pokemon: Sparkles
};

export function GameSwitcher() {
  const { selectedGame, setGame } = useGameFilterStore((state) => ({
    selectedGame: state.selectedGame,
    setGame: state.setGame
  }));

  return (
    <ToggleGroup
      type="single"
      value={selectedGame}
      onValueChange={(value) => value && setGame(value as SupportedGame)}
      className="hidden items-center gap-1 rounded-lg bg-muted p-1 shadow-inner sm:flex"
    >
      {supportedGames.map((game) => {
        if (game === 'all') {
          return (
            <ToggleGroupItem key={game} value={game} className="min-w-[3rem]">
              All
            </ToggleGroupItem>
          );
        }
        const Icon = icons[game];
        return (
          <ToggleGroupItem key={game} value={game} className="flex min-w-[3rem] items-center gap-2">
            <Icon className="h-4 w-4" />
            <span className="hidden xl:inline">{GAME_LABELS[game]}</span>
          </ToggleGroupItem>
        );
      })}
    </ToggleGroup>
  );
}
