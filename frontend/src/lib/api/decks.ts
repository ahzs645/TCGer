import type {
  DeckResponse,
  DeckAnalysis,
  DeckValidationResult,
  DeckImportResult,
  CreateDeckInput,
  UpdateDeckInput,
  AddDeckCardInput,
  UpdateDeckCardInput,
  ImportDeckInput,
} from "@tcg/api-types";
import { API_BASE_URL } from "./base-url";

export type {
  DeckResponse,
  DeckAnalysis,
  DeckValidationResult,
  DeckImportResult,
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

export async function getDecks(token: string): Promise<DeckResponse[]> {
  return authFetch(`${API_BASE_URL}/decks`, token);
}

export async function getDeck(
  token: string,
  deckId: string,
): Promise<DeckResponse> {
  return authFetch(`${API_BASE_URL}/decks/${deckId}`, token);
}

export async function createDeck(
  token: string,
  input: CreateDeckInput,
): Promise<DeckResponse> {
  return authFetch(`${API_BASE_URL}/decks`, token, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function updateDeck(
  token: string,
  deckId: string,
  input: UpdateDeckInput,
): Promise<DeckResponse> {
  return authFetch(`${API_BASE_URL}/decks/${deckId}`, token, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

export async function deleteDeck(token: string, deckId: string): Promise<void> {
  await authFetch(`${API_BASE_URL}/decks/${deckId}`, token, {
    method: "DELETE",
  });
}

export async function addCardToDeck(
  token: string,
  deckId: string,
  input: AddDeckCardInput,
) {
  return authFetch(`${API_BASE_URL}/decks/${deckId}/cards`, token, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function updateDeckCard(
  token: string,
  deckId: string,
  cardId: string,
  input: UpdateDeckCardInput,
) {
  return authFetch(`${API_BASE_URL}/decks/${deckId}/cards/${cardId}`, token, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

export async function removeDeckCard(
  token: string,
  deckId: string,
  cardId: string,
): Promise<void> {
  await authFetch(`${API_BASE_URL}/decks/${deckId}/cards/${cardId}`, token, {
    method: "DELETE",
  });
}

export async function getDeckAnalysis(
  token: string,
  deckId: string,
): Promise<DeckAnalysis> {
  return authFetch(`${API_BASE_URL}/decks/${deckId}/analysis`, token);
}

export async function validateDeck(
  token: string,
  deckId: string,
  format?: string,
): Promise<DeckValidationResult> {
  return authFetch(`${API_BASE_URL}/decks/${deckId}/validate`, token, {
    method: "POST",
    body: JSON.stringify({ format }),
  });
}

export async function importDeck(
  token: string,
  input: ImportDeckInput,
): Promise<DeckImportResult> {
  return authFetch(`${API_BASE_URL}/decks/import`, token, {
    method: "POST",
    body: JSON.stringify(input),
  });
}
