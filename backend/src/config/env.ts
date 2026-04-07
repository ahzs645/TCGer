import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const booleanEnv = z
  .enum(['true', 'false'])
  .optional()
  .default('false')
  .transform((value) => value === 'true');

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(3000),
  BACKEND_MODE: z.enum(['hybrid', 'convex']).default('hybrid'),
  DATABASE_URL: z.string().url().optional(),
  CARD_SCAN_STORE: z.enum(['auto', 'file', 'prisma']).default('auto'),
  CARD_SCAN_DATA_DIR: z.string().default('/tmp/tcger-card-scan'),
  APP_ORIGIN: z.string().url().optional(),
  COLLECTIONS_BACKEND: z.enum(['prisma', 'convex']).default('prisma'),
  WISHLISTS_BACKEND: z.enum(['prisma', 'convex']).default('prisma'),
  CONVEX_HTTP_ORIGIN: z.string().url().optional(),
  SCRYDEX_API_KEY: z.string().optional(),
  SCRYDEX_TEAM_ID: z.string().optional(),
  SCRYFALL_API_BASE_URL: z.string().url().default('https://api.scryfall.com'),
  YGO_API_BASE_URL: z.string().url().default('https://db.ygoprodeck.com/api/v7'),
  POKEMON_API_BASE_URL: z.string().url().default('https://api.scrydex.com'),
  TCGDEX_API_BASE_URL: z.string().url().default('https://api.tcgdex.net/v2/en'),
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

export const env = parsed.data;
