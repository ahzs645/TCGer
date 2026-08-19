import { GAME_LABELS, type SupportedGame } from "@/lib/utils";

/**
 * One place that says how a game looks.
 *
 * The iOS client has had this for a while — `TCGGame` plus
 * `TCGGame+Presentation.swift` give every game a display name, a short name, an
 * icon and a `brandColor`, and every view reads from it. The web client had
 * eight separate copies instead, and they disagreed: Yu-Gi-Oh! was red in five
 * of them and violet in `set-symbol`, Pokémon was amber in five and red in
 * `set-symbol` and blue on iOS. Three of the eight were keyed by *display name*
 * rather than game code and only covered three of the six games, so One Piece,
 * Lorcana and Dragon Ball chips rendered with no colour at all.
 *
 * The values below are ported from `TCGGame+Presentation.swift` so a collection
 * looks like the same product on both clients.
 */

export type ManageableGame = Exclude<SupportedGame, "all">;

export interface GamePresentation {
  /** Full name, e.g. "Magic: The Gathering". */
  label: string;
  /** Compact name for chips and dense rows, e.g. "Magic". */
  shortLabel: string;
  /** Brand colour, ported from iOS `TCGGame.brandColor`. */
  color: string;
  /** Monochrome mark in `public/icons`, or null where the game has none. */
  icon: string | null;
}

export const GAME_PRESENTATION: Record<SupportedGame, GamePresentation> = {
  all: {
    label: GAME_LABELS.all,
    shortLabel: "All",
    color: "#8a8a92",
    icon: null,
  },
  yugioh: {
    label: GAME_LABELS.yugioh,
    shortLabel: "Yu-Gi-Oh!",
    color: "#6c4ab0",
    icon: "/icons/Yugioh.svg",
  },
  magic: {
    label: GAME_LABELS.magic,
    shortLabel: "Magic",
    color: "#a5732c",
    icon: "/icons/MTG.svg",
  },
  pokemon: {
    label: GAME_LABELS.pokemon,
    shortLabel: "Pokémon",
    color: "#3d7dca",
    icon: "/icons/Pokemon.svg",
  },
  onepiece: {
    label: GAME_LABELS.onepiece,
    shortLabel: "One Piece",
    color: "#cd2f3a",
    icon: "/icons/OnePiece.svg",
  },
  lorcana: {
    label: GAME_LABELS.lorcana,
    shortLabel: "Lorcana",
    color: "#8f6e1e",
    icon: "/icons/Lorcana.svg",
  },
  dragonball: {
    label: GAME_LABELS.dragonball,
    shortLabel: "Dragon Ball",
    color: "#cc4e0f",
    icon: "/icons/DragonBall.svg",
  },
};

const NEUTRAL: GamePresentation = GAME_PRESENTATION.all;

/**
 * Resolve a game by code. Accepts anything — an unknown or absent code falls
 * back to the neutral treatment rather than rendering an uncoloured chip.
 */
export function gamePresentation(game?: string | null): GamePresentation {
  if (!game) return NEUTRAL;
  const key = game.toLowerCase();
  return (
    GAME_PRESENTATION[key as SupportedGame] ??
    // Demo fixtures label games by their display name ("Yu-Gi-Oh!"), not their
    // code, so resolve those too rather than dropping to neutral.
    Object.values(GAME_PRESENTATION).find(
      (entry) =>
        entry.label.toLowerCase() === key ||
        entry.shortLabel.toLowerCase() === key,
    ) ??
    NEUTRAL
  );
}

/** Brand colour for a game code or display name. */
export function gameColor(game?: string | null): string {
  return gamePresentation(game).color;
}

/** Compact name for a game code or display name. */
export function gameShortLabel(game?: string | null): string {
  return gamePresentation(game).shortLabel;
}
