import type { TcgCode } from "@tcg/api-types";

export type OnlineCodeGame = {
  value: TcgCode;
  label: string;
  service: string;
  codeExample: string;
};

export const onlineCodeGames: readonly OnlineCodeGame[] = [
  {
    value: "pokemon",
    label: "Pokémon",
    service: "Pokémon TCG Live",
    codeExample: "XXXX-XXXX-XXXX-XXX",
  },
  {
    value: "magic",
    label: "Magic: The Gathering",
    service: "MTG Arena",
    codeExample: "XXXXX-XXXXX-XXXXX-XXXXX-XXXXX",
  },
  {
    value: "yugioh",
    label: "Yu-Gi-Oh!",
    service: "Yu-Gi-Oh! digital",
    codeExample: "Enter a redemption code",
  },
  {
    value: "onepiece",
    label: "One Piece",
    service: "One Piece digital",
    codeExample: "Enter a redemption code",
  },
  {
    value: "lorcana",
    label: "Disney Lorcana",
    service: "Disney Lorcana digital",
    codeExample: "Enter a redemption code",
  },
  {
    value: "dragonball",
    label: "Dragon Ball Super",
    service: "Dragon Ball Super digital",
    codeExample: "Enter a redemption code",
  },
] as const;

export function getOnlineCodeGame(tcg: TcgCode): OnlineCodeGame {
  return onlineCodeGames.find((game) => game.value === tcg)!;
}

export function normalizeOnlineCode(value: string): string {
  return value.trim().replace(/\s+/g, "").toLocaleUpperCase("en-US");
}

export function parseOnlineCodeInput(value: string): string[] {
  const values = value
    .split(/[\n,;]+/)
    .map((code) => code.trim())
    .filter(Boolean);
  const seen = new Set<string>();
  return values.filter((code) => {
    const normalized = normalizeOnlineCode(code);
    return (
      normalized.length >= 4 && !seen.has(normalized) && !!seen.add(normalized)
    );
  });
}

export function groupOnlineCodes<T>(codes: T[], size = 10): T[][] {
  if (!Number.isInteger(size) || size < 1) return [];
  return Array.from({ length: Math.ceil(codes.length / size) }, (_, index) =>
    codes.slice(index * size, index * size + size),
  );
}
