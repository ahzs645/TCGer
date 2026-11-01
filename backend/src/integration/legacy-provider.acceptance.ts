/** Real PostgreSQL acceptance, intentionally separate from mocked route tests.
 * Use an empty disposable database with migrations applied. Never run on user data. */
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import type { Prisma } from '@prisma/client';
import express from 'express';
import { prisma } from '../lib/prisma';
import { collectionsRouter } from '../api/routes/collections.router';
import { wishlistsRouter } from '../api/routes/wishlists.router';
import { errorHandler } from '../api/middleware/error-handler';
import { env } from '../config/env';
import { getUploadsRootDir } from '../utils/upload';

async function main() {
  assert.equal(process.env.TCGER_ACCEPTANCE_DATABASE, 'disposable');
  assert.equal(env.BACKEND_MODE, 'hybrid');
  assert.equal(await prisma.user.count(), 0, 'This acceptance suite requires an empty disposable database.');
  const transport = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    if (String(input).startsWith('https://identity.acceptance.test/')) {
      const auth = new Headers(init?.headers).get('authorization');
      const id = auth === 'Bearer owner-token' ? 'acceptance-owner' : auth === 'Bearer other-token' ? 'acceptance-other' : null;
      return Response.json(id ? { user: { id, email: `${id}@example.test`, isAdmin: false } } : {});
    }
    if (String(input).startsWith('http://127.0.0.1:') || String(input).startsWith('http://localhost:')) return transport(input, init);
    // Catalog enrichment is optional; this database acceptance must not depend
    // on external provider credentials, DNS, rate limits or availability.
    return Response.json({ error: 'PROVIDER_UNAVAILABLE' }, { status: 503 });
  };
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { (req as any).log = { error: () => {}, warn: () => {} }; next(); });
  app.use('/collections', collectionsRouter);
  app.use('/wishlists', wishlistsRouter);
  app.use(errorHandler);
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const request = (path: string, method: string, body?: unknown, token = 'owner-token') => transport(origin + path, {
    method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  try {
    const created = await request('/collections', 'POST', { name: 'Fresh account binder' });
    assert.equal(created.status, 201, await created.clone().text());
    const binder = await created.json() as { id: string };
    assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: 'acceptance-owner' } })).email, 'acceptance-owner@example.test');
    // Durable page recovery may retry after a committed response was lost. A
    // frozen revision prevents that retry from overwriting another device's edit.
    const pagePath = `/collections/${binder.id}/pages/1`;
    const frozenPage = { expectedRevision: 0, capturedAt: '2026-10-31T12:00:00.000Z', placements: [] };
    const pageCreate = await request(pagePath, 'PUT', frozenPage);
    assert.equal(pageCreate.status, 200, await pageCreate.clone().text());
    const page = await pageCreate.json() as { id: string; revision: number };
    assert.equal(page.revision, 1);
    assert.equal((await request(pagePath, 'PUT', frozenPage)).status, 409);
    const concurrent = await Promise.all([
      request(pagePath, 'PUT', { ...frozenPage, expectedRevision: 1, capturedAt: '2026-10-31T13:00:00.000Z' }),
      request(pagePath, 'PUT', { ...frozenPage, expectedRevision: 1, capturedAt: '2026-10-31T14:00:00.000Z' }),
    ]);
    assert.deepEqual(concurrent.map(response => response.status).sort(), [200, 409]);
    const currentPage = await prisma.binderPage.findUniqueOrThrow({ where: { id: page.id } });
    assert.equal(currentPage.revision, 2);
    assert.equal((await request(pagePath, 'PUT', { ...frozenPage, expectedRevision: 1 })).status, 409);
    assert.deepEqual(await prisma.binderPage.findUniqueOrThrow({ where: { id: page.id } }), currentPage);
    const imagesDir = path.join(getUploadsRootDir(), 'collection-images');
    const beforeFiles = readdirSync(imagesDir).sort();
    const upload = (revision: string, token = 'owner-token') => {
      const form = new FormData();
      form.set('image', new Blob(['durable page photo'], { type: 'image/png' }), 'page.png');
      form.set('expectedRevision', revision);
      return transport(origin + pagePath + '/image', { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: form });
    };
    const imageSave = await upload('2');
    assert.equal(imageSave.status, 201, await imageSave.clone().text());
    const imagePage = await imageSave.json() as { revision: number; imageUrl: string };
    assert.equal(imagePage.revision, 3);
    const imagePath = path.join(imagesDir, path.basename(imagePage.imageUrl));
    assert.equal(readFileSync(imagePath, 'utf8'), 'durable page photo');
    const committedFiles = readdirSync(imagesDir).sort();
    assert.equal(committedFiles.length, beforeFiles.length + 1);
    assert.equal((await upload('2')).status, 409);
    assert.equal((await upload('3', 'other-token')).status, 404);
    assert.equal((await upload('1.5')).status, 400);
    assert.deepEqual(readdirSync(imagesDir).sort(), committedFiles, 'Rejected uploads must be removed without deleting the committed image');
    assert.equal(readFileSync(imagePath, 'utf8'), 'durable page photo');
    assert.equal((await request(pagePath + '/image', 'DELETE')).status, 204);
    assert.equal((await prisma.binderPage.findUniqueOrThrow({ where: { id: page.id } })).revision, 4);
    assert.equal((await upload('3')).status, 409);
    assert.deepEqual(readdirSync(imagesDir).sort(), beforeFiles);
    assert.equal((await request(pagePath, 'PUT', { ...frozenPage, expectedRevision: 4 }, 'other-token')).status, 404);
    const createWishlist = await request('/wishlists', 'POST', { name: 'Fresh account wishlist' });
    assert.equal(createWishlist.status, 201, await createWishlist.clone().text());
    const wishlist = await createWishlist.json() as { id: string };
    assert.equal((await request(`/wishlists/${wishlist.id}`, 'GET')).status, 200);
    assert.equal((await request(`/wishlists/${wishlist.id}`, 'GET', undefined, 'other-token')).status, 404);
    assert.equal((await prisma.wishlist.findUniqueOrThrow({ where: { id: wishlist.id } })).userId, 'acceptance-owner');
    const add = await request(`/collections/${binder.id}/cards`, 'POST', {
      cardId: 'acceptance-print', quantity: 2,
      cardData: { tcg: 'pokemon', externalId: 'acceptance-print', name: 'Acceptance card' },
      condition: 'NM', notes: 'Original metadata', acquisitionPrice: 12.5, acquisitionCurrency: 'CAD',
    });
    assert.equal(add.status, 201, await add.clone().text());
    const copies = await prisma.collection.findMany({ where: { userId: 'acceptance-owner' }, orderBy: { id: 'asc' } });
    assert.equal(copies.length, 2);
    const [selected, sibling] = copies;
    assert.equal(sibling.acquisitionCurrency, 'CAD');
    const denied = await request(`/collections/${binder.id}/copies/${selected.id}`, 'DELETE', undefined, 'other-token');
    assert.equal(denied.status, 404);
    const edit = await request(`/collections/${binder.id}/cards/${selected.id}`, 'PATCH', { notes: 'Only this copy', cardOverride: { cardId: 'corrected-print', cardData: { tcg: 'pokemon', externalId: 'corrected-print', name: 'Corrected printing' } } });
    assert.equal(edit.status, 200, await edit.clone().text());
    assert.deepEqual(await prisma.collection.findUnique({ where: { id: sibling.id } }), sibling);
    const remove = await request(`/collections/${binder.id}/copies/${selected.id}`, 'DELETE');
    assert.equal(remove.status, 204, await remove.clone().text());
    assert.deepEqual(await prisma.collection.findUnique({ where: { id: sibling.id } }), sibling);
    await prisma.collection.update({ where: { id: sibling.id }, data: { quantity: 3, imageUrls: ['/saved-photo.webp'] } });
    const legacyRead = await request(`/collections/${binder.id}`, 'GET');
    assert.equal(legacyRead.status, 200, await legacyRead.clone().text());
    const legacyBinder = await legacyRead.json() as { cards: Array<{ quantity: number; copies: Array<{ id: string }> }> };
    assert.equal(legacyBinder.cards[0].quantity, 3);
    assert.deepEqual(new Set(legacyBinder.cards[0].copies.map((copy) => copy.id)), new Set([sibling.id, `${sibling.id}#2`, `${sibling.id}#3`]));
    assert.equal((await prisma.collection.findUniqueOrThrow({ where: { id: sibling.id } })).quantity, 3, 'Reading must not silently migrate data');
    const secondAddress = encodeURIComponent(`${sibling.id}#2`);
    const notes = await request(`/collections/${binder.id}/cards/${secondAddress}`, 'PATCH', { notes: 'Legacy metadata edit' });
    assert.equal(notes.status, 200, await notes.clone().text());
    const normalized = await prisma.collection.findMany({ where: { userId: 'acceptance-owner' } });
    assert.equal(normalized.length, 3);
    assert.ok(normalized.every((copy) => copy.quantity === 1 && copy.acquisitionCurrency === 'CAD' && copy.imageUrls[0] === '/saved-photo.webp'));
    assert.equal(normalized.filter((copy) => copy.notes === 'Legacy metadata edit').length, 1);
    assert.equal((await prisma.collection.findUniqueOrThrow({ where: { id: sibling.id } })).notes, 'Original metadata');
    const firstRemoval = await request(`/collections/${binder.id}/copies/${sibling.id}`, 'DELETE');
    assert.equal(firstRemoval.status, 204, await firstRemoval.clone().text());
    const thirdAddress = encodeURIComponent(`${sibling.id}#3`);
    const thirdEdit = await request(`/collections/${binder.id}/cards/${thirdAddress}`, 'PATCH', { condition: 'LP' });
    assert.equal(thirdEdit.status, 200, await thirdEdit.clone().text());
    assert.equal(await prisma.collection.count({ where: { userId: 'acceptance-owner' } }), 2);
    const secondCopy = await prisma.collection.findFirstOrThrow({ where: { userId: 'acceptance-owner', notes: 'Legacy metadata edit' } });
    const thirdCopy = await prisma.collection.findFirstOrThrow({ where: { userId: 'acceptance-owner', condition: 'LP' } });
    await prisma.collection.update({ where: { id: secondCopy.id }, data: { quantity: 2 } });
    await prisma.collection.update({ where: { id: thirdCopy.id }, data: { quantity: 3 } });
    const quantityEdit = await request(`/collections/${binder.id}/cards/${secondCopy.id}`, 'PATCH', { quantity: 4 });
    assert.equal(quantityEdit.status, 200, await quantityEdit.clone().text());
    const finalCopies = await prisma.collection.findMany({ where: { userId: 'acceptance-owner' } });
    assert.equal(finalCopies.length, 4);
    assert.ok(finalCopies.every((copy) => copy.quantity === 1));
    const group = await request(`/collections/${binder.id}/cards/${secondCopy.id}`, 'DELETE');
    assert.equal(group.status, 204, await group.clone().text());
    assert.equal(await prisma.collection.count({ where: { userId: 'acceptance-owner' } }), 0);
    const auditAdd = await request(`/collections/${binder.id}/cards`, 'POST', {
      cardId: 'audit-print', cardData: { tcg: 'pokemon', externalId: 'audit-print', name: 'Old audit compatibility' },
    });
    assert.equal(auditAdd.status, 201, await auditAdd.clone().text());
    const auditCopy = await prisma.collection.findFirstOrThrow({ where: { userId: 'acceptance-owner' } });
    const auditEdit = await request(`/collections/${binder.id}/cards/${auditCopy.id}`, 'PATCH', { notes: 'Edited later' });
    assert.equal(auditEdit.status, 200, await auditEdit.clone().text());
    const audit = await prisma.collectionMutationAudit.findFirstOrThrow({ where: { userId: 'acceptance-owner', operationKind: 'update' }, orderBy: { createdAt: 'desc' } });
    const withoutCurrency = (value: Prisma.JsonValue): Prisma.InputJsonValue => {
      const snapshot = structuredClone(value) as { entries: Array<Record<string, unknown>> };
      for (const entry of snapshot.entries) delete entry.acquisitionCurrency;
      return snapshot as Prisma.InputJsonValue;
    };
    await prisma.collectionMutationAudit.update({ where: { id: audit.id }, data: { beforeState: withoutCurrency(audit.beforeState), afterState: withoutCurrency(audit.afterState) } });
    const undo = await request(`/collections/history/${audit.id}/undo`, 'POST', { idempotencyKey: 'old-audit-undo-once' });
    assert.equal(undo.status, 201, await undo.clone().text());
    assert.equal((await prisma.collection.findUniqueOrThrow({ where: { id: auditCopy.id } })).notes, null);

    // Undo must preserve opening and purchase lineage, and refuse to overwrite
    // an intervening reassignment or financial edit while a copy was absent.
    await prisma.collection.update({ where: { id: auditCopy.id }, data: { acquisitionPrice: 8, acquisitionCurrency: 'CAD' } });
    const purchase = await prisma.transaction.create({ data: { userId: 'acceptance-owner', type: 'purchase', collectionEntryId: auditCopy.id, amount: 8, currency: 'CAD' } });
    const product = await prisma.sealedProduct.create({ data: { name: 'Acceptance sealed pack', tcg: 'pokemon', productType: 'booster' } });
    const inventory = await prisma.sealedInventory.create({ data: { userId: 'acceptance-owner', productId: product.id, quantity: 1 } });
    const opening = await prisma.sealedOpening.create({ data: { userId: 'acceptance-owner', sealedInventoryId: inventory.id, openedQuantity: 1 } });
    const link = await prisma.sealedOpenedCard.create({ data: { openingId: opening.id, collectionId: auditCopy.id, externalId: 'audit-print', tcg: 'pokemon', cardName: 'Old audit compatibility' } });
    const bypass = await request(`/collections/${binder.id}/cards/${auditCopy.id}`, 'PATCH', { acquisitionPrice: 9 });
    assert.equal(bypass.status, 409, await bypass.clone().text());
    assert.equal(Number((await prisma.collection.findUniqueOrThrow({ where: { id: auditCopy.id } })).acquisitionPrice), 8);
    const note = await request(`/collections/${binder.id}/cards/${auditCopy.id}`, 'PATCH', { notes: 'Metadata can still change', acquisitionPrice: 8, acquisitionCurrency: 'CAD' });
    assert.equal(note.status, 200, await note.clone().text());
    assert.equal((await request(`/collections/${binder.id}/copies/${auditCopy.id}`, 'DELETE')).status, 204);
    assert.equal((await prisma.sealedOpenedCard.findUniqueOrThrow({ where: { id: link.id } })).collectionId, null);
    const deletion = await prisma.collectionMutationAudit.findFirstOrThrow({ where: { userId: 'acceptance-owner', operationKind: 'remove' }, orderBy: { createdAt: 'desc' } });
    const restored = await request(`/collections/history/${deletion.id}/undo`, 'POST', { idempotencyKey: 'restore-linked-copy-once' });
    assert.equal(restored.status, 201, await restored.clone().text());
    assert.equal((await prisma.sealedOpenedCard.findUniqueOrThrow({ where: { id: link.id } })).collectionId, auditCopy.id);
    assert.equal(Number((await prisma.transaction.findUniqueOrThrow({ where: { id: purchase.id } })).amount), 8);
    const replay = await request(`/collections/history/${deletion.id}/undo`, 'POST', { idempotencyKey: 'restore-linked-copy-once' });
    assert.equal(replay.status, 201);
    assert.deepEqual(await replay.json(), await restored.json());

    assert.equal((await request(`/collections/${binder.id}/copies/${auditCopy.id}`, 'DELETE')).status, 204);
    const laterDeletion = await prisma.collectionMutationAudit.findFirstOrThrow({ where: { userId: 'acceptance-owner', operationKind: 'remove' }, orderBy: { createdAt: 'desc' } });
    const replacement = await prisma.collection.create({ data: { userId: 'acceptance-owner', binderId: binder.id, cardId: auditCopy.cardId } });
    await prisma.sealedOpenedCard.update({ where: { id: link.id }, data: { collectionId: replacement.id } });
    const reassigned = await request(`/collections/history/${laterDeletion.id}/undo`, 'POST', { idempotencyKey: 'refuse-reassigned-link' });
    assert.equal(reassigned.status, 409, await reassigned.clone().text());
    assert.equal(await prisma.collection.findUnique({ where: { id: auditCopy.id } }), null);
    assert.equal((await prisma.sealedOpenedCard.findUniqueOrThrow({ where: { id: link.id } })).collectionId, replacement.id);
    await prisma.sealedOpenedCard.update({ where: { id: link.id }, data: { collectionId: null } });
    await prisma.transaction.update({ where: { id: purchase.id }, data: { amount: 9 } });
    const changedLedger = await request(`/collections/history/${laterDeletion.id}/undo`, 'POST', { idempotencyKey: 'refuse-changed-purchase' });
    assert.equal(changedLedger.status, 409, await changedLedger.clone().text());
    assert.equal(await prisma.collection.findUnique({ where: { id: auditCopy.id } }), null);
    console.log('PASS real PostgreSQL: empty-account provisioning, binder-page revision races and upload cleanup, foreign-copy denial, sibling-preserving printing/edit/delete, CAD persistence, accurate legacy reads, durable synthetic copy addresses, multiple legacy quantity rows, grouped delete, old audit undo, opening/purchase lineage, replay and changed-ledger conflicts.');
  } finally {
    globalThis.fetch = transport;
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await prisma.$disconnect();
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
