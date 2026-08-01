import type {
  CreateSealedInventoryInput,
  CreateSealedOpeningInput,
  PackOpeningResult,
  RecordOpenedCardSaleInput,
  SealedInventoryResponse,
  SealedLedgerCard,
  SealedOpeningLedger,
  SealedProductResponse,
  UpdateSealedInventoryInput,
} from "@tcg/api-types";

import { API_BASE_URL } from "./base-url";

export type {
  CreateSealedInventoryInput,
  CreateSealedOpeningInput,
  PackOpeningResult,
  RecordOpenedCardSaleInput,
  SealedInventoryResponse,
  SealedLedgerCard,
  SealedOpeningLedger,
  SealedProductResponse,
  UpdateSealedInventoryInput,
};

export interface SealedOpeningResponse {
  id: string;
  userId: string;
  sealedInventoryId: string;
  openedQuantity: number;
  openedAt: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export interface SealedOpenedCardResponse {
  id: string;
  openingId: string;
  collectionId?: string;
  externalId: string;
  tcg: string;
  cardName: string;
  quantity: number;
  status: string;
  realizedProceeds?: number;
  soldAt?: string;
  createdAt: string;
  updatedAt: string;
}

async function authFetch<T>(
  url: string,
  token: string,
  options: RequestInit = {},
): Promise<T> {
  const response = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...options.headers,
    },
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.message || "Request failed");
  }

  return response.json() as Promise<T>;
}

export async function getSealedProducts(
  token: string,
  tcg?: string,
): Promise<SealedProductResponse[]> {
  const query = tcg ? `?tcg=${encodeURIComponent(tcg)}` : "";
  return authFetch(`${API_BASE_URL}/sealed/products${query}`, token);
}

export async function simulatePackOpening(
  token: string,
  tcg: string,
  setCode: string,
): Promise<PackOpeningResult> {
  return authFetch(`${API_BASE_URL}/sealed/open-pack`, token, {
    method: "POST",
    body: JSON.stringify({ tcg, setCode }),
  });
}

export async function getSealedInventory(
  token: string,
): Promise<SealedInventoryResponse[]> {
  return authFetch(`${API_BASE_URL}/sealed/inventory`, token);
}

export async function addSealedInventory(
  token: string,
  input: CreateSealedInventoryInput,
): Promise<SealedInventoryResponse> {
  return authFetch(`${API_BASE_URL}/sealed/inventory`, token, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function updateSealedInventory(
  token: string,
  itemId: string,
  input: UpdateSealedInventoryInput,
): Promise<SealedInventoryResponse> {
  return authFetch(`${API_BASE_URL}/sealed/inventory/${itemId}`, token, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

export async function deleteSealedInventory(
  token: string,
  itemId: string,
): Promise<void> {
  const response = await fetch(`${API_BASE_URL}/sealed/inventory/${itemId}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.message || "Request failed");
  }
}

export async function getSealedOpenings(
  token: string,
): Promise<SealedOpeningLedger[]> {
  return authFetch(`${API_BASE_URL}/sealed/openings`, token);
}

export async function createSealedOpening(
  token: string,
  itemId: string,
  input: CreateSealedOpeningInput,
): Promise<SealedOpeningResponse> {
  return authFetch(`${API_BASE_URL}/sealed/inventory/${itemId}/open`, token, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function recordOpenedCardSale(
  token: string,
  cardId: string,
  input: RecordOpenedCardSaleInput,
): Promise<SealedOpenedCardResponse> {
  return authFetch(`${API_BASE_URL}/sealed/openings/cards/${cardId}/sale`, token, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}
