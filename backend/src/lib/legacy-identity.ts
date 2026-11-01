/** The authenticated subject is the only identity join key. Never adopt a legacy
 * account merely because its email or username matches an incoming session. */
export interface LegacySessionIdentity {
  id: string;
  email: string;
  username?: string | null;
  isAdmin?: boolean;
}

export async function provisionLegacyIdentity(user: LegacySessionIdentity) {
  const { prisma } = await import('./prisma');
  try {
    await prisma.user.upsert({
      where: { id: user.id },
      create: {
        id: user.id,
        email: user.email,
        username: user.username ?? null,
        isAdmin: user.isAdmin ?? false,
      },
      update: {
        email: user.email,
        username: user.username ?? null,
        isAdmin: user.isAdmin ?? false,
      },
    });
  } catch (cause) {
    if (cause && typeof cause === 'object' && 'code' in cause && cause.code === 'P2002') {
      throw Object.assign(new Error('A legacy account has this email or username under a different identity. Migrate that account before using hybrid storage.'), {
        status: 409, code: 'LEGACY_IDENTITY_CONFLICT', cause,
      });
    }
    throw Object.assign(new Error('Legacy account storage is unavailable. Retry when the database is ready.'), {
      status: 503, code: 'LEGACY_IDENTITY_UNAVAILABLE', cause,
    });
  }
}
