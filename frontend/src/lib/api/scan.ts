import { API_BASE_URL } from "@/lib/api/base-url";
import type { TcgCode } from "@/types/card";

export interface CardScanHash {
  r: string;
  g: string;
  b: string;
}

export interface CardScanMatch {
  externalId: string;
  tcg: TcgCode;
  name: string;
  setCode: string | null;
  setName: string | null;
  rarity: string | null;
  imageUrl: string | null;
  confidence: number;
  distance: number;
}

export interface CardScanMeta {
  quality?: number;
  thresholdUsed?: number;
  variantUsed?: string;
  variantsTried?: string[];
  perspectiveCorrected?: boolean;
  contourAreaRatio?: number;
}

export interface CardScanDebugCaptureSummary {
  id: string;
  requestedTcg?: string | null;
  captureSource?: string | null;
  sourceImagePath: string;
  sourceImageUrl: string;
  feedbackStatus: "unreviewed" | "correct" | "incorrect" | "needs_review";
  notes?: string | null;
  expectedExternalId?: string | null;
  expectedName?: string | null;
  expectedTcg?: string | null;
  createdAt: string;
  updatedAt: string;
  bestMatch: {
    externalId: string;
    name: string | null;
    tcg: TcgCode | null;
    confidence: number | null;
    distance: number | null;
  } | null;
}

export interface CardScanResponse {
  match: CardScanMatch | null;
  candidates: CardScanMatch[];
  hash: CardScanHash;
  meta?: CardScanMeta;
  debugCapture?: CardScanDebugCaptureSummary | null;
  debugCaptureError?: string | null;
}

export interface CardScanStats {
  magic: number;
  pokemon: number;
  yugioh: number;
  total: number;
  storeMode: string;
}

async function handleResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const errorPayload = await response.json().catch(() => ({}));
    const message = errorPayload?.message ?? response.statusText;
    throw new Error(message || "Scan request failed");
  }

  return response.json() as Promise<T>;
}

export async function scanCardImageApi(params: {
  file: File;
  token: string;
  tcg?: TcgCode | "all";
  saveDebugCapture?: boolean;
  captureSource?: string;
  captureNotes?: string;
}): Promise<CardScanResponse> {
  const { file, token, tcg, saveDebugCapture, captureSource, captureNotes } =
    params;
  const formData = new FormData();
  formData.append("image", file);
  if (saveDebugCapture) {
    formData.append("saveDebugCapture", "1");
  }
  if (captureSource) {
    formData.append("captureSource", captureSource);
  }
  if (captureNotes?.trim()) {
    formData.append("captureNotes", captureNotes.trim());
  }

  const searchParams = new URLSearchParams();
  if (tcg && tcg !== "all") {
    searchParams.set("tcg", tcg);
  }

  const suffix = searchParams.size ? `?${searchParams.toString()}` : "";
  const response = await fetch(`${API_BASE_URL}/cards/scan${suffix}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
    },
    body: formData,
    credentials: "include",
  });

  return handleResponse<CardScanResponse>(response);
}

export async function getCardScanDebugCapturesApi(params: {
  token: string;
  limit?: number;
  scope?: "mine" | "all";
}): Promise<{ captures: CardScanDebugCaptureSummary[] }> {
  const { token, limit, scope } = params;
  const searchParams = new URLSearchParams();
  if (limit) {
    searchParams.set("limit", String(limit));
  }
  if (scope) {
    searchParams.set("scope", scope);
  }
  const suffix = searchParams.size ? `?${searchParams.toString()}` : "";

  const response = await fetch(
    `${API_BASE_URL}/cards/scan/debug-captures${suffix}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
      },
      credentials: "include",
      cache: "no-store",
    },
  );

  return handleResponse<{ captures: CardScanDebugCaptureSummary[] }>(response);
}

export async function updateCardScanDebugCaptureApi(params: {
  captureId: string;
  token: string;
  feedbackStatus?: CardScanDebugCaptureSummary["feedbackStatus"];
  notes?: string;
  expectedExternalId?: string;
  expectedName?: string;
  expectedTcg?: TcgCode | "all";
}): Promise<{ capture: CardScanDebugCaptureSummary }> {
  const {
    captureId,
    token,
    feedbackStatus,
    notes,
    expectedExternalId,
    expectedName,
    expectedTcg,
  } = params;

  const response = await fetch(
    `${API_BASE_URL}/cards/scan/debug-captures/${captureId}`,
    {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      credentials: "include",
      body: JSON.stringify({
        feedbackStatus,
        notes,
        expectedExternalId,
        expectedName,
        expectedTcg: expectedTcg === "all" ? null : expectedTcg,
      }),
    },
  );

  return handleResponse<{ capture: CardScanDebugCaptureSummary }>(response);
}

export async function getCardScanStatsApi(
  token: string,
): Promise<CardScanStats> {
  const response = await fetch(`${API_BASE_URL}/cards/scan/stats`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
    credentials: "include",
    cache: "no-store",
  });

  return handleResponse<CardScanStats>(response);
}
