import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export const GAME_LABELS = {
  all: 'All Games',
  yugioh: 'Yu-Gi-Oh!',
  magic: 'Magic: The Gathering',
  pokemon: 'Pokémon'
} as const;

export type SupportedGame = keyof typeof GAME_LABELS;

const CARD_BACK_IMAGES: Record<string, string> = {
  pokemon: '/images/pokemon-card-back.png',
  magic: '/images/mtg-card-back.png',
  yugioh: '/images/yugioh-card-back.png'
};

const DEFAULT_CARD_BACK = '/images/pokemon-card-back.png';

export function getCardBackImage(tcg?: string): string {
  return (tcg && CARD_BACK_IMAGES[tcg]) || DEFAULT_CARD_BACK;
}

const publicApiBase = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3001';
const internalApiBase = process.env.BACKEND_API_ORIGIN ?? publicApiBase;

export const DEFAULT_API_BASE_URL = typeof window === 'undefined' ? internalApiBase : publicApiBase;
