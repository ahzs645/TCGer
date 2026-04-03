import { API_BASE_URL } from '@/lib/api/base-url';
import type { TcgCode } from '@/types/card';

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

export interface CardScanResponse {
  match: CardScanMatch | null;
  candidates: CardScanMatch[];
  hash: CardScanHash;
  meta?: CardScanMeta;
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
    throw new Error(message || 'Scan request failed');
  }

  return response.json() as Promise<T>;
}

export async function scanCardImageApi(params: {
  file: File;
  token: string;
  tcg?: TcgCode | 'all';
}): Promise<CardScanResponse> {
  const { file, token, tcg } = params;
  const formData = new FormData();
  formData.append('image', file);

  const searchParams = new URLSearchParams();
  if (tcg && tcg !== 'all') {
    searchParams.set('tcg', tcg);
  }

  const suffix = searchParams.size ? `?${searchParams.toString()}` : '';
  const response = await fetch(`${API_BASE_URL}/cards/scan${suffix}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`
    },
    body: formData,
    credentials: 'include'
  });

  return handleResponse<CardScanResponse>(response);
}

export async function getCardScanStatsApi(token: string): Promise<CardScanStats> {
  const response = await fetch(`${API_BASE_URL}/cards/scan/stats`, {
    headers: {
      Authorization: `Bearer ${token}`
    },
    credentials: 'include',
    cache: 'no-store'
  });

  return handleResponse<CardScanStats>(response);
}
