import { env } from '../config/env';
import { prisma } from './prisma';

interface SessionUserLike {
  id: string;
  email: string;
  username?: string | null;
  isAdmin?: boolean;
  showCardNumbers?: boolean;
  showPricing?: boolean;
}

let singleUserPromise: Promise<SessionUserLike> | null = null;

function buildFallbackSingleUser(): SessionUserLike {
  return {
    id: env.SINGLE_USER_ID,
    email: env.SINGLE_USER_EMAIL,
    username: env.SINGLE_USER_USERNAME,
    isAdmin: true,
    showCardNumbers: true,
    showPricing: true
  };
}

function mapStoredUser(user: {
  id: string;
  email: string;
  username: string | null;
  isAdmin: boolean;
  showCardNumbers: boolean;
  showPricing: boolean;
}): SessionUserLike {
  return {
    id: user.id,
    email: user.email,
    username: user.username,
    isAdmin: user.isAdmin,
    showCardNumbers: user.showCardNumbers,
    showPricing: user.showPricing
  };
}

async function ensureSingleUserRecord(): Promise<SessionUserLike> {
  const fallbackUser = buildFallbackSingleUser();

  if (!process.env.DATABASE_URL) {
    return fallbackUser;
  }

  const existingUser = await prisma.user.findFirst({
    where: {
      OR: [
        { id: env.SINGLE_USER_ID },
        { email: env.SINGLE_USER_EMAIL },
        { username: env.SINGLE_USER_USERNAME }
      ]
    },
    select: {
      id: true,
      email: true,
      username: true,
      isAdmin: true,
      showCardNumbers: true,
      showPricing: true
    }
  });

  if (existingUser) {
    const updatedUser = await prisma.user.update({
      where: { id: existingUser.id },
      data: { isAdmin: true },
      select: {
        id: true,
        email: true,
        username: true,
        isAdmin: true,
        showCardNumbers: true,
        showPricing: true
      }
    });

    return mapStoredUser(updatedUser);
  }

  const createdUser = await prisma.user.create({
    data: {
      id: env.SINGLE_USER_ID,
      email: env.SINGLE_USER_EMAIL,
      username: env.SINGLE_USER_USERNAME,
      isAdmin: true
    },
    select: {
      id: true,
      email: true,
      username: true,
      isAdmin: true,
      showCardNumbers: true,
      showPricing: true
    }
  });

  return mapStoredUser(createdUser);
}

export function isSingleUserModeEnabled(): boolean {
  return env.SINGLE_USER_MODE;
}

export async function getSingleUserSessionUser(): Promise<SessionUserLike | null> {
  if (!env.SINGLE_USER_MODE) {
    return null;
  }

  if (!singleUserPromise) {
    singleUserPromise = ensureSingleUserRecord().catch((error) => {
      singleUserPromise = null;
      throw error;
    });
  }

  return singleUserPromise;
}
