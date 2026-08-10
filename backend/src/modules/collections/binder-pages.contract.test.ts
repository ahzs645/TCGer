import { upsertBinderPageSchema } from '@tcg/api-types';

const placement = {
  slotIndex: 0,
  cardId: 'sv3-125',
  name: 'Pikachu',
  tcg: 'pokemon',
  confidence: 0.94,
  status: 'matched',
  quad: {
    topLeft: { x: 0.1, y: 0.9 },
    topRight: { x: 0.3, y: 0.9 },
    bottomRight: { x: 0.3, y: 0.5 },
    bottomLeft: { x: 0.1, y: 0.5 }
  }
};

describe('persistent binder page contract', () => {
  it('accepts page placement metadata without requiring an image', () => {
    const parsed = upsertBinderPageSchema.parse({ pageNumber: 7, placements: [placement] });
    expect(parsed.pageNumber).toBe(7);
    expect(parsed.placements[0]?.cardId).toBe('sv3-125');
  });

  it('rejects invalid page numbers and coordinates', () => {
    expect(() => upsertBinderPageSchema.parse({ pageNumber: 0, placements: [] })).toThrow();
    expect(() => upsertBinderPageSchema.parse({
      pageNumber: 1,
      placements: [{ ...placement, quad: { ...placement.quad, topLeft: { x: -0.1, y: 1.1 } } }]
    })).toThrow();
  });
});
