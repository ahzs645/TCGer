/** Real anonymous-local Convex acceptance through the shipping Express auth and
 * inventory proxy. Requires a disposable backend already running on localhost. */
import assert from 'node:assert/strict';
import { createHmac, randomUUID } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import express from 'express';
import { env } from '../config/env';
import { authRouter } from '../api/routes/auth.router';
import { usersRouter } from '../api/routes/users.router';
import { convexCollectionsRouter } from '../api/routes/collections.convex.router';
import { convexFinanceRouter } from '../api/routes/finance.convex.router';
import { errorHandler } from '../api/middleware/error-handler';

async function main() {
  assert.equal(process.env.TCGER_ACCEPTANCE_CONVEX, 'anonymous-local');
  assert.equal(env.BACKEND_MODE, 'convex');
  assert.ok(['127.0.0.1', 'localhost'].includes(new URL(env.CONVEX_HTTP_ORIGIN!).hostname));
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { (req as any).log = { error: () => {}, warn: () => {} }; next(); });
  app.use('/auth', authRouter);
  app.use('/users', usersRouter);
  app.use('/collections', convexCollectionsRouter);
  app.use('/finance', convexFinanceRouter);
  app.use(errorHandler);
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  let cookie = '';
  const request = (path: string, method: string, body?: unknown, session = cookie) => fetch(origin + path, {
    method, headers: { 'Content-Type': 'application/json',
      ...(process.env.TCGER_ACCEPTANCE_AUTH_ORIGIN ? { Origin: process.env.TCGER_ACCEPTANCE_AUTH_ORIGIN } : {}),
      ...(session ? { Cookie: session } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const signup = async () => {
    const response = await request('/auth/sign-up/email', 'POST', {
      name: 'Acceptance owner', email: `acceptance-${randomUUID()}@example.test`, password: `Disposable-${randomUUID()}`,
    }, '');
    assert.equal(response.status, 200, `Real signup failed: ${response.status} ${(await response.clone().text()).slice(0, 500)}`);
    const cookies = response.headers.getSetCookie().map(value => value.split(';')[0]!);
    const expectedSecret = process.env.TCGER_ACCEPTANCE_BETTER_AUTH_SECRET;
    if (expectedSecret) {
      const tokenCookie = cookies.find(value => value.startsWith('better-auth.session_token='));
      assert.ok(tokenCookie, 'Real signup must return a signed session token');
      const signed = decodeURIComponent(tokenCookie.slice(tokenCookie.indexOf('=') + 1));
      const separator = signed.lastIndexOf('.');
      const expected = createHmac('sha256', expectedSecret).update(signed.slice(0, separator)).digest('base64');
      assert.ok(separator > 0 && signed.slice(separator + 1) === expected, 'Session cookie must be signed with the custom deployment secret');
    }
    const session = cookies.join('; ');
    assert.ok(session, 'Signup must return a usable session cookie');
    return session;
  };
  try {
    const restartReceipt = process.env.TCGER_ACCEPTANCE_RESTART_RECEIPT;
    if (restartReceipt && existsSync(restartReceipt)) {
      const previous = JSON.parse(readFileSync(restartReceipt, 'utf8')) as { cookie: string; binderId: string; copyId: string };
      const persisted = await request(`/collections/${previous.binderId}`, 'GET', undefined, previous.cookie);
      assert.equal(persisted.status, 200, 'Local restart must preserve the custom-secret session and existing private binder');
      const cards = (await persisted.json() as { cards: Array<{ copies: Array<{ id: string }> }> }).cards;
      assert.deepEqual(cards.flatMap(card => card.copies.map(copy => copy.id)), [previous.copyId]);
      console.log('PASS local bootstrap restart: session, private binder, and exact physical copy persisted.');
    }
    cookie = await signup();
    const session = await request('/auth/get-session', 'GET');
    assert.equal(session.status, 200);
    assert.ok((await session.json() as { user?: { id: string } }).user?.id, 'Real auth must recognize the new session');
    const create = await request('/collections', 'POST', { name: 'Fresh Convex account' });
    assert.equal(create.status, 201, await create.clone().text());
    const binder = await create.json() as { id: string };
    const input = { operationId: randomUUID(), source: 'scanner', rows: [{ rowId: 'reviewed-copy', cardId: 'local-acceptance-print', cardData: { tcg: 'pokemon', externalId: 'local-acceptance-print', name: 'Reviewed physical card' }, quantity: 3, notes: 'Preserve sibling metadata', acquisitionPrice: 12.5, acquisitionCurrency: 'CAD' }] };
    const intake = await request(`/collections/${binder.id}/intake`, 'POST', input);
    assert.equal(intake.status, 201, await intake.clone().text());
    const receipt = await intake.json() as { entryIds: string[] };
    assert.equal(receipt.entryIds.length, 3);
    assert.deepEqual(await (await request(`/collections/${binder.id}/intake`, 'POST', input)).json(), receipt);
    const saleInput = { operationId: randomUUID(), collectionId: binder.id, copyIds: [receipt.entryIds[0]], amount: 25, currency: 'CAD', removeFromInventory: true };
    const sale = await request('/finance/sales', 'POST', saleInput);
    assert.equal(sale.status, 201, await sale.clone().text());
    const saleReceipt = await sale.json();
    assert.deepEqual(await (await request('/finance/sales', 'POST', saleInput)).json(), saleReceipt);
    assert.equal((await request('/finance/sales', 'POST', { ...saleInput, amount: 30 })).status, 409);
    const detail = await request(`/collections/${binder.id}`, 'GET');
    assert.equal(detail.status, 200, await detail.clone().text());
    const cards = (await detail.json() as { cards: Array<{ quantity: number; copies: Array<{ id: string; acquisitionCurrency?: string; notes?: string }> }> }).cards;
    assert.equal(cards[0].quantity, 2);
    assert.deepEqual(new Set(cards[0].copies.map(copy => copy.id)), new Set(receipt.entryIds.slice(1)));
    assert.ok(cards[0].copies.every(copy => copy.acquisitionCurrency === 'CAD' && copy.notes === 'Preserve sibling metadata'));
    const summary = await request('/finance/summary', 'GET');
    assert.equal(summary.status, 200, await summary.clone().text());
    assert.deepEqual(await summary.json(), { totalSpent: 0, totalEarned: 0, profitLoss: 0, transactionCount: 1 });
    const otherSession = await signup();
    assert.equal((await request(`/collections/${binder.id}/copies/${receipt.entryIds[1]}`, 'DELETE', undefined, otherSession)).status, 404);
    const remove = await request(`/collections/${binder.id}/copies/${receipt.entryIds[1]}`, 'DELETE');
    assert.equal(remove.status, 204, await remove.clone().text());
    if (restartReceipt) writeFileSync(restartReceipt, JSON.stringify({ cookie, binderId: binder.id, copyId: receipt.entryIds[2] }), { mode: 0o600 });
    console.log('PASS real anonymous Convex + Express: email signup, session validation, first binder/inventory writes, exact copy intake receipts, atomic sale replay/conflict, CAD accounting, sibling preservation, foreign-copy denial, single-copy deletion.');

    const nativeOrigin = process.env.TCGER_ACCEPTANCE_AUTH_ORIGIN;
    if (nativeOrigin) {
      // Exercise native bearer transport through both public account aliases.
      // Cookie-authenticated negative cases prove the proxy cannot manufacture
      // a trusted origin to bypass Better Auth's CSRF checks.
      const account = { name: 'Native auth acceptance', username: `native${randomUUID().replaceAll('-', '')}`,
        email: `native-${randomUUID()}@example.test`, password: `Disposable-${randomUUID()}` };
      const signupResponse = await request('/auth/sign-up/email', 'POST', account, '');
      assert.equal(signupResponse.status, 200, 'Native signup must accept the declared API origin');
      const initial = await signupResponse.json() as { token: string };
      assert.ok(initial.token, 'Native signup must return a bearer session');
      const initialCookie = signupResponse.headers.getSetCookie().map(value => value.split(';')[0]).join('; ');
      const newPassword = `Changed-${randomUUID()}`;
      const authRequest = (path: string, method: string, body: unknown, headers: Record<string, string>) => fetch(origin + path, {
        method, headers: { 'Content-Type': 'application/json', ...headers },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      for (const rejectedOrigin of [undefined, 'https://untrusted.invalid']) {
        const denied = await authRequest('/users/me/change-password', 'POST',
          { currentPassword: account.password, newPassword },
          { Cookie: initialCookie, ...(rejectedOrigin ? { Origin: rejectedOrigin } : {}) });
        assert.equal(denied.status, 403, 'Missing/untrusted Origin must not change a cookie-authenticated password');
      }
      const unchanged = await request('/auth/sign-in/username', 'POST', { username: account.username, password: account.password }, '');
      assert.equal(unchanged.status, 200, 'Rejected password requests must leave the old password usable');
      const beforeChange = await unchanged.json() as { token: string };
      const change = await authRequest('/users/me/change-password', 'POST',
        { currentPassword: account.password, newPassword },
        { Authorization: `Bearer ${initial.token}`, Origin: nativeOrigin });
      assert.equal(change.status, 200, 'Native password-change alias must accept the declared API origin');
      const signin = await request('/auth/sign-in/username', 'POST', { username: account.username, password: newPassword }, '');
      assert.equal(signin.status, 200, 'Fresh native sign-in must accept the changed password');
      const signedIn = await signin.json() as { token: string };
      const signedInCookie = signin.headers.getSetCookie().map(value => value.split(';')[0]).join('; ');
      for (const rejectedOrigin of [undefined, 'https://untrusted.invalid']) {
        const denied = await authRequest('/users/me', 'DELETE', { password: newPassword },
          { Cookie: signedInCookie, ...(rejectedOrigin ? { Origin: rejectedOrigin } : {}) });
        assert.equal(denied.status, 403, 'Missing/untrusted Origin must not delete a cookie-authenticated account');
      }
      const nativeHeaders = { Authorization: `Bearer ${signedIn.token}`, Origin: nativeOrigin };
      assert.equal((await authRequest('/users/me', 'GET', undefined, nativeHeaders)).status, 200,
        'Rejected delete requests must preserve the account and bearer session');
      assert.equal((await authRequest('/auth/sign-out', 'POST', {},
        { Authorization: `Bearer ${beforeChange.token}`, Origin: nativeOrigin })).status, 200,
        'Native signout must accept the declared API origin');
      const deleted = await authRequest('/users/me', 'DELETE', { password: newPassword }, nativeHeaders);
      assert.equal(deleted.status, 200, 'Native account-delete alias must accept the declared API origin');
      assert.equal((await authRequest('/users/me', 'GET', undefined, nativeHeaders)).status, 401,
        'Deleted native account must no longer authenticate');
      console.log('PASS real native bearer account lifecycle: declared-origin signup, password-change alias, fresh username sign-in, signout and account-delete alias; missing/untrusted cookie origins rejected without password/account changes.');
    }
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
