jest.mock('../../lib/prisma', () => ({ prisma: {} }));
import type { Prisma } from '@prisma/client';
import { ensureCardForCollection } from './collections.service';

test('saving the first card from a future game registers its data namespace', async () => {
  const tx = {
    tcgGame: { findFirst: jest.fn(async () => null), upsert: jest.fn(async () => ({ id: 7, code: 'star-garden' })) },
    card: { findUnique: jest.fn(async () => null), create: jest.fn(async ({ data }) => data) },
  };
  const card = await ensureCardForCollection(tx as unknown as Prisma.TransactionClient, 'scout-1', { tcg: 'star-garden', externalId: 'scout-1', name: 'Moonseed Scout', attributes: { role: 'unit' } });
  expect(card.tcgGameId).toBe(7);
  expect(tx.tcgGame.upsert).toHaveBeenCalledWith(expect.objectContaining({ where: { code: 'star-garden' }, update: {} }));
  expect(card.externalId).toBe('scout-1');
  expect(card.tcgSpecific).toMatchObject({ attributes: { role: 'unit' } });
});
