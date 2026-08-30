import type {
  CatalogCorrection,
  CreateCatalogCorrectionInput,
  TcgCode,
} from "@tcg/api-types";

import { API_BASE_URL } from "./base-url";

async function responseJson<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const error = (await response.json().catch(() => null)) as
      | { message?: string }
      | null;
    throw new Error(error?.message ?? "Catalog correction request failed");
  }
  return response.json() as Promise<T>;
}

function headers(token: string): HeadersInit {
  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
}

export async function getCatalogCorrections(
  token: string,
  tcg?: TcgCode,
): Promise<CatalogCorrection[]> {
  const query = tcg ? `?tcg=${encodeURIComponent(tcg)}` : "";
  return responseJson(
    await fetch(`${API_BASE_URL}/catalog-corrections${query}`, {
      headers: headers(token),
      credentials: "include",
    }),
  );
}

export async function getCatalogCorrectionHistory(
  token: string,
  limit = 50,
): Promise<CatalogCorrection[]> {
  return responseJson(
    await fetch(
      `${API_BASE_URL}/catalog-corrections/history?limit=${Math.min(200, Math.max(1, limit))}`,
      { headers: headers(token), credentials: "include" },
    ),
  );
}

export async function createCatalogCorrection(
  token: string,
  input: CreateCatalogCorrectionInput,
): Promise<CatalogCorrection> {
  return responseJson(
    await fetch(`${API_BASE_URL}/catalog-corrections`, {
      method: "POST",
      headers: headers(token),
      credentials: "include",
      body: JSON.stringify(input),
    }),
  );
}

export async function rollbackCatalogCorrection(
  token: string,
  correctionId: string,
): Promise<CatalogCorrection> {
  return responseJson(
    await fetch(
      `${API_BASE_URL}/catalog-corrections/${encodeURIComponent(correctionId)}/rollback`,
      {
        method: "POST",
        headers: headers(token),
        credentials: "include",
        body: JSON.stringify({}),
      },
    ),
  );
}
