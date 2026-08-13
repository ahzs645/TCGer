import type {
  CollectionValueHistory,
  CollectionValueBreakdown,
  CollectionDistribution,
  CollectionDuplicates,
} from "@tcg/api-types";
import { API_BASE_URL } from "./base-url";

export type {
  CollectionValueHistory,
  CollectionValueBreakdown,
  CollectionDistribution,
  CollectionDuplicates,
};

export const ANALYTICS_PERIODS = [
  { label: "7D", value: "7d", days: 7 },
  { label: "30D", value: "30d", days: 30 },
  { label: "90D", value: "90d", days: 90 },
  { label: "180D", value: "180d", days: 180 },
  { label: "1Y", value: "1y", days: 365 },
] as const;

export type AnalyticsPeriod = (typeof ANALYTICS_PERIODS)[number]["value"];

async function authFetch(url: string, token: string) {
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || "Request failed");
  }
  return res.json();
}

export async function getCollectionValueHistory(
  token: string,
  period: AnalyticsPeriod | number = "30d",
  tcg?: string,
): Promise<CollectionValueHistory> {
  const params = new URLSearchParams({ period: String(period) });
  if (tcg) params.set("tcg", tcg);
  return authFetch(
    `${API_BASE_URL}/analytics/value?${params.toString()}`,
    token,
  );
}

export async function getCollectionValueBreakdown(
  token: string,
): Promise<CollectionValueBreakdown> {
  return authFetch(`${API_BASE_URL}/analytics/value/breakdown`, token);
}

export async function getCollectionDistribution(
  token: string,
  dimension: string,
  tcg?: string,
): Promise<CollectionDistribution> {
  const params = new URLSearchParams({ by: dimension });
  if (tcg) params.set("tcg", tcg);
  return authFetch(
    `${API_BASE_URL}/analytics/distribution?${params.toString()}`,
    token,
  );
}

export async function getCollectionDuplicates(
  token: string,
  keepCount = 1,
  tcg?: string,
): Promise<CollectionDuplicates> {
  const params = new URLSearchParams({ keep: String(keepCount) });
  if (tcg) params.set("tcg", tcg);
  return authFetch(
    `${API_BASE_URL}/analytics/duplicates?${params.toString()}`,
    token,
  );
}
