import { z } from "zod";

import {
  gameDefinitionSchema,
  standardGameFeatureAdapter,
  type CollectionFacet,
  type GameDefinition,
} from "./game-definitions";

const packageId = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9][a-z0-9-]*$/, "Use lowercase letters, numbers, and hyphens");

const propertyPath = z
  .string()
  .min(1)
  .max(96)
  .regex(
    /^(id|name|setCode|collectorNumber|rarity|artist|type|category|releasedAt|attributes\.[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*)$/,
    "Property is not available to package filters",
  );

export const gamePackageAssetSchema = z
  .object({
    url: z.string().min(1).max(2048),
    bytes: z.number().int().positive().max(536_870_912),
    sha256: z.string().regex(/^[a-f0-9]{64}$/i),
    mediaType: z.string().min(1).max(100).optional(),
  })
  .strict();

const filterOptionSchema = z
  .object({
    value: z.union([z.string(), z.number(), z.boolean()]),
    label: z.string().min(1).max(80),
  })
  .strict();

const baseFilter = z
  .object({
    id: packageId,
    label: z.string().min(1).max(80),
    property: propertyPath,
    help: z.string().max(240).optional(),
  })
  .strict();

export const gamePackageFilterSchema = z.discriminatedUnion("type", [
  baseFilter.extend({
    type: z.literal("select"),
    options: z.array(filterOptionSchema).min(1).max(200),
  }),
  baseFilter.extend({
    type: z.literal("multiSelect"),
    options: z.array(filterOptionSchema).min(1).max(200),
  }),
  baseFilter.extend({
    type: z.literal("numberRange"),
    min: z.number().finite(),
    max: z.number().finite(),
    step: z.number().positive().finite().optional(),
  }),
  baseFilter.extend({
    type: z.literal("boolean"),
    trueLabel: z.string().min(1).max(80).optional(),
    falseLabel: z.string().min(1).max(80).optional(),
  }),
  baseFilter.extend({
    type: z.literal("text"),
    mode: z.enum(["contains", "equals"]).default("contains"),
    maxLength: z.number().int().positive().max(200).default(80),
  }),
]);

const runtimeAssetSchema = z
  .object({
    runtime: z.enum(["tcger-arcface-v1"]),
    manifest: gamePackageAssetSchema,
  })
  .strict();

export const gamePackageManifestSchema = z
  .object({
    schema: z.literal("https://tcger.app/schemas/game-package-manifest/v1"),
    packageId: packageId.optional(),
    packageVersion: z.string().min(1).max(80),
    publishedAt: z.string().datetime(),
    update: z
      .object({
        sequence: z.number().int().nonnegative(),
        manifestUrl: z.string().url().max(2048).optional(),
        releaseNotes: z.string().max(2000).optional(),
      })
      .strict()
      .optional(),
    game: z
      .object({
        id: packageId,
        name: z.string().min(1).max(100),
        shortName: z.string().min(1).max(24).optional(),
        description: z.string().max(500).optional(),
        homepage: z.string().url().optional(),
        accentColor: z
          .string()
          .regex(/^#[0-9a-f]{6}$/i)
          .optional(),
      })
      .strict(),
    publisher: z
      .object({
        id: packageId.optional(),
        name: z.string().min(1).max(100),
        homepage: z.string().url().optional(),
        signingKey: z
          .object({
            id: packageId,
            algorithm: z.literal("ed25519"),
            publicKey: z.string().regex(/^[A-Za-z0-9+/]{43}=$/),
          })
          .strict()
          .optional(),
      })
      .strict(),
    signature: z
      .object({
        algorithm: z.literal("ed25519"),
        keyId: packageId,
        url: z.string().min(1).max(2048),
      })
      .strict()
      .optional(),
    catalog: z
      .object({
        schema: z.literal("tcger-catalog-v1"),
        asset: gamePackageAssetSchema,
        cardCount: z.number().int().nonnegative(),
        setCount: z.number().int().nonnegative().optional(),
      })
      .strict(),
    filters: z.array(gamePackageFilterSchema).max(24).default([]),
    definition: gameDefinitionSchema.optional(),
    scanner: z
      .object({
        web: runtimeAssetSchema.optional(),
        ios: runtimeAssetSchema.optional(),
        android: runtimeAssetSchema.optional(),
      })
      .strict()
      .optional(),
    offlinePacks: z
      .object({
        schema: z.literal("tcger-pack-library-v1"),
        manifest: gamePackageAssetSchema,
      })
      .strict()
      .optional(),
    sealedProducts: z
      .object({
        schema: z.literal("tcger-sealed-catalog-v1"),
        asset: gamePackageAssetSchema,
        productCount: z.number().int().nonnegative(),
      })
      .strict()
      .optional(),
  })
  .strict()
  .superRefine((manifest, context) => {
    if (manifest.definition && manifest.definition.id !== manifest.game.id) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["definition", "id"],
        message: "Definition id must match game id",
      });
    }
    if (manifest.packageId && !manifest.publisher.id) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["publisher", "id"],
        message: "Namespaced packages require a stable publisher id",
      });
    }
    if (
      Boolean(manifest.publisher.signingKey) !== Boolean(manifest.signature)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["signature"],
        message:
          "Publisher signing keys and detached signatures must be declared together",
      });
    }
    if (
      manifest.publisher.signingKey &&
      manifest.signature &&
      manifest.publisher.signingKey.id !== manifest.signature.keyId
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["signature", "keyId"],
        message: "Signature key id must match the publisher signing key",
      });
    }
    const publisherId = manifest.publisher.id;
    for (const [index, feature] of (
      manifest.definition?.interfaces?.features ?? []
    ).entries()) {
      if (
        !standardGameFeatureAdapter(feature.id) &&
        (!publisherId || !feature.id.startsWith(`${publisherId}--`))
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["definition", "interfaces", "features", index, "id"],
          message:
            "Non-standard feature ids must be prefixed with the publisher id and --",
        });
      }
    }
    if (manifest.definition?.interfaces?.scanner && !manifest.scanner) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["definition", "interfaces", "scanner"],
        message: "Scanner interface requires a scanner capability",
      });
    }
    if (
      manifest.definition?.interfaces?.packOpening &&
      !manifest.offlinePacks
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["definition", "interfaces", "packOpening"],
        message: "Pack opening interface requires an offline pack capability",
      });
    }
    if (
      manifest.definition?.interfaces?.sealedProducts &&
      !manifest.sealedProducts
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["definition", "interfaces", "sealedProducts"],
        message:
          "Sealed products interface requires a sealed catalog capability",
      });
    }
    const ids = new Set<string>();
    manifest.filters.forEach((filter, index) => {
      if (ids.has(filter.id))
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["filters", index, "id"],
          message: "Filter ids must be unique",
        });
      ids.add(filter.id);
      if (filter.type === "numberRange" && filter.min > filter.max) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["filters", index, "min"],
          message: "Filter min must not exceed max",
        });
      }
    });
  });

export type GamePackageAsset = z.infer<typeof gamePackageAssetSchema>;
export type GamePackageFilter = z.infer<typeof gamePackageFilterSchema>;
export type GamePackageManifest = z.infer<typeof gamePackageManifestSchema>;

export type GamePackageReleaseRelation =
  | "different-package"
  | "same"
  | "update"
  | "downgrade"
  | "conflict";

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, child]) => child !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => `${JSON.stringify(key)}:${canonicalJson(child)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

/**
 * Compares two manifests occupying the same stable package slot. New packages
 * use a monotonic sequence; legacy packages fall back to their publication
 * timestamp. Equal releases with different content are conflicts, never silent
 * replacements.
 */
export function gamePackageReleaseRelation(
  current: GamePackageManifest,
  candidate: GamePackageManifest,
): GamePackageReleaseRelation {
  if (gamePackageId(current) !== gamePackageId(candidate)) {
    return "different-package";
  }
  if (current.game.id !== candidate.game.id) return "conflict";
  const sameContent = canonicalJson(current) === canonicalJson(candidate);
  const currentSequence = current.update?.sequence;
  const candidateSequence = candidate.update?.sequence;
  if (currentSequence !== undefined || candidateSequence !== undefined) {
    if (currentSequence === undefined || candidateSequence === undefined) {
      return "conflict";
    }
    if (candidateSequence > currentSequence) return "update";
    if (candidateSequence < currentSequence) return "downgrade";
    return sameContent ? "same" : "conflict";
  }
  const currentPublishedAt = Date.parse(current.publishedAt);
  const candidatePublishedAt = Date.parse(candidate.publishedAt);
  if (candidatePublishedAt > currentPublishedAt) return "update";
  if (candidatePublishedAt < currentPublishedAt) return "downgrade";
  return sameContent ? "same" : "conflict";
}

export interface GamePackageCatalogCard {
  id: string;
  baseExternalId?: string;
  printingKey?: string;
  artworkId?: string;
  name: string;
  setCode?: string;
  setName?: string;
  collectorNumber?: string;
  rarity?: string;
  artist?: string;
  type?: string;
  category?: string;
  supertype?: string;
  subtypes?: string[];
  language?: string;
  regulationMark?: string;
  sanctionedPlayLegal?: boolean;
  formatLegality?: {
    standard?: boolean;
    expanded?: boolean;
    unlimited?: boolean;
  };
  dexEntries?: Array<{
    number: number;
    name?: string;
    form?: string;
    region?: string;
  }>;
  releasedAt?: string;
  imageUrl?: string;
  imageUrlSmall?: string;
  attributes?: Record<string, unknown>;
}

export interface GamePackageCatalogSet {
  code: string;
  name: string;
  series?: string;
  releasedAt?: string;
  cardCount?: number;
  iconUrl?: string;
  logoUrl?: string;
}

/**
 * Older optimized catalog packs stored rule fields at the card root. Package
 * catalogs use `attributes`; this adapter lets both layouts share definitions
 * while publishers migrate without rewriting their source data first.
 */
export function gamePackageCardAttributes(
  card: GamePackageCatalogCard,
): Record<string, unknown> {
  const excluded = new Set([
    "id",
    "name",
    "setCode",
    "setName",
    "collectorNumber",
    "rarity",
    "imageUrl",
    "imageUrlSmall",
    "printingKey",
    "attributes",
  ]);
  const rootAttributes = Object.fromEntries(
    Object.entries(card as unknown as Record<string, unknown>).filter(
      ([key, value]) => value !== undefined && !excluded.has(key),
    ),
  );
  return { ...rootAttributes, ...card.attributes };
}

export const OFFICIAL_GAME_PACKAGE_PUBLISHER_ID = "tcger";

export interface GamePackageSource {
  id: string;
  packageId: string;
  gameId: string;
  publisherId: string;
  publisherName: string;
  label: string;
  kind: "built-in" | "installed";
  definition: GameDefinition;
}

/** Stable installation key; legacy packages remain keyed by game id. */
export function gamePackageId(manifest: GamePackageManifest): string {
  return manifest.packageId && manifest.publisher.id
    ? `${manifest.publisher.id}--${manifest.packageId}`
    : manifest.game.id;
}

export function installedGamePackageSource(
  manifest: GamePackageManifest,
): GamePackageSource {
  return {
    id: gamePackageId(manifest),
    packageId: manifest.packageId ?? manifest.game.id,
    gameId: manifest.game.id,
    publisherId: manifest.publisher.id ?? `legacy-${manifest.game.id}`,
    publisherName: manifest.publisher.name,
    label: gamePackageDefinition(manifest).label,
    kind: "installed",
    definition: gamePackageDefinition(manifest),
  };
}

export interface DuplicateGamePackage {
  installedId: string;
  kind: "built-in" | "same-package" | "same-catalog";
}

/**
 * Reinstalling an unchanged package or disguising the same catalog behind a
 * second package id is redundant. A changed manifest in the same package slot
 * is intentionally not a duplicate: that is the update path.
 */
export function duplicateGamePackage(
  installed: readonly GamePackageManifest[],
  candidate: GamePackageManifest,
): DuplicateGamePackage | undefined {
  const candidateId = gamePackageId(candidate);
  if (
    candidate.publisher.id === OFFICIAL_GAME_PACKAGE_PUBLISHER_ID &&
    candidate.packageId === `${candidate.game.id}-catalog`
  ) {
    return { installedId: candidateId, kind: "built-in" };
  }
  for (const current of installed) {
    const currentId = gamePackageId(current);
    const sameCatalog =
      current.game.id === candidate.game.id &&
      current.catalog.asset.sha256.toLowerCase() ===
        candidate.catalog.asset.sha256.toLowerCase();
    if (currentId === candidateId) {
      if (sameCatalog && current.packageVersion === candidate.packageVersion) {
        return { installedId: currentId, kind: "same-package" };
      }
      continue;
    }
    if (sameCatalog) return { installedId: currentId, kind: "same-catalog" };
  }
  return undefined;
}

/**
 * Returns the same definition shape used by built-in games. Legacy v1
 * packages are upgraded in memory so their existing filters keep working.
 */
export function gamePackageDefinition(
  manifest: GamePackageManifest,
): GameDefinition {
  if (manifest.definition) return manifest.definition;
  return {
    id: manifest.game.id,
    label: manifest.game.name,
    shortLabel: manifest.game.shortName,
    presentation: manifest.game.accentColor
      ? { accentColor: manifest.game.accentColor }
      : undefined,
    interfaces: {
      search: true,
      collection: true,
      sets: manifest.catalog.setCount !== undefined,
      wishlists: true,
      decks: false,
      pricing: false,
      sealedProducts: manifest.sealedProducts !== undefined,
      scanner: manifest.scanner !== undefined,
      packOpening: manifest.offlinePacks !== undefined,
      features: [],
    },
    search: { facets: manifest.filters },
    collection: {
      identityModes: [
        {
          id: "collector",
          label: "Collector",
          description:
            "Keep exact sets, rarities, artwork, and variants separate.",
          key: "printingKey",
        },
      ],
      defaultIdentityMode: "collector",
      facets: manifest.filters,
    },
  };
}

export type GameFilterSelection =
  | string
  | number
  | boolean
  | string[]
  | { min?: number; max?: number };

function valueAtPath(card: GamePackageCatalogCard, path: string): unknown {
  return path.split(".").reduce<unknown>((value, key) => {
    if (!value || typeof value !== "object" || Array.isArray(value))
      return undefined;
    return (value as Record<string, unknown>)[key];
  }, card);
}

function equalValue(actual: unknown, expected: unknown): boolean {
  if (Array.isArray(actual))
    return actual.some((item) => equalValue(item, expected));
  return (
    actual === expected ||
    String(actual).toLocaleLowerCase() === String(expected).toLocaleLowerCase()
  );
}

/** Evaluates only the allowlisted controls declared by a validated manifest. */
export function matchesGamePackageFilters(
  card: GamePackageCatalogCard,
  filters: readonly CollectionFacet[],
  selections: Readonly<Record<string, GameFilterSelection | undefined>>,
): boolean {
  return filters.every((filter) => {
    const selected = selections[filter.id];
    if (
      selected === undefined ||
      selected === "" ||
      (Array.isArray(selected) && selected.length === 0)
    )
      return true;
    const actual = valueAtPath(card, filter.property);
    switch (filter.type) {
      case "select":
        return equalValue(actual, selected);
      case "multiSelect":
        return (
          Array.isArray(selected) &&
          selected.some((value) => equalValue(actual, value))
        );
      case "boolean":
        return typeof selected === "boolean" && actual === selected;
      case "text": {
        const needle = String(selected).toLocaleLowerCase();
        const haystack = String(actual ?? "").toLocaleLowerCase();
        return filter.mode === "equals"
          ? haystack === needle
          : haystack.includes(needle);
      }
      case "numberRange": {
        if (
          !selected ||
          typeof selected !== "object" ||
          Array.isArray(selected)
        )
          return true;
        const numeric = typeof actual === "number" ? actual : Number(actual);
        return (
          Number.isFinite(numeric) &&
          (selected.min === undefined || numeric >= selected.min) &&
          (selected.max === undefined || numeric <= selected.max)
        );
      }
    }
  });
}
