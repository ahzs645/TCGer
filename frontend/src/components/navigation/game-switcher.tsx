"use client";

import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { GAME_LABELS, type SupportedGame } from "@/lib/utils";
import { supportedGames, useGameFilterStore } from "@/stores/game-filter";
import { useModuleStore } from "@/stores/preferences";

import { useShallow } from "zustand/react/shallow";
const iconPaths: Record<Exclude<SupportedGame, "all">, string> = {
  yugioh: "/icons/Yugioh.svg",
  magic: "/icons/MTG.svg",
  pokemon: "/icons/Pokemon.svg",
  onepiece: "/icons/OnePiece.svg",
  lorcana: "/icons/Lorcana.svg",
  dragonball: "/icons/DragonBall.svg",
};

export function GameSwitcher() {
  const { selectedGame, setGame } = useGameFilterStore(useShallow((state) => ({
    selectedGame: state.selectedGame,
    setGame: state.setGame,
  })));
  const enabledGames = useModuleStore((state) => state.enabledGames);

  // Count how many games are enabled
  const activeCount = Object.values(enabledGames).filter(Boolean).length;

  // Hide switcher if only one or no games are enabled
  if (activeCount <= 1) {
    return null;
  }

  return (
    <ToggleGroup
      type="single"
      aria-label="Filter by game"
      value={selectedGame}
      onValueChange={(value) => value && setGame(value as SupportedGame)}
      className="hidden shrink-0 items-center gap-1 rounded-lg bg-muted p-1 shadow-inner sm:flex"
      data-oid="0f7kme."
    >
      {supportedGames.map((game) => {
        if (game === "all") {
          return (
            <ToggleGroupItem
              key={game}
              value={game}
              className="min-w-[3rem]"
              data-oid="7uv_mh5"
            >
              All
            </ToggleGroupItem>
          );
        }
        if (!enabledGames[game]) {
          return null;
        }
        const iconPath = iconPaths[game];
        const isSelected = selectedGame === game;
        return (
          <ToggleGroupItem
            key={game}
            value={game}
            title={GAME_LABELS[game]}
            className="flex min-w-[3rem] items-center gap-2"
            data-oid="d3w.0o-"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={iconPath}
              alt=""
              width={16}
              height={16}
              className={`transition-all ${
                isSelected
                  ? "opacity-100 invert dark:invert-0 dark:brightness-0"
                  : "opacity-70 dark:opacity-100 dark:invert"
              }`}
              data-oid="ab3h7pi"
            />

            <span className="sr-only" data-oid="ji47x4:">
              {GAME_LABELS[game]}
            </span>
          </ToggleGroupItem>
        );
      })}
    </ToggleGroup>
  );
}
