const DEFAULT_ANALYTICS_PERIOD_DAYS = 30;
const MIN_ANALYTICS_PERIOD_DAYS = 1;
const MAX_ANALYTICS_PERIOD_DAYS = 365;

const ANALYTICS_PERIOD_DAYS: Record<string, number> = {
  '7d': 7,
  '30d': 30,
  '90d': 90,
  '180d': 180,
  '1y': 365
};

export function parseAnalyticsPeriod(period: unknown): number {
  if (typeof period !== 'string') return DEFAULT_ANALYTICS_PERIOD_DAYS;

  const normalizedPeriod = period.trim().toLowerCase();
  const days = ANALYTICS_PERIOD_DAYS[normalizedPeriod]
    ?? (/^-?\d+$/.test(normalizedPeriod)
      ? Number.parseInt(normalizedPeriod, 10)
      : DEFAULT_ANALYTICS_PERIOD_DAYS);

  return Math.min(
    MAX_ANALYTICS_PERIOD_DAYS,
    Math.max(MIN_ANALYTICS_PERIOD_DAYS, days)
  );
}
