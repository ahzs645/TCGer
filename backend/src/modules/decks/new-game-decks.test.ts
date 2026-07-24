import { createDeckSchema, importDeckSchema } from '@tcg/api-types';
import { validateDeck } from './validation';

describe('new-game generic deck support', () => {
  it.each(['onepiece', 'lorcana', 'dragonball'] as const)(
    'accepts %s deck creation and text imports without game-specific legality',
    (tcg) => {
      expect(createDeckSchema.parse({ name: 'Example Deck', tcg }).tcg).toBe(tcg);
      expect(importDeckSchema.parse({
        source: 'text',
        data: '4 Example Card',
        tcg
      }).tcg).toBe(tcg);
      expect(validateDeck(tcg, [])).toEqual({
        valid: true,
        errors: [],
        warnings: [`Unknown TCG "${tcg}"`]
      });
    }
  );
});
