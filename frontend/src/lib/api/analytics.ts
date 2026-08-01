import type {
  CollectionValueHistory,
  CollectionValueBreakdown,
  CollectionDistribution,
} from "@tcg/api-types";
import { API_BASE_URL } from "./base-url";

export type {
  CollectionValueHistory,
  CollectionValueBreakdown,
  CollectionDistribution,
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
): Promise<CollectionValueHistory> {
  return authFetch(
    `${API_BASE_URL}/analytics/value?period=${encodeURIComponent(period)}`,
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
): Promise<CollectionDistribution> {
  return authFetch(
    `${API_BASE_URL}/analytics/distribution?by=${dimension}`,
    token,
  );
}
