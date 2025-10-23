'use client';

import Image from 'next/image';

import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { GAME_LABELS, type SupportedGame } from '@/lib/utils';
import { supportedGames, useGameFilterStore } from '@/stores/game-filter';

const iconPaths: Record<Exclude<SupportedGame, 'all'>, string> = {
  yugioh: '/icons/Yugioh.svg',
  magic: '/icons/MTG.svg',
  pokemon: '/icons/Pokemon.svg'
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
        const iconPath = iconPaths[game];
        return (
          <ToggleGroupItem key={game} value={game} className="flex min-w-[3rem] items-center gap-2">
            <Image src={iconPath} alt={GAME_LABELS[game]} width={16} height={16} className="h-4 w-4 dark:invert" />
            <span className="hidden xl:inline">{GAME_LABELS[game]}</span>
          </ToggleGroupItem>
        );
      })}
    </ToggleGroup>
  );
}
