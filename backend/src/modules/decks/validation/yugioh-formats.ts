import type { DeckValidationResult } from '@tcg/api-types';

export function validateYugiohDeck(
  cards: Array<{ name: string; quantity: number; isSideboard: boolean; cardData?: Record<string, unknown> }>,
  _format: string
): DeckValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  const mainDeck = cards.filter(c => !c.isSideboard);
  const sideboard = cards.filter(c => c.isSideboard);

  // Separate main deck into main + extra deck by card type
  const extraTypes = ['Fusion Monster', 'Synchro Monster', 'Xyz Monster', 'Link Monster'];
  const mainCards = mainDeck.filter(c => {
    const type = (c.cardData as any)?.cardType || '';
    return !extraTypes.some(t => type.includes(t));
  });
  const extraCards = mainDeck.filter(c => {
    const type = (c.cardData as any)?.cardType || '';
    return extraTypes.some(t => type.includes(t));
  });

  const mainCount = mainCards.reduce((s, c) => s + c.quantity, 0);
  const extraCount = extraCards.reduce((s, c) => s + c.quantity, 0);
  const sideCount = sideboard.reduce((s, c) => s + c.quantity, 0);

  if (mainCount < 40) errors.push(`Main Deck has ${mainCount} cards, minimum is 40`);
  if (mainCount > 60) errors.push(`Main Deck has ${mainCount} cards, maximum is 60`);
  if (extraCount > 15) errors.push(`Extra Deck has ${extraCount} cards, maximum is 15`);
  if (sideCount > 15) errors.push(`Side Deck has ${sideCount} cards, maximum is 15`);

  // Copy limit: max 3 of any card
  const nameCounts = new Map<string, number>();
  for (const card of cards) {
    nameCounts.set(card.name, (nameCounts.get(card.name) || 0) + card.quantity);
  }
  for (const [name, count] of nameCounts) {
    if (count > 3) errors.push(`"${name}" has ${count} copies, maximum is 3`);
  }

  if (mainCount > 0 && mainCount < 40) {
    warnings.push('Deck is below minimum size');
  }

  return { valid: errors.length === 0, errors, warnings, format: _format || 'tcg' };
}
