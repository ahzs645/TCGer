import {
  collectionMutationHistoryQuerySchema,
  collectionMutationKindSchema,
  undoCollectionMutationSchema
} from '@tcg/api-types';

describe('collection mutation audit contracts', () => {
  it('accepts every append-only operation kind', () => {
    for (const kind of ['add', 'update', 'remove', 'move', 'bulk', 'import', 'undo']) {
      expect(collectionMutationKindSchema.parse(kind)).toBe(kind);
    }
  });

  it('bounds history queries and requires an idempotency key for undo', () => {
    expect(collectionMutationHistoryQuerySchema.parse({}).limit).toBe(50);
    expect(() => collectionMutationHistoryQuerySchema.parse({ limit: 101 })).toThrow();
    expect(() => undoCollectionMutationSchema.parse({ idempotencyKey: 'short' })).toThrow();
    expect(
      undoCollectionMutationSchema.parse({
        idempotencyKey: 'undo-request-123'
      })
    ).toEqual({ idempotencyKey: 'undo-request-123' });
  });
});
