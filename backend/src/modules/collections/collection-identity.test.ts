jest.mock('../../lib/prisma', () => ({ prisma: {} }));

import type { Prisma } from '@prisma/client';
import { ensureCardForCollection } from './collections.service';

function database() {
  const cards = new Map<string, any>([
    ['001', { id: '001', tcgGameId: 1, externalId: '001', name: 'Pokemon', tcgSpecific: { provenance: { source: 'original' } } }]
  ]);
  const tx = {
    tcgGame: { findFirst: jest.fn(async ({ where }) => ({ id: where.code === 'pokemon' ? 1 : 2 })) },
    card: {
      findUnique: jest.fn(async ({ where }) => where.id ? cards.get(where.id) ?? null : [...cards.values()].find((card) =>
        card.tcgGameId === where.tcgGameId_externalId.tcgGameId && card.externalId === where.tcgGameId_externalId.externalId) ?? null),
      update: jest.fn(async ({ where, data }) => {
        const existing = cards.get(where.id);
        const updated = { ...existing, ...Object.fromEntries(Object.entries(data).filter(([, value]) => value !== undefined)) };
        cards.set(where.id, updated);
        return updated;
      }),
      create: jest.fn(async ({ data }) => { cards.set(data.id, data); return data; })
    }
  };
  return { tx, cards, client: tx as unknown as Prisma.TransactionClient };
}

describe('game-scoped collection card resolution', () => {
  it('creates a distinct printing for a colliding game and reuses it on subsequent adds', async () => {
    const { tx, cards, client } = database();
    const original = structuredClone(cards.get('001'));
    const magic = await ensureCardForCollection(client, '001', { name: 'Magic', tcg: 'magic', externalId: '001' });
    expect(magic.id).not.toBe('001');
    expect(magic.tcgGameId).toBe(2);
    expect(cards.get('001')).toEqual(original);
    const again = await ensureCardForCollection(client, '001', { name: 'Magic', tcg: 'magic', externalId: '001' });
    expect(again.id).toBe(magic.id);
    expect(cards.size).toBe(2);
    expect(tx.card.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: magic.id } }));
  });

  it('preserves metadata when refreshing the same printing with a sparse payload', async () => {
    const { client, tx } = database();
    const result = await ensureCardForCollection(client, '001', { name: 'Pokemon', tcg: 'pokemon', externalId: '001' });
    expect(result.id).toBe('001');
    expect(result.tcgSpecific).toEqual({ provenance: { source: 'original' } });
    expect(tx.card.create).not.toHaveBeenCalled();
  });

  it('does not relabel a same-game card when the supplied printing identity differs', async () => {
    const { client, cards } = database();
    const result = await ensureCardForCollection(client, '001', { name: 'Other printing', tcg: 'pokemon', externalId: '002' });
    expect(result.id).not.toBe('001');
    expect(result.externalId).toBe('002');
    expect(cards.get('001').externalId).toBe('001');
  });
});
