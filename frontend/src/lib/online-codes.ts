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

/**
 * Infers the game only when the QR destination or printed-code shape is
 * distinctive. Unknown formats deliberately remain user-selectable.
 */
export function detectOnlineCodeGame(value: string): TcgCode | undefined {
  const cleaned = normalizeDashes(value.trim());
  if (!cleaned) return undefined;

  try {
    const url = new URL(cleaned);
    const hostname = url.hostname.toLocaleLowerCase("en-US");
    const path = url.pathname.toLocaleLowerCase("en-US");

    if (hostname === "pokemon.com" || hostname.endsWith(".pokemon.com")) {
      return "pokemon";
    }
    if (
      hostname === "magic.wizards.com" ||
      (hostname.endsWith(".wizards.com") && /(?:mtg|arena)/.test(path))
    ) {
      return "magic";
    }
  } catch {
    // Most printed redemption codes are not URLs.
  }

  const code = normalizeOnlineCode(cleaned);
  if (/^[A-Z0-9]{4}(?:-[A-Z0-9]{4}){2}-[A-Z0-9]{3}$/.test(code)) {
    return "pokemon";
  }
  if (/^[A-Z0-9]{5}(?:-[A-Z0-9]{5}){4}$/.test(code)) {
    return "magic";
  }

  return undefined;
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
