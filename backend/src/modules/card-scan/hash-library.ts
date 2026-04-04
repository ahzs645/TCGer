import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

import type { CardHashRecord } from './hash-store';

export interface CardHashLibraryEntry extends CardHashRecord {
  sourceImageUrl: string;
  localImagePath: string;
  contentType: string | null;
}

export interface CardHashLibrarySummary {
  rootDir: string;
  indexPath: string;
  total: number;
}

interface CardHashLibraryPayload {
  version: 1;
  tcg: string;
  generatedAt: string;
  total: number;
  entries: CardHashLibraryEntry[];
}

function compareEntries(left: CardHashLibraryEntry, right: CardHashLibraryEntry): number {
  return (
    left.name.localeCompare(right.name) ||
    left.setCode?.localeCompare(right.setCode ?? '') ||
    left.externalId.localeCompare(right.externalId)
  );
}

function sanitizePathSegment(value: string | null | undefined): string {
  const normalized = (value ?? 'unknown').trim();
  return normalized.replace(/[^a-zA-Z0-9._-]+/g, '_');
}

function resolveImageExtension(sourceImageUrl: string, contentType: string | null): string {
  const normalizedContentType = contentType?.toLowerCase() ?? '';
  if (normalizedContentType.includes('webp')) {
    return '.webp';
  }
  if (normalizedContentType.includes('png')) {
    return '.png';
  }
  if (normalizedContentType.includes('jpeg') || normalizedContentType.includes('jpg')) {
    return '.jpg';
  }

  try {
    const pathname = new URL(sourceImageUrl).pathname;
    const extension = path.extname(pathname);
    if (extension) {
      return extension;
    }
  } catch {
    // Fall back to a generic image extension if URL parsing fails.
  }

  return '.img';
}

export class CardHashLibraryWriter {
  private readonly tcgRootDir: string;
  private readonly indexPath: string;
  private entries = new Map<string, CardHashLibraryEntry>();

  constructor(
    private readonly rootDir: string,
    private readonly tcg: string,
    private readonly reset: boolean
  ) {
    this.tcgRootDir = path.join(rootDir, tcg);
    this.indexPath = path.join(this.tcgRootDir, 'index.json');
  }

  async init(): Promise<void> {
    if (this.reset) {
      await rm(this.tcgRootDir, { recursive: true, force: true });
    }

    await mkdir(this.tcgRootDir, { recursive: true });

    if (!this.reset) {
      await this.loadExistingEntries();
    }
  }

  async writeRecord(
    record: CardHashRecord,
    imageBuffer: Buffer,
    contentType: string | null
  ): Promise<void> {
    const extension = resolveImageExtension(record.imageUrl ?? '', contentType);
    const setDir = sanitizePathSegment(record.setCode);
    const fileName = `${sanitizePathSegment(record.externalId)}${extension}`;
    const relativeImagePath = path.posix.join('images', setDir, fileName);
    const absoluteImagePath = path.join(this.tcgRootDir, relativeImagePath);

    await mkdir(path.dirname(absoluteImagePath), { recursive: true });
    await writeFile(absoluteImagePath, imageBuffer);

    this.entries.set(record.externalId, {
      ...record,
      sourceImageUrl: record.imageUrl ?? '',
      localImagePath: relativeImagePath,
      contentType,
    });
  }

  async persist(): Promise<CardHashLibrarySummary> {
    const payload: CardHashLibraryPayload = {
      version: 1,
      tcg: this.tcg,
      generatedAt: new Date().toISOString(),
      total: this.entries.size,
      entries: Array.from(this.entries.values()).sort(compareEntries),
    };

    await mkdir(this.tcgRootDir, { recursive: true });
    await writeFile(this.indexPath, `${JSON.stringify(payload)}\n`, 'utf8');

    return {
      rootDir: this.tcgRootDir,
      indexPath: this.indexPath,
      total: payload.total,
    };
  }

  private async loadExistingEntries(): Promise<void> {
    try {
      const raw = await readFile(this.indexPath, 'utf8');
      const parsed = JSON.parse(raw) as { entries?: CardHashLibraryEntry[] };
      if (!Array.isArray(parsed.entries)) {
        return;
      }

      this.entries = new Map(
        parsed.entries.map((entry) => [entry.externalId, entry])
      );
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== 'ENOENT') {
        throw error;
      }
    }
  }
}
