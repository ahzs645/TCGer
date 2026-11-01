jest.mock('./prisma', () => ({ prisma: { user: { upsert: jest.fn() } } }));
import { prisma } from './prisma';
import { provisionLegacyIdentity } from './legacy-identity';

const upsert = prisma.user.upsert as jest.Mock;
beforeEach(() => upsert.mockReset());

test('provisions a fresh authenticated subject before legacy writes and reuses its stable ID', async () => {
  upsert.mockResolvedValue({ id: 'auth-subject' });
  const identity = { id: 'auth-subject', email: 'collector@example.test', username: 'collector', isAdmin: false };
  await provisionLegacyIdentity(identity);
  await provisionLegacyIdentity(identity);
  expect(upsert).toHaveBeenCalledTimes(2);
  expect(upsert).toHaveBeenLastCalledWith({ where: { id: identity.id }, create: identity,
    update: { email: identity.email, username: identity.username, isAdmin: false } });
});

test('a conflicting email is a migration conflict, never an implicit identity merge', async () => {
  upsert.mockRejectedValue({ code: 'P2002' });
  await expect(provisionLegacyIdentity({ id: 'new-subject', email: 'existing@example.test' }))
    .rejects.toMatchObject({ status: 409, code: 'LEGACY_IDENTITY_CONFLICT' });
  expect(upsert).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'new-subject' } }));
});

test('storage failures do not become false authentication failures', async () => {
  upsert.mockRejectedValue(new Error('connection refused'));
  await expect(provisionLegacyIdentity({ id: 'subject', email: 'collector@example.test' }))
    .rejects.toMatchObject({ status: 503, code: 'LEGACY_IDENTITY_UNAVAILABLE' });
});
