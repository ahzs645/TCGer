import type { DeckValidationResult } from '@tcg/api-types';
import {
  inferYugiohZone,
  resolveYugiohBaseId,
  type YugiohDeckDomainCard
} from '../yugioh-domain';

export function validateYugiohDeck(
  cards: YugiohDeckDomainCard[],
  _format: string
): DeckValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  const mainCards = cards.filter(c => inferYugiohZone(c) === 'main');
  const extraCards = cards.filter(c => inferYugiohZone(c) === 'extra');
  const sideboard = cards.filter(c => inferYugiohZone(c) === 'side');

  const mainCount = mainCards.reduce((s, c) => s + c.quantity, 0);
  const extraCount = extraCards.reduce((s, c) => s + c.quantity, 0);
  const sideCount = sideboard.reduce((s, c) => s + c.quantity, 0);

  if (mainCount < 40) errors.push(`Main Deck has ${mainCount} cards, minimum is 40`);
  if (mainCount > 60) errors.push(`Main Deck has ${mainCount} cards, maximum is 60`);
  if (extraCount > 15) errors.push(`Extra Deck has ${extraCount} cards, maximum is 15`);
  if (sideCount > 15) errors.push(`Side Deck has ${sideCount} cards, maximum is 15`);

  // Copy limit: max 3 of any card
  const nameCounts = new Map<string, { name: string; count: number }>();
  for (const card of cards) {
    const baseId = resolveYugiohBaseId(card);
    const current = nameCounts.get(baseId) ?? { name: card.name, count: 0 };
    current.count += card.quantity;
    nameCounts.set(baseId, current);
  }
  for (const { name, count } of nameCounts.values()) {
    if (count > 3) errors.push(`"${name}" has ${count} copies, maximum is 3`);
  }

  if (mainCount > 0 && mainCount < 40) {
    warnings.push('Deck is below minimum size');
  }

  return { valid: errors.length === 0, errors, warnings, format: _format || 'tcg' };
}
