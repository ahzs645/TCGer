import { z } from 'zod';

export const yugiohBanlistFormatSchema = z.enum([
  'tcg',
  'traditional',
  'ocg',
  'goat',
]);
export type YugiohBanlistFormat = z.infer<typeof yugiohBanlistFormatSchema>;

export const yugiohBanlistStatusSchema = z.enum([
  'forbidden',
  'limited',
  'semi-limited',
]);
export type YugiohBanlistStatus = z.infer<typeof yugiohBanlistStatusSchema>;

export interface YugiohBanlistEntry {
  externalId?: string;
  cardName: string;
  normalizedName: string;
  status: YugiohBanlistStatus;
  limit: 0 | 1 | 2;
  remarks?: string;
}

export interface YugiohBanlistSnapshot {
  id: string;
  format: YugiohBanlistFormat;
  name: string;
  effectiveDate?: string;
  sourceUrl: string;
  identitySourceUrl?: string;
  syncedAt: string;
  entries: YugiohBanlistEntry[];
}

export interface YugiohBanlistSyncResult {
  synced: Array<{
    format: YugiohBanlistFormat;
    snapshotId: string;
    entryCount: number;
    effectiveDate?: string;
    unchanged: boolean;
  }>;
}

export function yugiohBanlistLimit(status: YugiohBanlistStatus): 0 | 1 | 2 {
  if (status === 'forbidden') return 0;
  if (status === 'limited') return 1;
  return 2;
}

export function normalizeYugiohCardName(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[’‘`]/g, "'")
    .replace(/[–—]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .toLocaleUpperCase('en-US');
}
