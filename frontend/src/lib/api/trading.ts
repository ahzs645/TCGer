import type {
  TradeResponse,
  TradeMatchResponse,
  CreateTradeInput,
} from "@tcg/api-types";
import { API_BASE_URL } from "./base-url";

export type { TradeResponse, TradeMatchResponse };

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

export async function getTrades(token: string): Promise<TradeResponse[]> {
  return authFetch(`${API_BASE_URL}/trades`, token);
}
export async function getTrade(
  token: string,
  tradeId: string,
): Promise<TradeResponse> {
  return authFetch(`${API_BASE_URL}/trades/${tradeId}`, token);
}
export async function createTrade(
  token: string,
  input: CreateTradeInput,
): Promise<TradeResponse> {
  return authFetch(`${API_BASE_URL}/trades`, token, {
    method: "POST",
    body: JSON.stringify(input),
  });
}
export async function acceptTrade(
  token: string,
  tradeId: string,
): Promise<TradeResponse> {
  return authFetch(`${API_BASE_URL}/trades/${tradeId}/accept`, token, {
    method: "PATCH",
  });
}
export async function declineTrade(
  token: string,
  tradeId: string,
): Promise<TradeResponse> {
  return authFetch(`${API_BASE_URL}/trades/${tradeId}/decline`, token, {
    method: "PATCH",
  });
}
export async function deleteTrade(
  token: string,
  tradeId: string,
): Promise<void> {
  await authFetch(`${API_BASE_URL}/trades/${tradeId}`, token, {
    method: "DELETE",
  });
}
export async function getTradeMatches(
  token: string,
): Promise<TradeMatchResponse[]> {
  return authFetch(`${API_BASE_URL}/trades/matches`, token);
}
