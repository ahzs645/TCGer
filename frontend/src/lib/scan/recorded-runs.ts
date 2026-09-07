import Dexie, { type Table } from "dexie";
import { SCANNER_REVIEW_DB_NAME } from "@/lib/storage/keys";
import type { CardScanMatch } from "@/lib/api/scan";
export interface RecordedAttempt {
  id: string;
  at: string;
  engine: string;
  elapsedMs: number;
  accepted: CardScanMatch | null;
  candidates: CardScanMatch[];
  crop?: Blob;
  expectedId?: string | null;
}
export interface RecordedRun {
  ownerId?: string;
  id: string;
  name: string;
  createdAt: string;
  attempts: RecordedAttempt[];
}
export function recordingDatabase() {
  const db = new Dexie(SCANNER_REVIEW_DB_NAME);
  db.version(1).stores({ drafts: "" });
  db.version(2).stores({ drafts: "", runs: "id,createdAt" });
  return { db, runs: db.table("runs") as Table<RecordedRun, string> };
}
export async function exportRecordedRun(run: RecordedRun): Promise<string> {
  return JSON.stringify(
    {
      format: "com.tcger.scanner-run",
      version: 1,
      ...run,
      ownerId: undefined,
      attempts: await Promise.all(
        run.attempts.map(async (attempt) => {
          if (!attempt.crop) return attempt;
          let binary = "";
          const bytes = new Uint8Array(await attempt.crop.arrayBuffer());
          for (let i = 0; i < bytes.length; i += 8192)
            binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
          return { ...attempt, crop: undefined, cropBase64: btoa(binary) };
        }),
      ),
    },
    null,
    2,
  );
}
export function importRecordedRun(raw: string): RecordedRun {
  const value = JSON.parse(raw);
  if (
    value.format !== "com.tcger.scanner-run" ||
    value.version !== 1 ||
    !Array.isArray(value.attempts) ||
    value.attempts.length > 500
  )
    throw new Error("Unsupported scanner recording");
  return {
    id: String(value.id),
    name: String(value.name),
    createdAt: String(value.createdAt),
    attempts: value.attempts.map((item: any) => {
      if (
        typeof item.id !== "string" ||
        !Array.isArray(item.candidates) ||
        !Number.isFinite(item.elapsedMs)
      )
        throw new Error("Invalid recording attempt");
      return {
        ...item,
        crop: item.cropBase64
          ? new Blob(
              [Uint8Array.from(atob(item.cropBase64), (c) => c.charCodeAt(0))],
              { type: "image/jpeg" },
            )
          : undefined,
      };
    }),
  };
}
export function replaySummary(
  results: {
    expectedId: string | null | undefined;
    actualId: string | null;
    elapsedMs: number;
  }[],
) {
  const labeled = results.filter((result) => result.expectedId !== undefined);
  const timings = results
    .map((result) => result.elapsedMs)
    .sort((a, b) => a - b);
  return {
    total: results.length,
    labeled: labeled.length,
    correct: labeled.filter((result) => result.expectedId === result.actualId)
      .length,
    falsePositives: labeled.filter(
      (result) => result.expectedId === null && result.actualId !== null,
    ).length,
    misses: labeled.filter(
      (result) => result.expectedId !== null && result.actualId === null,
    ).length,
    meanMs: results.length
      ? results.reduce((n, r) => n + r.elapsedMs, 0) / results.length
      : 0,
    p95Ms: timings[Math.max(0, Math.ceil(timings.length * 0.95) - 1)] ?? 0,
  };
}
