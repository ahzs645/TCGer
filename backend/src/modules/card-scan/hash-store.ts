import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { PrismaClient } from '@prisma/client';

import { env } from '../../config/env';
import { logger } from '../../utils/logger';

export type CardScanStoreMode = 'file' | 'prisma';

export interface CardHashRecord {
  tcg: string;
  externalId: string;
  name: string;
  setCode: string | null;
  setName: string | null;
  rarity: string | null;
  imageUrl: string | null;
  rHash: string;
  gHash: string;
  bHash: string;
  hashSize: number;
}

interface CardHashQuery {
  tcg?: string;
}

interface CardHashPageQuery extends CardHashQuery {
  skip: number;
  take: number;
}

interface CardHashStore {
  readonly mode: CardScanStoreMode;
  getAll(query?: CardHashQuery): Promise<CardHashRecord[]>;
  getPage(query: CardHashPageQuery): Promise<CardHashRecord[]>;
  count(query?: CardHashQuery): Promise<number>;
  getExternalIdSet(tcg: string): Promise<Set<string>>;
  upsertMany(records: CardHashRecord[]): Promise<void>;
}

const prisma = env.DATABASE_URL ? new PrismaClient() : null;

function resolveStoreMode(): CardScanStoreMode {
  if (env.CARD_SCAN_STORE === 'file') {
    return 'file';
  }

  if (env.CARD_SCAN_STORE === 'prisma') {
    if (prisma) {
      return 'prisma';
    }

    logger.warn('CARD_SCAN_STORE=prisma requested without DATABASE_URL; falling back to file store');
    return 'file';
  }

  return prisma ? 'prisma' : 'file';
}

function compareEntriesByName(left: CardHashRecord, right: CardHashRecord): number {
  return (
    left.name.localeCompare(right.name) ||
    left.tcg.localeCompare(right.tcg) ||
    left.externalId.localeCompare(right.externalId)
  );
}

function makeCompositeKey(tcg: string, externalId: string): string {
  return `${tcg}::${externalId}`;
}

function normalizeRecord(record: CardHashRecord): CardHashRecord {
  return {
    ...record,
    setCode: record.setCode ?? null,
    setName: record.setName ?? null,
    rarity: record.rarity ?? null,
    imageUrl: record.imageUrl ?? null,
    hashSize: record.hashSize ?? 16,
  };
}

class PrismaCardHashStore implements CardHashStore {
  readonly mode = 'prisma' as const;
  private cachePromise: Promise<Map<string, CardHashRecord[]>> | null = null;

  constructor(private readonly client: PrismaClient) {}

  async getAll(query: CardHashQuery = {}): Promise<CardHashRecord[]> {
    const cache = await this.getCache();
    if (query.tcg) {
      return [...(cache.get(query.tcg) ?? [])];
    }

    return Array.from(cache.values())
      .flat()
      .sort(compareEntriesByName);
  }

  async getPage(query: CardHashPageQuery): Promise<CardHashRecord[]> {
    const records = await this.client.cardHash.findMany({
      where: query.tcg ? { tcg: query.tcg } : undefined,
      skip: query.skip,
      take: query.take,
      orderBy: [{ name: 'asc' }, { externalId: 'asc' }],
    });

    return records.map((record) => normalizeRecord(record));
  }

  async count(query: CardHashQuery = {}): Promise<number> {
    const cache = await this.getCache();
    if (query.tcg) {
      return cache.get(query.tcg)?.length ?? 0;
    }

    return Array.from(cache.values()).reduce((total, entries) => total + entries.length, 0);
  }

  async getExternalIdSet(tcg: string): Promise<Set<string>> {
    const records = await this.getAll({ tcg });
    return new Set(records.map((record) => record.externalId));
  }

  async upsertMany(records: CardHashRecord[]): Promise<void> {
    if (!records.length) {
      return;
    }

    const batchSize = 50;
    for (let index = 0; index < records.length; index += batchSize) {
      const batch = records.slice(index, index + batchSize);
      await this.client.$transaction(
        batch.map((record) =>
          this.client.cardHash.upsert({
            where: {
              tcg_externalId: {
                tcg: record.tcg,
                externalId: record.externalId,
              },
            },
            create: record,
            update: record,
          })
        )
      );
    }

    this.cachePromise = null;
  }

  private async getCache(): Promise<Map<string, CardHashRecord[]>> {
    if (!this.cachePromise) {
      this.cachePromise = this.loadCache();
    }

    return this.cachePromise;
  }

  private async loadCache(): Promise<Map<string, CardHashRecord[]>> {
    const records = await this.client.cardHash.findMany({
      orderBy: [{ tcg: 'asc' }, { name: 'asc' }, { externalId: 'asc' }],
    });

    const grouped = new Map<string, CardHashRecord[]>();
    for (const record of records) {
      const normalized = normalizeRecord(record);
      const bucket = grouped.get(normalized.tcg) ?? [];
      bucket.push(normalized);
      grouped.set(normalized.tcg, bucket);
    }

    for (const bucket of grouped.values()) {
      bucket.sort(compareEntriesByName);
    }

    return grouped;
  }
}

class FileCardHashStore implements CardHashStore {
  readonly mode = 'file' as const;
  private cachePromise: Promise<Map<string, CardHashRecord>> | null = null;
  private writeChain: Promise<void> = Promise.resolve();

  constructor(private readonly dataDir: string) {}

  async getAll(query: CardHashQuery = {}): Promise<CardHashRecord[]> {
    const cache = await this.getCache();
    const entries = Array.from(cache.values());
    return entries
      .filter((entry) => !query.tcg || entry.tcg === query.tcg)
      .sort(compareEntriesByName);
  }

  async getPage(query: CardHashPageQuery): Promise<CardHashRecord[]> {
    const entries = await this.getAll(query);
    return entries.slice(query.skip, query.skip + query.take);
  }

  async count(query: CardHashQuery = {}): Promise<number> {
    const entries = await this.getAll(query);
    return entries.length;
  }

  async getExternalIdSet(tcg: string): Promise<Set<string>> {
    const entries = await this.getAll({ tcg });
    return new Set(entries.map((entry) => entry.externalId));
  }

  async upsertMany(records: CardHashRecord[]): Promise<void> {
    if (!records.length) {
      return;
    }

    const cache = await this.getCache();
    let dirty = false;

    for (const record of records) {
      const normalized = normalizeRecord(record);
      const key = makeCompositeKey(normalized.tcg, normalized.externalId);
      const existing = cache.get(key);

      if (!existing || JSON.stringify(existing) !== JSON.stringify(normalized)) {
        cache.set(key, normalized);
        dirty = true;
      }
    }

    if (dirty) {
      await this.persist(cache);
    }
  }

  private async getCache(): Promise<Map<string, CardHashRecord>> {
    if (!this.cachePromise) {
      this.cachePromise = this.loadCache();
    }

    return this.cachePromise;
  }

  private get filePath(): string {
    return path.join(this.dataDir, 'hashes.json');
  }

  private async loadCache(): Promise<Map<string, CardHashRecord>> {
    await mkdir(this.dataDir, { recursive: true });

    try {
      const raw = await readFile(this.filePath, 'utf8');
      const parsed = JSON.parse(raw) as { entries?: CardHashRecord[] } | CardHashRecord[];
      const entries = Array.isArray(parsed) ? parsed : parsed.entries ?? [];
      const cache = new Map<string, CardHashRecord>();

      for (const entry of entries) {
        const normalized = normalizeRecord(entry);
        cache.set(makeCompositeKey(normalized.tcg, normalized.externalId), normalized);
      }

      return cache;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'ENOENT') {
        return new Map();
      }
      throw error;
    }
  }

  private async persist(cache: Map<string, CardHashRecord>): Promise<void> {
    const payload = JSON.stringify(
      {
        version: 1,
        entries: Array.from(cache.values()).sort(compareEntriesByName),
      },
      null,
      2
    );

    this.writeChain = this.writeChain.then(async () => {
      await mkdir(this.dataDir, { recursive: true });
      await writeFile(this.filePath, payload, 'utf8');
    });

    await this.writeChain;
  }
}

const activeStoreMode = resolveStoreMode();
const store: CardHashStore =
  activeStoreMode === 'prisma' && prisma
    ? new PrismaCardHashStore(prisma)
    : new FileCardHashStore(env.CARD_SCAN_DATA_DIR);

export function getCardHashStoreMode(): CardScanStoreMode {
  return store.mode;
}

export async function getAllCardHashes(query: CardHashQuery = {}): Promise<CardHashRecord[]> {
  return store.getAll(query);
}

export async function getCardHashPage(query: CardHashPageQuery): Promise<CardHashRecord[]> {
  return store.getPage(query);
}

export async function countCardHashes(query: CardHashQuery = {}): Promise<number> {
  return store.count(query);
}

export async function getCardHashExternalIdSet(tcg: string): Promise<Set<string>> {
  return store.getExternalIdSet(tcg);
}

export async function upsertCardHashes(records: CardHashRecord[]): Promise<void> {
  return store.upsertMany(records);
}
