import type {
  CreateOnlineCodeBatch,
  CreateOnlineCodeBatchResult,
  OnlineCode,
  OnlineCodeStatus,
  TcgCode,
  UpdateOnlineCodeInput,
} from "@tcg/api-types";

import { API_BASE_URL } from "./base-url";

export type {
  CreateOnlineCodeBatch,
  CreateOnlineCodeBatchResult,
  OnlineCode,
  OnlineCodeStatus,
  TcgCode,
  UpdateOnlineCodeInput,
};

async function onlineCodeFetch<T>(
  path: string,
  token: string,
  options: RequestInit = {},
): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...options.headers,
    },
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.message || "Online code request failed");
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export function getOnlineCodes(token: string, tcg?: TcgCode) {
  const query = tcg ? `?tcg=${encodeURIComponent(tcg)}` : "";
  return onlineCodeFetch<OnlineCode[]>(`/online-codes${query}`, token);
}

export function createOnlineCodes(token: string, input: CreateOnlineCodeBatch) {
  return onlineCodeFetch<CreateOnlineCodeBatchResult>(
    "/online-codes/bulk",
    token,
    { method: "POST", body: JSON.stringify(input) },
  );
}

export function updateOnlineCode(
  token: string,
  id: string,
  input: UpdateOnlineCodeInput,
) {
  return onlineCodeFetch<OnlineCode>(
    `/online-codes/${encodeURIComponent(id)}`,
    token,
    { method: "PATCH", body: JSON.stringify(input) },
  );
}

export function deleteOnlineCode(token: string, id: string) {
  return onlineCodeFetch<void>(
    `/online-codes/${encodeURIComponent(id)}`,
    token,
    { method: "DELETE" },
  );
}
