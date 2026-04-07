import { env } from '../config/env';

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

async function ensureSingleUserRecord(): Promise<SessionUserLike> {
  return buildFallbackSingleUser();
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
