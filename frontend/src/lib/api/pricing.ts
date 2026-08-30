import type {
  PriceAlertResponse,
  TransactionResponse,
  FinanceSummary,
  FinanceSummaryByCurrency,
  RealizedPerformance,
  ShopConnectionResponse,
  CreatePriceAlertInput,
  UpdatePriceAlertInput,
  CreateTransactionInput,
  UpdateTransactionInput,
  CreateShopConnectionInput,
  PriceResult,
  PriceAnalyticsMovers,
  TrackedPriceItem,
  TrackedPricesResponse,
  PriceSource,
  PriceSourcesResponse,
} from "@tcg/api-types";
import { API_BASE_URL } from "./base-url";

export type {
  PriceAlertResponse,
  TransactionResponse,
  FinanceSummary,
  FinanceSummaryByCurrency,
  RealizedPerformance,
  ShopConnectionResponse,
  PriceResult,
  PriceAnalyticsMovers,
  TrackedPriceItem,
  TrackedPricesResponse,
  PriceSource,
  PriceSourcesResponse,
};

async function authFetch(
  url: string,
  token: string,
  options: RequestInit = {},
) {
  const res = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...options.headers,
    },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || "Request failed");
  }
  return res.status === 204 ? null : res.json();
}

// Price Alerts
export async function getAlerts(token: string): Promise<PriceAlertResponse[]> {
  return authFetch(`${API_BASE_URL}/alerts`, token);
}
export async function createAlert(
  token: string,
  input: CreatePriceAlertInput,
): Promise<PriceAlertResponse> {
  return authFetch(`${API_BASE_URL}/alerts`, token, {
    method: "POST",
    body: JSON.stringify(input),
  });
}
export async function updateAlert(
  token: string,
  alertId: string,
  input: UpdatePriceAlertInput,
) {
  return authFetch(`${API_BASE_URL}/alerts/${alertId}`, token, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}
export async function deleteAlert(
  token: string,
  alertId: string,
): Promise<void> {
  await authFetch(`${API_BASE_URL}/alerts/${alertId}`, token, {
    method: "DELETE",
  });
}

// Transactions / Finance
export async function getTransactions(
  token: string,
  collectionEntryId?: string,
): Promise<TransactionResponse[]> {
  const params = new URLSearchParams();
  if (collectionEntryId) params.set("collectionEntryId", collectionEntryId);
  const query = params.size ? `?${params.toString()}` : "";
  return authFetch(`${API_BASE_URL}/finance/transactions${query}`, token);
}
export async function createTransaction(
  token: string,
  input: CreateTransactionInput,
): Promise<TransactionResponse> {
  return authFetch(`${API_BASE_URL}/finance/transactions`, token, {
    method: "POST",
    body: JSON.stringify(input),
  });
}
export async function updateTransaction(
  token: string,
  id: string,
  input: UpdateTransactionInput,
): Promise<TransactionResponse> {
  return authFetch(`${API_BASE_URL}/finance/transactions/${id}`, token, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}
export async function deleteTransaction(
  token: string,
  id: string,
): Promise<void> {
  await authFetch(`${API_BASE_URL}/finance/transactions/${id}`, token, {
    method: "DELETE",
  });
}
export async function getFinanceSummary(
  token: string,
): Promise<FinanceSummary> {
  return authFetch(`${API_BASE_URL}/finance/summary`, token);
}
export async function getFinanceSummaryByCurrency(
  token: string,
): Promise<FinanceSummaryByCurrency> {
  return authFetch(`${API_BASE_URL}/finance/summary/by-currency`, token);
}
export async function getRealizedPerformance(
  token: string,
  periodDays?: number,
): Promise<RealizedPerformance> {
  const query = periodDays ? `?periodDays=${periodDays}` : "";
  return authFetch(
    `${API_BASE_URL}/finance/realized-performance${query}`,
    token,
  );
}

// Shop Connections
export async function getShopConnections(
  token: string,
): Promise<ShopConnectionResponse[]> {
  return authFetch(`${API_BASE_URL}/shops/connections`, token);
}
export async function createShopConnection(
  token: string,
  input: CreateShopConnectionInput,
) {
  return authFetch(`${API_BASE_URL}/shops/connections`, token, {
    method: "POST",
    body: JSON.stringify(input),
  });
}
export async function deleteShopConnection(
  token: string,
  id: string,
): Promise<void> {
  await authFetch(`${API_BASE_URL}/shops/connections/${id}`, token, {
    method: "DELETE",
  });
}
export async function syncShopStock(token: string, connectionId: string) {
  return authFetch(`${API_BASE_URL}/shops/sync/${connectionId}`, token, {
    method: "POST",
  });
}

// Prices
export async function getCardPrices(
  token: string,
  tcg: string,
  cardId: string,
  finishCode?: string,
  source: PriceSource = "automatic",
  compare = false,
): Promise<PriceResult[]> {
  const params = new URLSearchParams();
  if (finishCode) params.set("finish", finishCode);
  params.set("source", source);
  if (compare) params.set("compare", "true");
  const query = params.size ? `?${params.toString()}` : "";
  return authFetch(
    `${API_BASE_URL}/prices/${encodeURIComponent(tcg)}/${encodeURIComponent(cardId)}${query}`,
    token,
  );
}
export async function getTrackedCardPrices(
  token: string,
  items: TrackedPriceItem[],
  force = false,
  source: PriceSource = "automatic",
): Promise<TrackedPricesResponse> {
  const responses: TrackedPricesResponse[] = [];
  for (let index = 0; index < items.length; index += 100) {
    responses.push(
      await authFetch(`${API_BASE_URL}/prices/tracked`, token, {
        method: "POST",
        body: JSON.stringify({
          items: items.slice(index, index + 100),
          force,
          source,
        }),
      }),
    );
  }
  if (responses.length === 0) {
    const now = new Date().toISOString();
    return {
      prices: [],
      refreshedAt: now,
      refreshAfter: now,
      health: {
        status: "healthy",
        total: 0,
        priced: 0,
        fresh: 0,
        stale: 0,
        missing: 0,
        failed: 0,
        lowConfidence: 0,
        coverage: 100,
        freshnessHours: 48,
        message: "No cards were requested.",
      },
    };
  }
  const prices = responses.flatMap((response) => response.prices);
  const total = responses.reduce((sum, response) => sum + response.health.total, 0);
  const sum = (field: "priced" | "fresh" | "stale" | "missing" | "failed" | "lowConfidence") =>
    responses.reduce((value, response) => value + response.health[field], 0);
  const fresh = sum("fresh");
  const lowConfidence = sum("lowConfidence");
  const coverage = total ? Math.round((fresh / total) * 10_000) / 100 : 100;
  const healthStatus = coverage >= 90 && lowConfidence === 0
    ? "healthy"
    : coverage >= 70
      ? "degraded"
      : "unsafe";
  return {
    prices,
    refreshedAt: responses[responses.length - 1].refreshedAt,
    refreshAfter: responses.reduce(
      (earliest, response) =>
        response.refreshAfter < earliest ? response.refreshAfter : earliest,
      responses[0].refreshAfter,
    ),
    health: {
      status: healthStatus,
      total,
      priced: sum("priced"),
      fresh,
      stale: sum("stale"),
      missing: sum("missing"),
      failed: sum("failed"),
      lowConfidence,
      coverage,
      freshnessHours: Math.max(...responses.map((response) => response.health.freshnessHours)),
      message:
        healthStatus === "healthy"
          ? `${fresh} of ${total} cards have fresh, trusted quotes.`
          : `${fresh} of ${total} cards have fresh quotes; ${sum("missing")} are missing and ${lowConfidence} are low-confidence.`,
    },
  };
}

export async function getPriceSources(
  token: string,
): Promise<PriceSourcesResponse> {
  return authFetch(`${API_BASE_URL}/prices/sources`, token);
}
export async function getPriceMovers(
  token: string,
  tcg?: string,
  period = 7,
): Promise<PriceAnalyticsMovers> {
  const params = new URLSearchParams();
  if (tcg) params.set("tcg", tcg);
  params.set("period", String(period));
  return authFetch(`${API_BASE_URL}/prices/analytics/movers?${params}`, token);
}
