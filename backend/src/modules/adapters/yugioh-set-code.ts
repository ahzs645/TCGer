export interface ParsedYugiohSetCode {
  prefix: string;
  region?: string;
  suffix: string;
}

/**
 * Yu-Gi-Oh! used both legacy one-letter region markers and the current
 * two-letter language markers. The values here are canonical language codes,
 * not countries (for example, AE is the Asian-English printing region).
 */
export const YUGIOH_REGION_TO_LANGUAGE = {
  E: 'EN',
  G: 'DE',
  F: 'FR',
  I: 'IT',
  S: 'ES',
  P: 'PT',
  J: 'JP',
  K: 'KR',
  AE: 'EN',
  TC: 'ZH',
  SC: 'ZH',
  EN: 'EN',
  DE: 'DE',
  FR: 'FR',
  IT: 'IT',
  ES: 'ES',
  PT: 'PT',
  JP: 'JP',
  KR: 'KR',
  ZH: 'ZH'
} as const;

export type YugiohLanguageCode = (typeof YUGIOH_REGION_TO_LANGUAGE)[keyof typeof YUGIOH_REGION_TO_LANGUAGE];

const LANGUAGE_TO_LEGACY_REGION: Partial<Record<YugiohLanguageCode, string>> = {
  EN: 'E',
  DE: 'G',
  FR: 'F',
  IT: 'I',
  ES: 'S',
  PT: 'P',
  JP: 'J',
  KR: 'K'
};

const LANGUAGE_ALIASES: Record<string, YugiohLanguageCode> = {
  GB: 'EN',
  CN: 'ZH',
  ...Object.fromEntries(
    Object.values(YUGIOH_REGION_TO_LANGUAGE).map((language) => [language, language])
  )
} as Record<string, YugiohLanguageCode>;

const REGION_CODES = Object.keys(YUGIOH_REGION_TO_LANGUAGE).sort((left, right) => right.length - left.length);

/** Canonicalizes case and insignificant surrounding whitespace without dropping language information. */
export function canonicalizeYugiohSetCode(setCode: string): string {
  return setCode.trim().toUpperCase();
}

export function parseYugiohSetCode(setCode: string): ParsedYugiohSetCode | null {
  const canonical = canonicalizeYugiohSetCode(setCode);
  const separator = canonical.indexOf('-');
  if (separator <= 0 || separator === canonical.length - 1) {
    return null;
  }

  const prefix = canonical.slice(0, separator);
  const remainder = canonical.slice(separator + 1);
  const region = REGION_CODES.find((candidate) => {
    return remainder.startsWith(candidate) && remainder.length > candidate.length;
  });

  if (!region) {
    return { prefix, suffix: remainder };
  }

  return {
    prefix,
    region,
    suffix: remainder.slice(region.length)
  };
}

/**
 * Returns the language-neutral collector code used to compare localized
 * printings, e.g. LOB-EN005 and LOB-G005 both normalize to LOB-005.
 */
export function normalizeYugiohSetCode(setCode: string): string {
  const parsed = parseYugiohSetCode(setCode);
  if (!parsed) {
    return canonicalizeYugiohSetCode(setCode);
  }
  return `${parsed.prefix}-${parsed.suffix}`;
}

export function transformYugiohSetCode(setCode: string, language: string): string {
  const canonical = canonicalizeYugiohSetCode(setCode);
  const parsed = parseYugiohSetCode(canonical);
  const targetLanguage = normalizeLanguage(language);
  if (!parsed?.region || !targetLanguage) {
    return canonical;
  }

  const replacement =
    parsed.region.length === 1
      ? LANGUAGE_TO_LEGACY_REGION[targetLanguage] ?? targetLanguage
      : targetLanguage;
  return `${parsed.prefix}-${replacement}${parsed.suffix}`;
}

/** Defaults language-neutral North American codes to English, matching the upstream catalog. */
export function extractYugiohLanguageCode(setCode: string): YugiohLanguageCode {
  const parsed = parseYugiohSetCode(setCode);
  return parsed?.region
    ? YUGIOH_REGION_TO_LANGUAGE[parsed.region as keyof typeof YUGIOH_REGION_TO_LANGUAGE]
    : 'EN';
}

export function isYugiohSetCodeCompatible(setCode: string, language: string): boolean {
  const parsed = parseYugiohSetCode(setCode);
  const targetLanguage = normalizeLanguage(language);
  if (!parsed?.region) {
    return true;
  }
  if (!targetLanguage) {
    return false;
  }
  return extractYugiohLanguageCode(setCode) === targetLanguage;
}

export function buildLegacyYugiohSetCode(
  prefix: string,
  collectorNumber: string,
  language: string
): string | null {
  const targetLanguage = normalizeLanguage(language);
  const region = targetLanguage ? LANGUAGE_TO_LEGACY_REGION[targetLanguage] : undefined;
  if (!region) {
    return null;
  }
  return `${prefix.trim().toUpperCase()}-${region}${collectorNumber.trim().toUpperCase()}`;
}

export function extractYugiohCollectorNumber(setCode: string): string | undefined {
  return parseYugiohSetCode(setCode)?.suffix;
}

export function extractYugiohSetPrefix(setCode: string): string | undefined {
  return parseYugiohSetCode(setCode)?.prefix;
}

function normalizeLanguage(language: string): YugiohLanguageCode | undefined {
  const canonical = language.trim().toUpperCase();
  return (
    LANGUAGE_ALIASES[canonical] ??
    YUGIOH_REGION_TO_LANGUAGE[canonical as keyof typeof YUGIOH_REGION_TO_LANGUAGE]
  );
}
