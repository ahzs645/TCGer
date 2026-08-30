jest.mock('../../lib/prisma', () => ({
  prisma: {
    transaction: {
      findMany: jest.fn(),
      create: jest.fn(),
      findFirst: jest.fn(),
      delete: jest.fn(),
    },
  },
}));

import { Prisma } from '@prisma/client';
import { createTransactionSchema } from '@tcg/api-types';
import { prisma } from '../../lib/prisma';
import { createTransaction } from './finance.service';

describe('finance transaction serialization', () => {
  afterEach(() => jest.clearAllMocks());

  test('returns a numeric amount and ISO date after creation', async () => {
    const date = new Date('2026-07-15T12:34:56.000Z');
    jest.mocked(prisma.transaction.create).mockResolvedValue({
      id: 'transaction-1',
      userId: 'user-1',
      type: 'purchase',
      cardId: null,
      collectionEntryId: null,
      externalId: null,
      tcg: 'pokemon',
      cardName: 'Pikachu',
      quantity: 1,
      amount: new Prisma.Decimal('12.34'),
      currency: 'USD',
      platform: null,
      sourceUrl: null,
      notes: null,
      date,
      createdAt: date,
      updatedAt: date,
    });

    const transaction = await createTransaction('user-1', {
      type: 'purchase',
      tcg: 'pokemon',
      cardName: 'Pikachu',
      quantity: 1,
      amount: 12.34,
      currency: 'USD',
    });

    expect(transaction).toMatchObject({
      id: 'transaction-1',
      amount: 12.34,
      date: '2026-07-15T12:34:56.000Z',
    });
    expect(typeof transaction.amount).toBe('number');
  });

  test.each([0, -1])('rejects a non-positive transaction amount: %s', (amount) => {
    expect(() => createTransactionSchema.parse({ type: 'purchase', amount })).toThrow();
  });

  test('normalizes a valid ISO currency code', () => {
    expect(
      createTransactionSchema.parse({
        type: 'sale',
        amount: 12.5,
        currency: 'cad',
      }).currency,
    ).toBe('CAD');
  });
});
