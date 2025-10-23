import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export const GAME_LABELS: Record<string, string> = {
  all: 'All Games',
  yugioh: 'Yu-Gi-Oh!',
  magic: 'Magic: The Gathering',
  pokemon: 'Pokémon'
};

export type SupportedGame = keyof typeof GAME_LABELS;

export const DEFAULT_API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3000';
