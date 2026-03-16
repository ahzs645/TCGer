import type { DeckValidationResult } from '@tcg/api-types';
import { validateMagicDeck } from './magic-formats';
import { validateYugiohDeck } from './yugioh-formats';
import { validatePokemonDeck } from './pokemon-formats';

export function validateDeck(
  tcg: string,
  cards: Array<{ name: string; quantity: number; isSideboard: boolean; isCommander?: boolean; cardData?: Record<string, unknown> }>,
  format?: string
): DeckValidationResult {
  switch (tcg) {
    case 'magic':
      return validateMagicDeck(cards, format || 'standard');
    case 'yugioh':
      return validateYugiohDeck(cards, format || 'tcg');
    case 'pokemon':
      return validatePokemonDeck(cards, format || 'standard');
    default:
      return { valid: true, errors: [], warnings: [`Unknown TCG "${tcg}"`] };
  }
}
