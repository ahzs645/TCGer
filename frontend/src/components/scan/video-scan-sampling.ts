export const DEFAULT_ANALYSIS_INTERVAL_MS = 500;
export const MIN_ANALYSIS_INTERVAL_MS = 100;
export const MAX_ANALYSIS_INTERVAL_MS = 2_000;

export function clampAnalysisInterval(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_ANALYSIS_INTERVAL_MS;
  return Math.min(
    MAX_ANALYSIS_INTERVAL_MS,
    Math.max(MIN_ANALYSIS_INTERVAL_MS, Math.round(value / 50) * 50),
  );
}

export function shouldAnalyzeVideoTime(
  currentSeconds: number,
  previousSeconds: number,
  intervalMs: number,
): boolean {
  if (previousSeconds < 0) return true;
  return (
    Math.abs(currentSeconds - previousSeconds) * 1_000 >=
    clampAnalysisInterval(intervalMs)
  );
}
