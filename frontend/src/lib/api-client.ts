import { API_BASE_URL } from "@/lib/api/base-url";
import type {
  Card,
  CardPrintsResponse,
  SearchCardsResponse,
  TcgCode,
} from "@/types/card";

async function handleResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const errorPayload = await response.json().catch(() => ({}));
    const message = errorPayload?.message ?? response.statusText;
    throw new Error(message || "API request failed");
  }
  return response.json() as Promise<T>;
}

export async function searchCardsApi(params: {
  query: string;
  tcg?: TcgCode | "all";
  token?: string | null;
}): Promise<Card[]> {
  const { query, tcg, token } = params;
  const usp = new URLSearchParams({ query });
  if (tcg && tcg !== "all") {
    usp.set("tcg", tcg);
  }
  const headers: Record<string, string> = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${API_BASE_URL}/cards/search?${usp.toString()}`, {
    headers,
    credentials: "include",
    next: { revalidate: 30 },
  });

  const data = await handleResponse<SearchCardsResponse>(res);
  return data.cards ?? [];
}

export async function fetchCardPrintsApi(params: {
  tcg: TcgCode;
  cardId: string;
  token?: string | null;
}): Promise<CardPrintsResponse> {
  const { tcg, cardId, token } = params;
  const headers: Record<string, string> = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${API_BASE_URL}/cards/${tcg}/${cardId}/prints`, {
    headers,
    credentials: "include",
    next: { revalidate: 30 },
  });
  return handleResponse<CardPrintsResponse>(res);
}

export async function fetchCardByIdApi(params: {
  tcg: TcgCode;
  cardId: string;
  token?: string | null;
}): Promise<Card> {
  const { tcg, cardId, token } = params;
  const headers: Record<string, string> = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${API_BASE_URL}/cards/${tcg}/${cardId}`, {
    headers,
    credentials: "include",
    next: { revalidate: 30 },
  });

  const data = await handleResponse<{ card: Card }>(res);
  return data.card;
}
