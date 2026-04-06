import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export const GAME_LABELS = {
  all: "All Games",
  yugioh: "Yu-Gi-Oh!",
  magic: "Magic: The Gathering",
  pokemon: "Pokémon",
} as const;

export type SupportedGame = keyof typeof GAME_LABELS;

const CARD_BACK_IMAGES: Record<string, string> = {
  pokemon: "/images/pokemon-card-back.png",
  magic: "/images/mtg-card-back.png",
  yugioh: "/images/yugioh-card-back.png",
};

const DEFAULT_CARD_BACK = "/images/pokemon-card-back.png";

export function getCardBackImage(tcg?: string): string {
  return (tcg && CARD_BACK_IMAGES[tcg]) || DEFAULT_CARD_BACK;
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

function getBrowserOrigin(): string | undefined {
  if (typeof window === "undefined") {
    return undefined;
  }

  return trimTrailingSlash(window.location.origin);
}

function replaceOriginPort(origin: string, port: string): string {
  const url = new URL(origin);
  url.port = port;
  return trimTrailingSlash(url.toString());
}

const publicSiteOrigin = process.env.NEXT_PUBLIC_SITE_URL
  ? trimTrailingSlash(process.env.NEXT_PUBLIC_SITE_URL)
  : undefined;
const publicApiBase = process.env.NEXT_PUBLIC_API_BASE_URL
  ? trimTrailingSlash(process.env.NEXT_PUBLIC_API_BASE_URL)
  : undefined;
const internalApiBase = process.env.BACKEND_API_ORIGIN
  ? trimTrailingSlash(process.env.BACKEND_API_ORIGIN)
  : undefined;
const browserApiBase =
  typeof window !== "undefined"
    ? trimTrailingSlash(new URL("/api", window.location.origin).toString())
    : undefined;

export const DEFAULT_API_BASE_URL =
  typeof window === "undefined"
    ? (internalApiBase ?? publicApiBase ?? "http://localhost:3004")
    : (publicApiBase ?? browserApiBase ?? "http://localhost:3004");

export function resolvePublicSiteOrigin(): string {
  return publicSiteOrigin ?? getBrowserOrigin() ?? "http://localhost:3003";
}

export function resolvePublicConvexOrigin(): string {
  if (process.env.NEXT_PUBLIC_CONVEX_URL) {
    return trimTrailingSlash(process.env.NEXT_PUBLIC_CONVEX_URL);
  }

  const browserOrigin = getBrowserOrigin();
  if (!browserOrigin) {
    return "http://localhost:3210";
  }

  return replaceOriginPort(browserOrigin, "3210");
}

export function resolvePublicConvexSiteOrigin(): string {
  if (process.env.NEXT_PUBLIC_CONVEX_SITE_URL) {
    return trimTrailingSlash(process.env.NEXT_PUBLIC_CONVEX_SITE_URL);
  }

  const browserOrigin = getBrowserOrigin();
  if (!browserOrigin) {
    return "http://localhost:3211";
  }

  return replaceOriginPort(browserOrigin, "3211");
}
