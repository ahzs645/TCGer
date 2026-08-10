import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const DEVELOPMENT_BRIDGE_SECRET = 'tcger-local-convex-bridge-secret-2026';

const booleanEnv = z
  .enum(['true', 'false'])
  .optional()
  .default('false')
  .transform((value) => value === 'true');

const optionalSecretEnv = z.preprocess(
  (value) =>
    typeof value === 'string' && value.trim().length === 0 ? undefined : value,
  z.string().trim().min(1).optional()
);

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(3000),
  BACKEND_MODE: z.enum(['hybrid', 'convex']).default('hybrid'),
  DATABASE_URL: z.string().url().optional(),
  CARD_SCAN_STORE: z.enum(['auto', 'file', 'prisma']).default('auto'),
  CARD_SCAN_DATA_DIR: z.string().default('/tmp/tcger-card-scan'),
  CARD_SCAN_EMBEDDING_MODEL_PATH: z.string().optional(),
  CARD_SCAN_EMBEDDING_INDEX_PATH: z.string().optional(),
  CARD_SCAN_EMBEDDING_META_PATH: z.string().optional(),
  APP_ORIGIN: z.string().url().optional(),
  COLLECTIONS_BACKEND: z.enum(['prisma', 'convex']).default('prisma'),
  WISHLISTS_BACKEND: z.enum(['prisma', 'convex']).default('prisma'),
  CONVEX_HTTP_ORIGIN: z.string().url().optional(),
  TCGER_BRIDGE_SECRET: z.string().trim().min(32).optional(),
  SCRYDEX_API_KEY: z.string().optional(),
  SCRYDEX_TEAM_ID: z.string().optional(),
  SCRYFALL_API_BASE_URL: z.string().url().default('https://api.scryfall.com'),
  YGO_API_BASE_URL: z.string().url().default('https://db.ygoprodeck.com/api/v7'),
  POKEMON_API_BASE_URL: z.string().url().default('https://api.scrydex.com'),
  TCGDEX_API_BASE_URL: z.string().url().default('https://api.tcgdex.net/v2/en'),
  JUSTTCG_API_BASE_URL: z.string().url().default('https://api.justtcg.com/v1'),
  JUSTTCG_API_KEY: optionalSecretEnv,
  ONEPIECE_API_BASE_URL: z.string().url().default('https://optcgapi.com/api'),
  LORCANA_API_BASE_URL: z.string().url().default('https://api.lorcast.com/v0'),
  APITCG_API_BASE_URL: z.string().url().default('https://api.apitcg.com'),
  APITCG_API_KEY: z.string().min(1).optional(),
  SINGLE_USER_MODE: booleanEnv,
  SINGLE_USER_ID: z.string().default('single-user'),
  SINGLE_USER_EMAIL: z.string().email().default('local@tcger.test'),
  SINGLE_USER_USERNAME: z.string().default('tcger-local')
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('Invalid environment configuration:', parsed.error.flatten().fieldErrors);
  throw new Error('Failed to load environment variables');
}

if (
  parsed.data.NODE_ENV !== 'test' &&
  parsed.data.BACKEND_MODE !== 'convex' &&
  !parsed.data.DATABASE_URL
) {
  console.error('Invalid environment configuration:', {
    DATABASE_URL: ['DATABASE_URL is required when NODE_ENV is not test']
  });
  throw new Error('Failed to load environment variables');
}

if (parsed.data.NODE_ENV !== 'test' && !parsed.data.CONVEX_HTTP_ORIGIN) {
  console.error('Invalid environment configuration:', {
    CONVEX_HTTP_ORIGIN: ['CONVEX_HTTP_ORIGIN is required for Convex-backed auth and bridge routes']
  });
  throw new Error('Failed to load environment variables');
}

if (parsed.data.NODE_ENV === 'production' && !parsed.data.TCGER_BRIDGE_SECRET) {
  console.error('Invalid environment configuration:', {
    TCGER_BRIDGE_SECRET: ['TCGER_BRIDGE_SECRET is required in production']
  });
  throw new Error('Failed to load environment variables');
}

export const env = {
  ...parsed.data,
  TCGER_BRIDGE_SECRET: parsed.data.TCGER_BRIDGE_SECRET ?? DEVELOPMENT_BRIDGE_SECRET
};
