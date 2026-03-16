import type { DeckValidationResult } from '@tcg/api-types';

interface FormatRules {
  minDeck: number;
  maxDeck: number;
  maxCopies: number;
  allowSideboard: boolean;
  maxSideboard: number;
  basicLandsExempt: boolean;
}

const FORMATS: Record<string, FormatRules> = {
  standard:  { minDeck: 60, maxDeck: Infinity, maxCopies: 4, allowSideboard: true, maxSideboard: 15, basicLandsExempt: true },
  modern:    { minDeck: 60, maxDeck: Infinity, maxCopies: 4, allowSideboard: true, maxSideboard: 15, basicLandsExempt: true },
  pioneer:   { minDeck: 60, maxDeck: Infinity, maxCopies: 4, allowSideboard: true, maxSideboard: 15, basicLandsExempt: true },
  legacy:    { minDeck: 60, maxDeck: Infinity, maxCopies: 4, allowSideboard: true, maxSideboard: 15, basicLandsExempt: true },
  vintage:   { minDeck: 60, maxDeck: Infinity, maxCopies: 4, allowSideboard: true, maxSideboard: 15, basicLandsExempt: true },
  commander: { minDeck: 100, maxDeck: 100, maxCopies: 1, allowSideboard: false, maxSideboard: 0, basicLandsExempt: true },
  pauper:    { minDeck: 60, maxDeck: Infinity, maxCopies: 4, allowSideboard: true, maxSideboard: 15, basicLandsExempt: true }
};

const BASIC_LANDS = ['Plains', 'Island', 'Swamp', 'Mountain', 'Forest', 'Wastes'];

export function validateMagicDeck(
  cards: Array<{ name: string; quantity: number; isSideboard: boolean; cardData?: Record<string, unknown> }>,
  format: string
): DeckValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const rules = FORMATS[format.toLowerCase()];

  if (!rules) {
    return { valid: true, warnings: [`Unknown format "${format}", skipping validation`], errors: [], format };
  }

  const mainDeck = cards.filter(c => !c.isSideboard);
  const sideboard = cards.filter(c => c.isSideboard);
  const mainCount = mainDeck.reduce((s, c) => s + c.quantity, 0);
  const sideCount = sideboard.reduce((s, c) => s + c.quantity, 0);

  if (mainCount < rules.minDeck) errors.push(`Main deck has ${mainCount} cards, minimum is ${rules.minDeck}`);
  if (mainCount > rules.maxDeck) errors.push(`Main deck has ${mainCount} cards, maximum is ${rules.maxDeck}`);
  if (!rules.allowSideboard && sideCount > 0) errors.push(`${format} does not allow a sideboard`);
  if (rules.allowSideboard && sideCount > rules.maxSideboard) errors.push(`Sideboard has ${sideCount} cards, maximum is ${rules.maxSideboard}`);

  // Check copy limits
  const nameCounts = new Map<string, number>();
  for (const card of cards) {
    const name = card.name;
    const isBasic = BASIC_LANDS.includes(name) || (card.cardData as any)?.supertypes?.includes('Basic');
    if (rules.basicLandsExempt && isBasic) continue;
    nameCounts.set(name, (nameCounts.get(name) || 0) + card.quantity);
  }
  for (const [name, count] of nameCounts) {
    if (count > rules.maxCopies) {
      errors.push(`"${name}" has ${count} copies, maximum is ${rules.maxCopies}`);
    }
  }

  // Commander-specific
  if (format.toLowerCase() === 'commander') {
    const commanders = cards.filter(c => (c as any).isCommander);
    if (commanders.length === 0) warnings.push('No commander designated');
    if (commanders.length > 2) errors.push('Maximum 2 commanders allowed (partner)');
  }

  return { valid: errors.length === 0, errors, warnings, format };
}
