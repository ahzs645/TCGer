import type { DeckValidationResult } from '@tcg/api-types';

export function validatePokemonDeck(
  cards: Array<{ name: string; quantity: number; isSideboard: boolean; cardData?: Record<string, unknown> }>,
  format: string
): DeckValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const totalCount = cards.reduce((s, c) => s + c.quantity, 0);

  if (totalCount !== 60) {
    errors.push(`Deck has ${totalCount} cards, must be exactly 60`);
  }

  // Max 4 copies of any card (except basic energy)
  const nameCounts = new Map<string, number>();
  for (const card of cards) {
    const data = card.cardData as Record<string, unknown> | undefined;
    const supertype = (data?.supertype as string) || '';
    const subtypes = (data?.subtypes as string[]) || [];
    const isBasicEnergy = supertype === 'Energy' && subtypes.includes('Basic');
    if (isBasicEnergy) continue;

    nameCounts.set(card.name, (nameCounts.get(card.name) || 0) + card.quantity);
  }

  for (const [name, count] of nameCounts) {
    if (count > 4) errors.push(`"${name}" has ${count} copies, maximum is 4`);
  }

  // Check for at least one Basic Pokemon
  const hasBasicPokemon = cards.some(c => {
    const data = c.cardData as Record<string, unknown> | undefined;
    return (data?.supertype as string) === 'Pokémon' &&
           ((data?.subtypes as string[]) || []).includes('Basic');
  });
  if (!hasBasicPokemon) warnings.push('Deck has no Basic Pokémon — you cannot start the game');

  // Standard format: check regulation marks (simplified)
  if (format?.toLowerCase() === 'standard') {
    warnings.push('Standard format rotation check requires regulation mark data');
  }

  return { valid: errors.length === 0, errors, warnings, format: format || 'standard' };
}
