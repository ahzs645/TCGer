"use client";

import Image from "next/image";

import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { GAME_LABELS, type SupportedGame } from "@/lib/utils";
import { supportedGames, useGameFilterStore } from "@/stores/game-filter";
import { useModuleStore } from "@/stores/preferences";

const iconPaths: Record<Exclude<SupportedGame, "all">, string> = {
  yugioh: "/icons/Yugioh.svg",
  magic: "/icons/MTG.svg",
  pokemon: "/icons/Pokemon.svg",
};

export function GameSwitcher() {
  const { selectedGame, setGame } = useGameFilterStore((state) => ({
    selectedGame: state.selectedGame,
    setGame: state.setGame,
  }));
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
      value={selectedGame}
      onValueChange={(value) => value && setGame(value as SupportedGame)}
      className="hidden items-center gap-1 rounded-lg bg-muted p-1 shadow-inner sm:flex"
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
            className="flex min-w-[3rem] items-center gap-2"
            data-oid="d3w.0o-"
          >
            <Image
              src={iconPath}
              alt={GAME_LABELS[game]}
              width={16}
              height={16}
              className={`transition-all ${
                isSelected
                  ? "opacity-100 invert dark:invert-0 dark:brightness-0"
                  : "opacity-70 dark:opacity-100 dark:invert"
              }`}
              data-oid="ab3h7pi"
            />

            <span className="hidden xl:inline" data-oid="ji47x4:">
              {GAME_LABELS[game]}
            </span>
          </ToggleGroupItem>
        );
      })}
    </ToggleGroup>
  );
}
