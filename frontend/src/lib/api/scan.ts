import { API_BASE_URL } from "@/lib/api/base-url";
import type { TcgCode } from "@/types/card";

export interface CardScanHash {
  r: string;
  g: string;
  b: string;
}

export interface CardScanHashEntry {
  tcg: TcgCode;
  externalId: string;
  name: string;
  setCode: string | null;
  setName: string | null;
  rarity: string | null;
  imageUrl: string | null;
  rHash: string;
  gHash: string;
  bHash: string;
  titleRHash?: string | null;
  titleGHash?: string | null;
  titleBHash?: string | null;
  footerRHash?: string | null;
  footerGHash?: string | null;
  footerBHash?: string | null;
  hashSize: number;
}

export interface CardScanHashPageResponse {
  entries: CardScanHashEntry[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
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

export interface CardScanDiagnosticCandidate extends CardScanMatch {
  scoreDistance: number;
  passedThreshold: boolean;
}

export interface CardScanTimingMetrics {
  preprocessMs: number;
  perspectiveCorrectionMs: number;
  qualityMs: number;
  hashMs: number;
  featureHashMs: number;
  rankingMs: number;
  artworkPrefilterMs: number | null;
  artworkRerankMs: number | null;
  ocrMs: number | null;
  totalMs: number;
}

export interface CardScanQualityMetrics {
  score: number;
  focusVariance: number;
  edgeDensity: number;
  contrast: number;
}

export interface CardScanMeta {
  quality?: CardScanQualityMetrics | null;
  thresholdUsed?: number;
  variantUsed?: string;
  variantsTried?: string[];
  perspectiveCorrected?: boolean;
  contourAreaRatio?: number;
  contourConfidence?: number | null;
  rotationAngle?: number | null;
  cropAspectRatio?: number | null;
  cropWidth?: number | null;
  cropHeight?: number | null;
  cropCandidateScore?: number | null;
  contourPoints?: Array<{ x: number; y: number }> | null;
  maskVariant?: string | null;
  rerankUsed?: boolean;
  shortlistSize?: number;
  timings?: CardScanTimingMetrics | null;
}

export type CardScanReviewTag =
  | "wrong_printing"
  | "wrong_species"
  | "bad_crop"
  | "blur"
  | "glare"
  | "multiple_cards"
  | "energy_or_trainer"
  | "no_card_present";

export interface CardScanArtworkDiagnostic {
  externalId: string;
  name: string;
  setCode: string | null;
  similarity: number;
}

export interface CardScanAttemptDiagnostic {
  variant: string;
  threshold: number;
  hashMs: number;
  featureHashMs: number;
  rankingMs: number;
  rerankUsed: boolean;
  shortlistSize: number;
  acceptedCandidates: CardScanDiagnosticCandidate[];
  rejectedNearMisses: CardScanDiagnosticCandidate[];
}

export interface CardScanDatasetRevision {
  path: string;
  version: number | null;
  total: number | null;
  sizeBytes: number;
  modifiedAt: string;
  revision: string;
}

export interface CardScanPipelineSnapshot {
  build: {
    gitSha: string | null;
    imageTag: string | null;
    backendMode: string | null;
  };
  matcher: {
    phashVersion: string;
    artworkVersion: string;
    featureHashVersion: string;
    detectorModelVersion: string | null;
    ocrModelVersion: string | null;
  };
  hashDatabase: {
    storeMode: string;
    dataset: CardScanDatasetRevision | null;
  };
  artworkDatabase: {
    dataset: CardScanDatasetRevision | null;
  };
}

export interface CardScanDebugCaptureSummary {
  id: string;
  requestedTcg?: string | null;
  captureSource?: string | null;
  sourceImagePath: string;
  sourceImageUrl: string;
  feedbackStatus: "unreviewed" | "correct" | "incorrect" | "needs_review";
  reviewTags: CardScanReviewTag[];
  notes?: string | null;
  expectedExternalId?: string | null;
  expectedName?: string | null;
  expectedTcg?: string | null;
  reviewedAt?: string | null;
  createdAt: string;
  updatedAt: string;
  artifactImages: {
    correctedImagePath?: string | null;
    correctedImageUrl?: string | null;
    artworkImagePath?: string | null;
    artworkImageUrl?: string | null;
    titleImagePath?: string | null;
    titleImageUrl?: string | null;
    footerImagePath?: string | null;
    footerImageUrl?: string | null;
  };
  pipeline?: CardScanPipelineSnapshot | null;
  diagnostics?: {
    timings?: CardScanTimingMetrics | null;
    attempts?: CardScanAttemptDiagnostic[];
    rejectedNearMisses?: CardScanDiagnosticCandidate[];
    artwork?: {
      prefilterApplied: boolean;
      prefilterTopMatches: CardScanArtworkDiagnostic[];
      rerankTopMatches: CardScanArtworkDiagnostic[];
    } | null;
    ocr?: {
      attempted: boolean;
      durationMs: number | null;
      candidates: Array<{ text: string; confidence: number }>;
    } | null;
    geometry?: {
      perspectiveCorrected?: boolean | null;
      contourAreaRatio?: number | null;
      contourConfidence?: number | null;
      rotationAngle?: number | null;
      cropAspectRatio?: number | null;
      cropWidth?: number | null;
      cropHeight?: number | null;
      cropCandidateScore?: number | null;
      contourPoints?: Array<{ x: number; y: number }>;
      maskVariant?: string | null;
    } | null;
  } | null;
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

export async function getCardScanHashesPageApi(params: {
  token: string;
  tcg?: TcgCode | "all";
  page?: number;
  pageSize?: number;
}): Promise<CardScanHashPageResponse> {
  const { token, tcg, page, pageSize } = params;
  const searchParams = new URLSearchParams();

  if (tcg && tcg !== "all") {
    searchParams.set("tcg", tcg);
  }
  if (page && page > 0) {
    searchParams.set("page", String(page));
  }
  if (pageSize && pageSize > 0) {
    searchParams.set("pageSize", String(pageSize));
  }

  const suffix = searchParams.size ? `?${searchParams.toString()}` : "";
  const response = await fetch(`${API_BASE_URL}/cards/scan/hashes${suffix}`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
    credentials: "include",
    cache: "no-store",
  });

  return handleResponse<CardScanHashPageResponse>(response);
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
  reviewTags?: CardScanReviewTag[];
  notes?: string;
  expectedExternalId?: string;
  expectedName?: string;
  expectedTcg?: TcgCode | "all";
}): Promise<{ capture: CardScanDebugCaptureSummary }> {
  const {
    captureId,
    token,
    feedbackStatus,
    reviewTags,
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
        reviewTags,
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
