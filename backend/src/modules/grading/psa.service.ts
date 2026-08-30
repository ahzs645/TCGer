import { createHash } from 'node:crypto';
import { env } from '../../config/env';
import { fetchWithProviderPolicy } from '../providers/provider-request-queue';

type JsonRecord = Record<string, unknown>;

export interface PsaCertResult {
  certNumber: string;
  grader: 'PSA';
  grade?: number;
  gradeLabel?: string;
  year?: string;
  brand?: string;
  subject?: string;
  searchableName?: string;
  cardNumber?: string;
  variety?: string;
  category?: string;
  population?: number;
  populationHigher?: number;
  providerResponseHash: string;
  retrievedAt: string;
  refreshAfter: string;
  cached: boolean;
}

interface CacheEntry {
  expiresAt: number;
  value: Omit<PsaCertResult, 'cached'>;
}

export class GradingProviderError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

const cache = new Map<string, CacheEntry>();

export function normalizePsaCertNumber(value: unknown): string {
  return String(value ?? '').replace(/\D/g, '');
}

function record(value: unknown): JsonRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as JsonRecord) : null;
}

function field(value: JsonRecord | null, ...names: string[]): unknown {
  if (!value) return undefined;
  for (const name of names) {
    if (value[name] !== undefined && value[name] !== '') return value[name];
  }
  const actualByLowercase = new Map(Object.keys(value).map((key) => [key.toLowerCase(), key]));
  for (const name of names) {
    const actual = actualByLowercase.get(name.toLowerCase());
    if (actual && value[actual] !== undefined && value[actual] !== '') return value[actual];
  }
  return undefined;
}

function optionalString(value: unknown): string | undefined {
  const result = String(value ?? '').trim();
  return result || undefined;
}

function optionalNumber(value: unknown): number | undefined {
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

export function parsePsaGrade(value: unknown): number | undefined {
  const match = /(\d+(?:\.\d)?)\s*$/.exec(String(value ?? '').trim());
  const grade = match ? Number(match[1]) : NaN;
  return grade > 0 && grade <= 10 ? grade : undefined;
}

export function psaSearchableName(value: unknown): string | undefined {
  const result = String(value ?? '')
    .split('-')[0]
    .replace(/\([^)]*\)/g, ' ')
    .replace(
      /\b(HOLO|REVERSE|FOIL|1ST\s*EDITION|SHADOWLESS|SECRET|FULL\s*ART|ALT\s*ART|PROMO|RAINBOW|GOLD)\b/gi,
      ' ',
    )
    .replace(/\s+/g, ' ')
    .trim();
  return result || undefined;
}

function stableHash(payload: unknown): string {
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

export function normalizePsaResponse(
  payload: unknown,
  requestedCert: string,
): Omit<PsaCertResult, 'cached'> {
  const root = record(payload) ?? {};
  const cert = record(field(root, 'PSACert', 'psaCert')) ?? root;
  const gradeLabel = optionalString(field(cert, 'CardGrade', 'GradeDescription', 'cardGrade'));
  const subject = optionalString(field(cert, 'Subject', 'subject'));
  const certNumber = normalizePsaCertNumber(
    field(cert, 'CertNumber', 'certNumber') ?? requestedCert,
  );
  const retrievedAt = new Date().toISOString();
  return {
    certNumber,
    grader: 'PSA',
    grade: parsePsaGrade(gradeLabel),
    gradeLabel,
    year: optionalString(field(cert, 'Year', 'year')),
    brand: optionalString(field(cert, 'Brand', 'brand')),
    subject,
    searchableName: psaSearchableName(subject),
    cardNumber: optionalString(field(cert, 'CardNumber', 'cardNumber')),
    variety: optionalString(field(cert, 'VarietyPedigree', 'Variety', 'varietyPedigree')),
    category: optionalString(field(cert, 'Category', 'category')),
    population: optionalNumber(field(cert, 'TotalPopulation', 'totalPopulation')),
    populationHigher: optionalNumber(field(cert, 'PopulationHigher', 'populationHigher')),
    providerResponseHash: stableHash(payload),
    retrievedAt,
    refreshAfter: new Date(Date.now() + env.PSA_CACHE_TTL_MS).toISOString(),
  };
}

export async function lookupPsaCert(input: unknown): Promise<PsaCertResult> {
  const certNumber = normalizePsaCertNumber(input);
  if (!certNumber) throw new GradingProviderError(400, 'A PSA certification number is required');
  const cached = cache.get(certNumber);
  if (cached && cached.expiresAt > Date.now()) return { ...cached.value, cached: true };
  if (!env.PSA_API_TOKEN) {
    throw new GradingProviderError(503, 'PSA lookup is not configured on this server');
  }

  const response = await fetchWithProviderPolicy(
    'psa',
    `${env.PSA_API_BASE_URL.replace(/\/$/, '')}/cert/GetByCertNumber/${certNumber}`,
    {
      headers: {
        Accept: 'application/json',
        Authorization: `bearer ${env.PSA_API_TOKEN}`,
        'User-Agent': 'TCGer/0.1 (certification intake)',
      },
    },
    { minIntervalMs: env.PSA_MIN_INTERVAL_MS, maxRetries: env.PROVIDER_MAX_RETRIES },
  );
  if (response.status === 401 || response.status === 403) {
    throw new GradingProviderError(502, 'PSA rejected the configured API token');
  }
  if (response.status === 404) {
    throw new GradingProviderError(404, `PSA has no record of certification number ${certNumber}`);
  }
  if (response.status === 429) throw new GradingProviderError(429, 'PSA rate limit reached');
  if (!response.ok)
    throw new GradingProviderError(502, `PSA lookup failed with HTTP ${response.status}`);

  const payload: unknown = await response.json();
  const root = record(payload);
  if (root?.IsValidRequest === false || root?.isValidRequest === false) {
    throw new GradingProviderError(
      404,
      optionalString(root.ServerMessage ?? root.serverMessage) ??
        'PSA returned no certificate details',
    );
  }
  const value = normalizePsaResponse(payload, certNumber);
  if (!value.gradeLabel && !value.subject) {
    throw new GradingProviderError(
      404,
      `PSA returned no details for certification number ${certNumber}`,
    );
  }
  cache.set(certNumber, { value, expiresAt: Date.now() + env.PSA_CACHE_TTL_MS });
  return { ...value, cached: false };
}

export function resetPsaCacheForTests(): void {
  cache.clear();
}
