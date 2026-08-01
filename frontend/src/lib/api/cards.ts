import type { Card, TcgCode, TcgSet } from "@tcg/api-types";

import { API_BASE_URL } from "./base-url";

export interface SetsResponse {
  sets: TcgSet[];
  total: number;
}

export interface SetCardsResponse {
  cards: Card[];
  total: number;
}

export async function searchCards(
  token: string,
  query: string,
  tcg?: TcgCode,
): Promise<Card[]> {
  const params = new URLSearchParams({ query });
  if (tcg) params.set("tcg", tcg);
  const response = await fetch(
    `${API_BASE_URL}/cards/search?${params.toString()}`,
    {
      headers: authHeaders(token),
      credentials: "include",
    },
  );
  const payload = await readJson<SetCardsResponse>(
    response,
    "Failed to search cards",
  );
  return payload.cards;
}

/**
 * Exhaustive name search: every printing matching a name rather than the
 * capped preview page {@link searchCards} returns.
 */
export async function searchAllCards(
  token: string,
  options: {
    query: string;
    tcg?: TcgCode;
    unique?: "prints" | "cards";
    limit?: number;
  },
): Promise<Card[]> {
  const params = new URLSearchParams({ query: options.query });
  if (options.tcg) params.set("tcg", options.tcg);
  if (options.unique) params.set("unique", options.unique);
  if (options.limit) params.set("limit", String(options.limit));
  const response = await fetch(
    `${API_BASE_URL}/cards/search/all?${params.toString()}`,
    {
      headers: authHeaders(token),
      credentials: "include",
    },
  );
  const payload = await readJson<SetCardsResponse>(
    response,
    "Failed to search cards",
  );
  return payload.cards;
}

function authHeaders(token: string): HeadersInit {
  return {
    Authorization: `Bearer ${token}`,
  };
}

async function readJson<T>(response: Response, fallback: string): Promise<T> {
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.message || fallback);
  }
  return response.json() as Promise<T>;
}

export async function getSets(token: string, tcg?: TcgCode): Promise<TcgSet[]> {
  const params = new URLSearchParams();
  if (tcg) params.set("tcg", tcg);
  const suffix = params.size ? `?${params.toString()}` : "";
  const response = await fetch(`${API_BASE_URL}/cards/sets${suffix}`, {
    headers: authHeaders(token),
    credentials: "include",
  });
  const payload = await readJson<SetsResponse>(response, "Failed to load sets");
  return payload.sets;
}

export async function getSetCards(
  token: string,
  tcg: TcgCode,
  setCode: string,
): Promise<Card[]> {
  const response = await fetch(
    `${API_BASE_URL}/cards/sets/${encodeURIComponent(tcg)}/${encodeURIComponent(setCode)}`,
    {
      headers: authHeaders(token),
      credentials: "include",
    },
  );
  const payload = await readJson<SetCardsResponse>(
    response,
    "Failed to load set cards",
  );
  return payload.cards;
}
