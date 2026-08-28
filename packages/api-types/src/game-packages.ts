import { z } from 'zod';

const packageId = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9][a-z0-9-]*$/, 'Use lowercase letters, numbers, and hyphens');

const propertyPath = z
  .string()
  .min(1)
  .max(96)
  .regex(
    /^(id|name|setCode|collectorNumber|rarity|artist|type|category|releasedAt|attributes\.[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*)$/,
    'Property is not available to package filters',
  );

export const gamePackageAssetSchema = z.object({
  url: z.string().min(1).max(2048),
  bytes: z.number().int().positive().max(536_870_912),
  sha256: z.string().regex(/^[a-f0-9]{64}$/i),
  mediaType: z.string().min(1).max(100).optional(),
}).strict();

const filterOptionSchema = z.object({
  value: z.union([z.string(), z.number(), z.boolean()]),
  label: z.string().min(1).max(80),
}).strict();

const baseFilter = z.object({
  id: packageId,
  label: z.string().min(1).max(80),
  property: propertyPath,
  help: z.string().max(240).optional(),
}).strict();

export const gamePackageFilterSchema = z.discriminatedUnion('type', [
  baseFilter.extend({
    type: z.literal('select'),
    options: z.array(filterOptionSchema).min(1).max(200),
  }),
  baseFilter.extend({
    type: z.literal('multiSelect'),
    options: z.array(filterOptionSchema).min(1).max(200),
  }),
  baseFilter.extend({
    type: z.literal('numberRange'),
    min: z.number().finite(),
    max: z.number().finite(),
    step: z.number().positive().finite().optional(),
  }),
  baseFilter.extend({
    type: z.literal('boolean'),
    trueLabel: z.string().min(1).max(80).optional(),
    falseLabel: z.string().min(1).max(80).optional(),
  }),
  baseFilter.extend({
    type: z.literal('text'),
    mode: z.enum(['contains', 'equals']).default('contains'),
    maxLength: z.number().int().positive().max(200).default(80),
  }),
]);

const runtimeAssetSchema = z.object({
  runtime: z.enum(['tcger-arcface-v1']),
  manifest: gamePackageAssetSchema,
}).strict();

export const gamePackageManifestSchema = z.object({
  schema: z.literal('https://tcger.app/schemas/game-package-manifest/v1'),
  packageVersion: z.string().min(1).max(80),
  publishedAt: z.string().datetime(),
  game: z.object({
    id: packageId,
    name: z.string().min(1).max(100),
    shortName: z.string().min(1).max(24).optional(),
    description: z.string().max(500).optional(),
    homepage: z.string().url().optional(),
    accentColor: z.string().regex(/^#[0-9a-f]{6}$/i).optional(),
  }).strict(),
  publisher: z.object({
    name: z.string().min(1).max(100),
    homepage: z.string().url().optional(),
  }).strict(),
  catalog: z.object({
    schema: z.literal('tcger-catalog-v1'),
    asset: gamePackageAssetSchema,
    cardCount: z.number().int().nonnegative(),
    setCount: z.number().int().nonnegative().optional(),
  }).strict(),
  filters: z.array(gamePackageFilterSchema).max(24).default([]),
  scanner: z
    .object({
      web: runtimeAssetSchema.optional(),
      ios: runtimeAssetSchema.optional(),
      android: runtimeAssetSchema.optional(),
    }).strict()
    .optional(),
  offlinePacks: z
    .object({
      schema: z.literal('tcger-pack-library-v1'),
      manifest: gamePackageAssetSchema,
    }).strict()
    .optional(),
}).strict().superRefine((manifest, context) => {
  const ids = new Set<string>();
  manifest.filters.forEach((filter, index) => {
    if (ids.has(filter.id)) context.addIssue({ code: z.ZodIssueCode.custom, path: ['filters', index, 'id'], message: 'Filter ids must be unique' });
    ids.add(filter.id);
    if (filter.type === 'numberRange' && filter.min > filter.max) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ['filters', index, 'min'], message: 'Filter min must not exceed max' });
    }
  });
});

export type GamePackageAsset = z.infer<typeof gamePackageAssetSchema>;
export type GamePackageFilter = z.infer<typeof gamePackageFilterSchema>;
export type GamePackageManifest = z.infer<typeof gamePackageManifestSchema>;

export interface GamePackageCatalogCard {
  id: string;
  name: string;
  setCode?: string;
  collectorNumber?: string;
  rarity?: string;
  artist?: string;
  type?: string;
  category?: string;
  releasedAt?: string;
  imageUrl?: string;
  imageUrlSmall?: string;
  attributes?: Record<string, unknown>;
}

export type GameFilterSelection =
  | string
  | number
  | boolean
  | string[]
  | { min?: number; max?: number };

function valueAtPath(card: GamePackageCatalogCard, path: string): unknown {
  return path.split('.').reduce<unknown>((value, key) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
    return (value as Record<string, unknown>)[key];
  }, card);
}

function equalValue(actual: unknown, expected: unknown): boolean {
  if (Array.isArray(actual)) return actual.some((item) => equalValue(item, expected));
  return actual === expected || String(actual).toLocaleLowerCase() === String(expected).toLocaleLowerCase();
}

/** Evaluates only the allowlisted controls declared by a validated manifest. */
export function matchesGamePackageFilters(
  card: GamePackageCatalogCard,
  filters: readonly GamePackageFilter[],
  selections: Readonly<Record<string, GameFilterSelection | undefined>>,
): boolean {
  return filters.every((filter) => {
    const selected = selections[filter.id];
    if (selected === undefined || selected === '' || (Array.isArray(selected) && selected.length === 0)) return true;
    const actual = valueAtPath(card, filter.property);
    switch (filter.type) {
      case 'select':
        return equalValue(actual, selected);
      case 'multiSelect':
        return Array.isArray(selected) && selected.some((value) => equalValue(actual, value));
      case 'boolean':
        return typeof selected === 'boolean' && actual === selected;
      case 'text': {
        const needle = String(selected).toLocaleLowerCase();
        const haystack = String(actual ?? '').toLocaleLowerCase();
        return filter.mode === 'equals' ? haystack === needle : haystack.includes(needle);
      }
      case 'numberRange': {
        if (!selected || typeof selected !== 'object' || Array.isArray(selected)) return true;
        const numeric = typeof actual === 'number' ? actual : Number(actual);
        return Number.isFinite(numeric)
          && (selected.min === undefined || numeric >= selected.min)
          && (selected.max === undefined || numeric <= selected.max);
      }
    }
  });
}
