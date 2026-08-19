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

const redemptionCodeParameters = new Set([
  "2d_code",
  "code",
  "redeem_code",
  "redemption_code",
]);

function normalizeDashes(value: string): string {
  return value.replace(/[‐‑‒–—―]/g, "-");
}

export function canonicalizeOnlineCode(value: string): string {
  const cleaned = normalizeDashes(value.trim());
  if (!cleaned) return "";

  try {
    const url = new URL(cleaned);
    for (const [name, candidate] of url.searchParams) {
      if (redemptionCodeParameters.has(name.toLocaleLowerCase("en-US"))) {
        const code = normalizeDashes(candidate.trim());
        if (code) return code;
      }
    }
  } catch {
    // Printed codes are expected to be non-URL values.
  }

  const queryMatch = cleaned.match(
    /[?&](?:2d_code|code|redeem_code|redemption_code)=([^&#]+)/i,
  );
  if (queryMatch?.[1]) {
    try {
      return normalizeDashes(decodeURIComponent(queryMatch[1])).trim();
    } catch {
      return normalizeDashes(queryMatch[1]).trim();
    }
  }

  return cleaned;
}

export function normalizeOnlineCode(value: string): string {
  return canonicalizeOnlineCode(value)
    .replace(/\s+/g, "")
    .toLocaleUpperCase("en-US");
}

export function parseOnlineCodeInput(value: string): string[] {
  const values = value
    .split(/[\n,;]+/)
    .map(canonicalizeOnlineCode)
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
