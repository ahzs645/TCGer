import type {
  PriceAlertResponse,
  TransactionResponse,
  FinanceSummary,
  ShopConnectionResponse,
  CreatePriceAlertInput,
  UpdatePriceAlertInput,
  CreateTransactionInput,
  CreateShopConnectionInput,
  PriceResult,
  PriceAnalyticsMovers,
} from "@tcg/api-types";
import { API_BASE_URL } from "./base-url";

export type {
  PriceAlertResponse,
  TransactionResponse,
  FinanceSummary,
  ShopConnectionResponse,
  PriceResult,
  PriceAnalyticsMovers,
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
): Promise<TransactionResponse[]> {
  return authFetch(`${API_BASE_URL}/finance/transactions`, token);
}
export async function createTransaction(
  token: string,
  input: CreateTransactionInput,
) {
  return authFetch(`${API_BASE_URL}/finance/transactions`, token, {
    method: "POST",
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
): Promise<PriceResult[]> {
  return authFetch(`${API_BASE_URL}/prices/${tcg}/${cardId}`, token);
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
