import { validateGameDeck, type GameDeckRules, type DeckValidationResult } from '@tcg/api-types';
import { validateMagicDeck } from './magic-formats';
import { validateYugiohDeck } from './yugioh-formats';
import { validatePokemonDeck } from './pokemon-formats';

export function validateDeck(
  tcg: string,
  cards: Array<{
    externalId: string;
    name: string;
    quantity: number;
    zone?: string;
    isSideboard: boolean;
    isCommander?: boolean;
    cardData?: Record<string, unknown>;
  }>,
  format?: string,
  rules?: GameDeckRules
): DeckValidationResult {
  if (rules) return validateGameDeck(tcg, cards, rules, format);
  switch (tcg) {
    case 'magic':
      return validateMagicDeck(cards, format || 'standard');
    case 'yugioh':
      return validateYugiohDeck(cards, format || 'tcg');
    case 'pokemon':
      return validatePokemonDeck(cards, format || 'standard');
    default:
      return { valid: false, status: "unsupported", errors: [], warnings: [`No deck rules are installed for "${tcg}".`] };
  }
}
