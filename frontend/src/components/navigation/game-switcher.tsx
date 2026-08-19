"use client";

import { Check, Layers } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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

function GameIcon({
  game,
  selected,
}: {
  game: SupportedGame;
  selected: boolean;
}) {
  if (game === "all") {
    return <Layers className="h-4 w-4" aria-hidden="true" />;
  }
  return (
    /* eslint-disable-next-line @next/next/no-img-element */
    <img
      src={iconPaths[game]}
      alt=""
      width={16}
      height={16}
      className={`h-4 w-4 transition-all ${
        selected
          ? "opacity-100 invert dark:invert-0 dark:brightness-0"
          : "opacity-70 dark:opacity-100 dark:invert"
      }`}
    />
  );
}

export function GameSwitcher() {
  const { selectedGame, setGame } = useGameFilterStore(
    useShallow((state) => ({
      selectedGame: state.selectedGame,
      setGame: state.setGame,
    })),
  );
  const enabledGames = useModuleStore((state) => state.enabledGames);

  // Count how many games are enabled
  const activeCount = Object.values(enabledGames).filter(Boolean).length;

  // Hide switcher if only one or no games are enabled
  if (activeCount <= 1) {
    return null;
  }

  const visibleGames = supportedGames.filter(
    (game) => game === "all" || enabledGames[game],
  );
  const selectedLabel =
    selectedGame === "all" ? "All games" : GAME_LABELS[selectedGame];

  return (
    <>
      {/*
       * The six-way toggle row costs 212-308px depending on how many games are
       * enabled, which is what used to squeeze the primary nav on tablets — and
       * it was hidden outright below 640px, leaving phones with no way to reach
       * the global game filter at all. Below xl the compact menu keeps the
       * filter available at every width and gives the nav its space back.
       */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="shrink-0 rounded-full border xl:hidden"
            aria-label={`Filter by game (currently ${selectedLabel})`}
            title={`Filter by game — ${selectedLabel}`}
            data-oid="game-switcher-compact"
          >
            <GameIcon game={selectedGame} selected />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-52">
          <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
            Filter by game
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          {visibleGames.map((game) => {
            const isSelected = selectedGame === game;
            return (
              <DropdownMenuItem
                key={game}
                onSelect={() => setGame(game)}
                className="gap-2"
              >
                <GameIcon game={game} selected={false} />
                <span className="flex-1">
                  {game === "all" ? "All games" : GAME_LABELS[game]}
                </span>
                {isSelected && <Check className="h-4 w-4" aria-hidden="true" />}
              </DropdownMenuItem>
            );
          })}
        </DropdownMenuContent>
      </DropdownMenu>

      <ToggleGroup
        type="single"
        aria-label="Filter by game"
        value={selectedGame}
        onValueChange={(value) => value && setGame(value as SupportedGame)}
        className="hidden shrink-0 items-center gap-1 rounded-lg bg-muted p-1 shadow-inner xl:flex"
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
          const isSelected = selectedGame === game;
          return (
            <ToggleGroupItem
              key={game}
              value={game}
              title={GAME_LABELS[game]}
              className="flex min-w-[3rem] items-center gap-2"
              data-oid="d3w.0o-"
            >
              <GameIcon game={game} selected={isSelected} />

              <span className="sr-only" data-oid="ji47x4:">
                {GAME_LABELS[game]}
              </span>
            </ToggleGroupItem>
          );
        })}
      </ToggleGroup>
    </>
  );
}
