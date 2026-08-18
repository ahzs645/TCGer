import { API_BASE_URL } from "./base-url";

export interface SharedScanSession {
  id: string;
  code: string;
  name: string;
  status: "open" | "committed" | "closed";
  defaultLanguage: string;
  binderId?: string;
  itemCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface SharedScanItem {
  id: string;
  clientEventId: string;
  tcg: string;
  externalId: string;
  name: string;
  setCode?: string;
  setName?: string;
  rarity?: string;
  imageUrl?: string;
  price?: number;
  confidence?: number;
  condition?: string;
  language: string;
  finishCode?: string;
  finishLabel?: string;
  committedEntryId?: string;
  createdAt: string;
  updatedAt: string;
}

async function request<T>(path: string, token: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...init?.headers,
    },
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.message || "Scan session request failed");
  }
  return response.json();
}

export function createSharedScanSession(token: string, defaultLanguage: string) {
  return request<SharedScanSession>("/scan-sessions", token, {
    method: "POST",
    body: JSON.stringify({ defaultLanguage }),
  });
}

export function getSharedScanItems(token: string, sessionId: string) {
  return request<SharedScanItem[]>(`/scan-sessions/${encodeURIComponent(sessionId)}/items`, token);
}

export function addSharedScanItem(
  token: string,
  input: Omit<SharedScanItem, "id" | "createdAt" | "updatedAt" | "committedEntryId"> & { code: string },
) {
  return request<SharedScanItem>("/scan-sessions/items", token, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function updateSharedScanItem(
  token: string,
  itemId: string,
  patch: Pick<SharedScanItem, "language"> & Partial<Pick<SharedScanItem, "condition" | "finishCode" | "finishLabel">>,
) {
  return request<SharedScanItem>(`/scan-sessions/items/${encodeURIComponent(itemId)}`, token, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
}

export function commitSharedScanSession(token: string, sessionId: string, binderId: string) {
  return request<{ committed: number }>(`/scan-sessions/${encodeURIComponent(sessionId)}/commit`, token, {
    method: "POST",
    body: JSON.stringify({ binderId }),
  });
}
