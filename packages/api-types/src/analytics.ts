// ---------------------------------------------------------------------------
// Analytics Response Types
// ---------------------------------------------------------------------------

export interface CollectionValuePoint {
  date: string;
  value: number;
}

export interface CollectionValueHistory {
  history: CollectionValuePoint[];
  currentValue: number;
  changePercent: number;
  changePeriod: string;
}

export interface CollectionValueBreakdown {
  byTcg: Array<{ tcg: string; value: number; cardCount: number }>;
  byBinder: Array<{ binderId: string; binderName: string; value: number; cardCount: number }>;
  topCards: Array<{ externalId: string; tcg: string; name: string; value: number; imageUrl?: string }>;
}

export interface DistributionEntry {
  label: string;
  count: number;
  percentage: number;
}

export interface CollectionDistribution {
  dimension: string;
  entries: DistributionEntry[];
  total: number;
}
