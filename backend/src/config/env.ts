import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(3000),
  DATABASE_URL: z.string().url().optional(),
  REDIS_URL: z.string().optional(),
  JWT_SECRET: z.string().min(16, 'JWT_SECRET must be at least 16 characters long').optional(),
  POKEMON_TCG_API_KEY: z.string().optional(),
  SCRYFALL_API_BASE_URL: z.string().url().default('https://api.scryfall.com'),
  YGO_API_BASE_URL: z.string().url().default('https://db.ygoprodeck.com/api/v7'),
  POKEMON_API_BASE_URL: z.string().url().default('https://api.pokemontcg.io/v2'),
  TCGDEX_API_BASE_URL: z.string().url().default('https://api.tcgdex.net/v2/en')
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('Invalid environment configuration:', parsed.error.flatten().fieldErrors);
  throw new Error('Failed to load environment variables');
}

export const env = parsed.data;
