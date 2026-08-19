import type { TcgCode } from "@tcg/api-types";

export type CatalogTcgCode = Extract<
  TcgCode,
  "pokemon" | "magic" | "yugioh" | "onepiece" | "lorcana" | "dragonball"
>;

export const CATALOG_GAMES: readonly CatalogTcgCode[] = [
  "pokemon",
  "magic",
  "yugioh",
  "onepiece",
  "lorcana",
  "dragonball",
];

export function isCatalogGame(value: unknown): value is CatalogTcgCode {
  if (typeof value !== "string") return false;
  return CATALOG_GAMES.includes(value as CatalogTcgCode);
}
