import type { EmbeddingIndex } from "./embedding-matcher";
import type { EmbeddingMatchOptions } from "./embedding-search";
import type { BrowserVideoScanCandidate } from "./scan-types";

export interface EmbeddingSearchRequest {
  id: number;
  query: Float32Array;
  indexes: Array<{ id: number; value?: EmbeddingIndex }>;
  options: EmbeddingMatchOptions;
}

export interface EmbeddingSearchResponse {
  id: number;
  candidates?: BrowserVideoScanCandidate[];
  retainedIndexIds: number[];
  error?: string;
}
