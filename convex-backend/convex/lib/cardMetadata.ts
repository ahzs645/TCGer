import { v } from "convex/values";
import type { TcgCode } from "./validators";

export const formatLegalityValidator = v.object({
  standard: v.optional(v.boolean()),
  expanded: v.optional(v.boolean())
});

export const dexEntryValidator = v.object({
  number: v.number(),
  name: v.string()
});

export const pokemonPrintValidator = v.object({
  tcgdexId: v.optional(v.string()),
  tcgdexImage: v.optional(v.string()),
  variants: v.optional(
    v.object({
      normal: v.optional(v.boolean()),
      reverse: v.optional(v.boolean()),
      holo: v.optional(v.boolean()),
      firstEdition: v.optional(v.boolean())
    })
  ),
  finishes: v.optional(v.array(v.string())),
  category: v.optional(v.string()),
  regulationMark: v.optional(v.string()),
  language: v.optional(v.string()),
  formatLegality: v.optional(formatLegalityValidator),
  dexEntries: v.optional(v.array(dexEntryValidator)),
  region: v.optional(v.string())
});

export const provenanceValidator = v.object({
  source: v.string(),
  sourceId: v.optional(v.string()),
  fetchedAt: v.optional(v.string()),
  schemaVersion: v.optional(v.string())
});

export const legalityPeriodValidator = v.object({
  format: v.string(),
  rotation: v.optional(v.string()),
  validFrom: v.optional(v.string()),
  validTo: v.optional(v.string()),
  legal: v.boolean()
});

export const evolutionValidator = v.object({
  evolvesFrom: v.optional(v.string()),
  evolvesTo: v.optional(v.array(v.string()))
});

export const functionalIdentityValidator = v.object({
  key: v.string(),
  normalizedRules: v.optional(v.union(v.string(), v.null()))
});

export const richCardMetadataFields = {
  setSymbolUrl: v.optional(v.string()),
  setLogoUrl: v.optional(v.string()),
  regulationMark: v.optional(v.string()),
  language: v.optional(v.string()),
  supertype: v.optional(v.string()),
  formatLegality: v.optional(formatLegalityValidator),
  dexEntries: v.optional(v.array(dexEntryValidator)),
  region: v.optional(v.string()),
  pokemonPrint: v.optional(pokemonPrintValidator),
  attributes: v.optional(v.record(v.string(), v.any())),
  provenance: v.optional(provenanceValidator),
  legalityPeriods: v.optional(v.array(legalityPeriodValidator)),
  evolution: v.optional(evolutionValidator),
  functionalIdentity: v.optional(functionalIdentityValidator)
};

export type RichCardMetadata = {
  setSymbolUrl?: string;
  setLogoUrl?: string;
  regulationMark?: string;
  language?: string;
  supertype?: string;
  formatLegality?: {
    standard?: boolean;
    expanded?: boolean;
  };
  dexEntries?: Array<{
    number: number;
    name: string;
  }>;
  region?: string;
  pokemonPrint?: {
    tcgdexId?: string;
    tcgdexImage?: string;
    variants?: {
      normal?: boolean;
      reverse?: boolean;
      holo?: boolean;
      firstEdition?: boolean;
    };
    finishes?: string[];
    category?: string;
    regulationMark?: string;
    language?: string;
    formatLegality?: {
      standard?: boolean;
      expanded?: boolean;
    };
    dexEntries?: Array<{
      number: number;
      name: string;
    }>;
    region?: string;
  };
  attributes?: Record<string, unknown>;
  provenance?: {
    source: string;
    sourceId?: string;
    fetchedAt?: string;
    schemaVersion?: string;
  };
  legalityPeriods?: Array<{
    format: string;
    rotation?: string;
    validFrom?: string;
    validTo?: string;
    legal: boolean;
  }>;
  evolution?: {
    evolvesFrom?: string;
    evolvesTo?: string[];
  };
  functionalIdentity?: {
    key: string;
    normalizedRules?: string | null;
  };
};

export type RichCardSnapshot = RichCardMetadata & {
  tcg: TcgCode;
  externalId: string;
  baseExternalId?: string;
  printingKey?: string;
  artworkId?: string;
  name: string;
  setCode?: string;
  setName?: string;
  rarity?: string;
  collectorNumber?: string;
  releasedAt?: string;
  imageUrl?: string;
  imageUrlSmall?: string;
};

export type CollectibleVariant = {
  finishCode?: string;
  finishLabel?: string;
  edition?: string;
  stamp?: string;
  isSealedPromo?: boolean;
  isOversized?: boolean;
  isPeelOff?: boolean;
};

export function normalizeOptionalIdentifier(value?: string): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}

function mergeLegalityPeriods(
  incoming: RichCardMetadata["legalityPeriods"],
  existing: RichCardMetadata["legalityPeriods"]
): RichCardMetadata["legalityPeriods"] {
  if (!incoming) {
    return existing;
  }
  const merged = new Map<string, NonNullable<RichCardMetadata["legalityPeriods"]>[number]>();
  for (const period of [...(existing ?? []), ...incoming]) {
    const key = [period.format, period.rotation ?? "", period.validFrom ?? ""].join("\u0000");
    merged.set(key, period);
  }
  return [...merged.values()];
}

export function pickRichCardMetadata(source: RichCardMetadata): RichCardMetadata {
  return {
    setSymbolUrl: source.setSymbolUrl,
    setLogoUrl: source.setLogoUrl,
    regulationMark: source.regulationMark,
    language: source.language,
    supertype: source.supertype,
    formatLegality: source.formatLegality,
    dexEntries: source.dexEntries,
    region: source.region,
    pokemonPrint: source.pokemonPrint,
    attributes: source.attributes,
    provenance: source.provenance,
    legalityPeriods: source.legalityPeriods,
    evolution: source.evolution,
    functionalIdentity: source.functionalIdentity
  };
}

export function mergeRichCardMetadata(
  incoming: RichCardMetadata,
  existing: RichCardMetadata
): RichCardMetadata {
  const next = pickRichCardMetadata(incoming);
  const previous = pickRichCardMetadata(existing);
  return {
    setSymbolUrl: next.setSymbolUrl ?? previous.setSymbolUrl,
    setLogoUrl: next.setLogoUrl ?? previous.setLogoUrl,
    regulationMark: next.regulationMark ?? previous.regulationMark,
    language: next.language ?? previous.language,
    supertype: next.supertype ?? previous.supertype,
    formatLegality: next.formatLegality ?? previous.formatLegality,
    dexEntries: next.dexEntries ?? previous.dexEntries,
    region: next.region ?? previous.region,
    pokemonPrint: next.pokemonPrint ?? previous.pokemonPrint,
    attributes: next.attributes ?? previous.attributes,
    provenance: next.provenance ?? previous.provenance,
    legalityPeriods: mergeLegalityPeriods(next.legalityPeriods, previous.legalityPeriods),
    evolution: next.evolution ?? previous.evolution,
    functionalIdentity: next.functionalIdentity ?? previous.functionalIdentity
  };
}
