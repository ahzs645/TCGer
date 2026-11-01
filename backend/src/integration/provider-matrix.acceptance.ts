/** One real hybrid provider combination per process. Run all four combinations
 * with distinct empty migrated PostgreSQL databases and anonymous local Convex.
 * This qualifies auth + first writes and explicit cross-store operation limits. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createApp } from '../app';
import { env } from '../config/env';
import { prisma } from '../lib/prisma';

async function main() {
  assert.equal(process.env.TCGER_ACCEPTANCE_CONVEX, 'anonymous-local');
  assert.equal(process.env.TCGER_ACCEPTANCE_DATABASE, 'disposable');
  assert.equal(env.BACKEND_MODE, 'hybrid');
  assert.ok(['127.0.0.1', 'localhost'].includes(new URL(env.CONVEX_HTTP_ORIGIN!).hostname));
  assert.ok(['127.0.0.1', 'localhost'].includes(new URL(env.DATABASE_URL!).hostname));
  assert.equal(await prisma.user.count(), 0, 'Requires an empty migrated disposable database');
  const transport = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    if (['127.0.0.1', 'localhost'].includes(url.hostname)) return transport(input, init);
    return Response.json({ error: 'PROVIDER_UNAVAILABLE' }, { status: 503 });
  };
  const app = await createApp();
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  let cookie = '';
  const request = (path: string, method: string, body?: unknown, session = cookie) => transport(origin + path, {
    method, headers: { 'Content-Type': 'application/json', ...(session ? { Cookie: session } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const signup = async () => {
    const response = await request('/auth/sign-up/email', 'POST', { name: 'Matrix account', email: `matrix-${randomUUID()}@example.test`, password: `Disposable-${randomUUID()}` }, '');
    assert.equal(response.status, 200, `Real signup failed: ${response.status}`);
    const session = response.headers.getSetCookie().map(value => value.split(';')[0]).join('; ');
    assert.ok(session, 'Real signup must establish a session');
    return session;
  };
  try {
    cookie = await signup();
    const binderResponse = await request('/collections', 'POST', { name: 'First matrix binder' });
    assert.equal(binderResponse.status, 201, await binderResponse.clone().text());
    const binder = await binderResponse.json() as { id: string };
    assert.equal(await prisma.user.count(), 1, 'Hybrid auth must provision its legacy identity before the first write');
    assert.equal(await prisma.binder.count(), env.COLLECTIONS_BACKEND === 'prisma' ? 1 : 0);
    const copyResponse = await request(`/collections/${binder.id}/cards`, 'POST', {
      cardId: `matrix-${randomUUID()}`, cardData: { tcg: 'magic', externalId: `matrix-${randomUUID()}`, name: 'Matrix physical card' },
      quantity: 1, price: 1, acquisitionPrice: 2, acquisitionCurrency: 'CAD', notes: 'Persisted first copy',
    });
    assert.equal(copyResponse.status, 201, await copyResponse.clone().text());
    assert.equal(await prisma.collection.count(), env.COLLECTIONS_BACKEND === 'prisma' ? 1 : 0);
    const binderRead = await request(`/collections/${binder.id}`, 'GET');
    assert.equal(binderRead.status, 200, await binderRead.clone().text());
    const binderData = await binderRead.json() as { cards: Array<{ copies: Array<{ id: string; notes: string; acquisitionCurrency: string }> }> };
    const copy = binderData.cards.flatMap(card => card.copies)[0];
    assert.ok(copy); assert.equal(copy.notes, 'Persisted first copy'); assert.equal(copy.acquisitionCurrency, 'CAD');
    const wishlistResponse = await request('/wishlists', 'POST', { name: 'First matrix wishlist' });
    assert.equal(wishlistResponse.status, 201, await wishlistResponse.clone().text());
    const wishlist = await wishlistResponse.json() as { id: string };
    assert.equal(await prisma.wishlist.count(), env.WISHLISTS_BACKEND === 'prisma' ? 1 : 0);
    const wishlistAdd = await request(`/wishlists/${wishlist.id}/cards`, 'POST', { tcg: 'magic', externalId: 'matrix-wanted', name: 'Wanted card', desiredQuantity: 1 });
    assert.equal(wishlistAdd.status, 201, await wishlistAdd.clone().text());
    const wishlistRead = await request(`/wishlists/${wishlist.id}`, 'GET');
    assert.equal(wishlistRead.status, 200, await wishlistRead.clone().text());
    assert.equal((await wishlistRead.json() as { cards: unknown[] }).cards.length, 1);
    const foreign = await signup();
    assert.equal((await request(`/collections/${binder.id}/copies/${copy.id}`, 'DELETE', undefined, foreign)).status, 404);
    assert.equal((await request(`/wishlists/${wishlist.id}`, 'GET', undefined, foreign)).status, 404);
    assert.equal((await request(`/collections/${binder.id}/intake`, 'POST', {})).status, 501);
    assert.equal((await request('/finance/sales', 'POST', {})).status, 501);
    assert.equal((await request(`/collections/${binder.id}`, 'GET')).status, 200);
    console.log(`PASS hybrid first-write matrix: collections=${env.COLLECTIONS_BACKEND}, wishlists=${env.WISHLISTS_BACKEND}; real signup, identity provisioning, basic copy persistence, wishlist persistence, foreign ownership denial, unsupported atomic operations501.`);
  } finally {
    globalThis.fetch = transport;
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    await prisma.$disconnect();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
