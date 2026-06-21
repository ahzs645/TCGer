/**
 * Collector-number OCR tiebreaker (the twin-killer).
 *
 * No embedding separates same-art reprints / evolution twins by vision alone
 * (verified — docs/client-side-scanner-options.md). The embedding produces a
 * top-K *shortlist*; this module reads the printed collector number from the
 * card footer and intersects it with the shortlist's known numbers to pick the
 * exact print. Identity is keyed (setCode, collectorNumber) — parsed from each
 * candidate's externalId ("SET-NUM").
 *
 * Robustness comes from the shortlist constraint, not clean OCR: footer text is
 * noisy (copyright years, set logos), but we only need to match against the
 * ~5-20 candidate numbers, so "766 19994/102" still resolves to 4/102 when a
 * candidate is number 4. Only ~40% of frames yield readable text, so callers
 * should vote across frames.
 *
 * Engine: Tesseract.js here (works in browser + Node, easy to wire). The doc's
 * production mobile engine is PP-OCRv5-mobile-ONNX (Tesseract.js has documented
 * mobile-Safari OOM/hangs) — swap behind `readFooterText` when ready.
 */

import { createCanvas, getContext2d } from "./canvas-utils";
import type { BrowserVideoScanCandidate } from "./scan-types";
import type { TcgCode } from "@/types/card";

// ---------- per-game footer regions (fraction of the rectified card) ----------

interface FooterRegion {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

/** Where the collector number lives. Pokémon era varies (bottom-left modern,
 *  bottom-right classic), so OCR each corner separately — a tight crop reads far
 *  better than the full strip (which mixes in copyright/set-logo text). */
const FOOTER_REGIONS: Record<string, FooterRegion[]> = {
  pokemon: [
    { top: 0.89, bottom: 0.98, left: 0.0, right: 0.5 }, // bottom-left (modern)
    { top: 0.89, bottom: 0.98, left: 0.5, right: 1.0 }, // bottom-right (classic)
  ],
  magic: [{ top: 0.9, bottom: 0.99, left: 0.0, right: 0.45 }],
  yugioh: [{ top: 0.9, bottom: 0.99, left: 0.0, right: 1.0 }],
};

const UPSCALE = 4;

// ---------- identity parsing ----------

/** Normalise a collector number for comparison (strip leading zeros, lowercase). */
export function normalizeCollectorNumber(num: string): string {
  const t = num.trim().toLowerCase();
  const stripped = t.replace(/^0+(\d)/, "$1");
  return stripped;
}

/** Parse (setCode, collectorNumber) from an externalId "SET-NUM". */
export function parseExternalId(externalId: string): {
  setCode: string | null;
  collectorNumber: string | null;
} {
  const idx = externalId.indexOf("-");
  if (idx <= 0) return { setCode: null, collectorNumber: null };
  return {
    setCode: externalId.slice(0, idx).toLowerCase(),
    collectorNumber: normalizeCollectorNumber(externalId.slice(idx + 1)),
  };
}

// ---------- OCR engine (lazy Tesseract.js) ----------

type TesseractWorker = {
  setParameters: (params: Record<string, string>) => Promise<unknown>;
  recognize: (image: unknown) => Promise<{ data: { text: string } }>;
  terminate: () => Promise<unknown>;
};

let workerPromise: Promise<TesseractWorker> | null = null;

async function getWorker(): Promise<TesseractWorker> {
  if (workerPromise) return workerPromise;
  workerPromise = (async () => {
    const tesseract = (await import("tesseract.js")) as unknown as {
      createWorker: (lang: string) => Promise<TesseractWorker>;
    };
    const worker = await tesseract.createWorker("eng");
    await worker.setParameters({
      tessedit_char_whitelist: "0123456789/",
    });
    return worker;
  })();
  return workerPromise;
}

export function isOcrReady(): boolean {
  return workerPromise !== null;
}

/** Idempotently warm up the OCR worker. */
export async function ensureOcrWorker(): Promise<void> {
  await getWorker();
}

// ---------- footer reading ----------

/** Crop + upscale a single footer region of a rectified card crop. */
function cropFooterRegion(
  cardCanvas: HTMLCanvasElement,
  region: FooterRegion,
): HTMLCanvasElement {
  const w = cardCanvas.width;
  const h = cardCanvas.height;
  const sx = Math.max(0, Math.round(w * region.left));
  const sy = Math.max(0, Math.round(h * region.top));
  const sw = Math.min(w - sx, Math.round(w * (region.right - region.left)));
  const sh = Math.min(h - sy, Math.round(h * (region.bottom - region.top)));

  const out = createCanvas(Math.max(1, sw * UPSCALE), Math.max(1, sh * UPSCALE));
  const ctx = getContext2d(out);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(cardCanvas, sx, sy, sw, sh, 0, 0, out.width, out.height);

  // Grayscale + contrast stretch to help the OCR.
  const img = ctx.getImageData(0, 0, out.width, out.height);
  const d = img.data;
  let min = 255;
  let max = 0;
  for (let i = 0; i < d.length; i += 4) {
    const g = (d[i]! + d[i + 1]! + d[i + 2]!) / 3;
    if (g < min) min = g;
    if (g > max) max = g;
  }
  const range = Math.max(1, max - min);
  for (let i = 0; i < d.length; i += 4) {
    const g = (d[i]! + d[i + 1]! + d[i + 2]!) / 3;
    const v = ((g - min) / range) * 255;
    d[i] = d[i + 1] = d[i + 2] = v;
  }
  ctx.putImageData(img, 0, 0);
  return out;
}

export interface OcrReading {
  raw: string;
  /** "NNN/NNN" pairs found (collector number + set total). */
  pairs: Array<{ number: string; denominator: string }>;
  /** All bare numeric tokens (weaker signal). */
  numbers: string[];
}

const PAIR_RE = /(\d{1,4})\s*\/\s*(\d{1,4})/g;
const NUM_RE = /\d{1,5}/g;

/** OCR each footer corner and extract collector-number candidates. */
export async function readFooterText(
  cardCanvas: HTMLCanvasElement,
  tcg: TcgCode,
): Promise<OcrReading> {
  const worker = await getWorker();
  const regions = FOOTER_REGIONS[tcg] ?? FOOTER_REGIONS.pokemon!;

  const pairs: Array<{ number: string; denominator: string }> = [];
  const numbers: string[] = [];
  const rawParts: string[] = [];

  for (const region of regions) {
    const footer = cropFooterRegion(cardCanvas, region);
    const { data } = await worker.recognize(footer);
    const raw = data.text.replace(/\s+/g, " ").trim();
    if (raw) rawParts.push(raw);
    for (const m of raw.matchAll(PAIR_RE)) {
      pairs.push({
        number: normalizeCollectorNumber(m[1]!),
        denominator: normalizeCollectorNumber(m[2]!),
      });
    }
    for (const m of raw.matchAll(NUM_RE)) {
      numbers.push(normalizeCollectorNumber(m[0]));
    }
  }

  return { raw: rawParts.join(" | "), pairs, numbers };
}

// ---------- fusion ----------

/**
 * Accumulate OCR readings across frames. Single-frame footer OCR is noisy
 * (~40% of frames readable, copyright digits bleed in), so we trust a number
 * only once it recurs — a clean "NNN/NNN" pair counts double a bare number.
 */
export class OcrVoteTracker {
  private votes = new Map<string, { pair: number; bare: number }>();

  add(reading: OcrReading): void {
    for (const p of reading.pairs) this.bucket(p.number).pair += 1;
    for (const n of reading.numbers) this.bucket(n).bare += 1;
  }

  private bucket(n: string): { pair: number; bare: number } {
    let e = this.votes.get(n);
    if (!e) {
      e = { pair: 0, bare: 0 };
      this.votes.set(n, e);
    }
    return e;
  }

  private score(n: string): number {
    const e = this.votes.get(n);
    return e ? e.pair * 2 + e.bare : 0;
  }

  reset(): void {
    this.votes.clear();
  }

  /**
   * Consensus reading from the accumulated votes. A number is a trusted "pair"
   * once it has been read as a clean NNN/NNN at least once; bare numbers must
   * recur (≥2) to count, filtering transient noise. Sorted by vote weight.
   */
  consensus(): OcrReading {
    const pairs: Array<{ number: string; denominator: string }> = [];
    const numbers: string[] = [];
    for (const [n, e] of this.votes) {
      if (e.pair >= 1) pairs.push({ number: n, denominator: "" });
      if (e.pair >= 1 || e.bare >= 2) numbers.push(n);
    }
    pairs.sort((a, b) => this.score(b.number) - this.score(a.number));
    numbers.sort((a, b) => this.score(b) - this.score(a));
    return { raw: "", pairs, numbers };
  }
}

export interface OcrFusionResult {
  candidates: BrowserVideoScanCandidate[];
  /** True if OCR disambiguated to a specific shortlist candidate. */
  matched: boolean;
  matchedExternalId: string | null;
  ocrNumber: string | null;
}

/**
 * Reorder an embedding shortlist using an OCR footer reading. If a candidate's
 * collector number matches an OCR'd number — preferring a full "NNN/NNN" pair —
 * promote it to the top and mark it confident.
 */
export function fuseOcrWithShortlist(
  candidates: BrowserVideoScanCandidate[],
  reading: OcrReading,
  tcg: TcgCode,
): OcrFusionResult {
  if (candidates.length === 0) {
    return { candidates, matched: false, matchedExternalId: null, ocrNumber: null };
  }

  // Only override the embedding on a clean "NNN/NNN" PAIR match. Bare single
  // numbers are too noisy on real frames — a stray digit (e.g. an HP or year
  // fragment) was observed promoting a wrong same-number card over a confident
  // embedding. The doc's rule: trust OCR only when it strongly agrees.
  const pairNumbers = new Set(reading.pairs.map((p) => p.number));
  if (pairNumbers.size === 0) {
    return { candidates, matched: false, matchedExternalId: null, ocrNumber: null };
  }

  let best: { idx: number; number: string } | null = null;
  candidates.forEach((c, idx) => {
    if (c.tcg !== tcg) return;
    const { collectorNumber } = parseExternalId(c.externalId);
    if (!collectorNumber || !pairNumbers.has(collectorNumber)) return;
    // Highest-ranked (by embedding) candidate whose number the OCR confirms.
    if (!best) best = { idx, number: collectorNumber };
  });

  if (!best) {
    return { candidates, matched: false, matchedExternalId: null, ocrNumber: null };
  }

  const chosen = best as { idx: number; number: string };
  const matchedCandidate = candidates[chosen.idx]!;
  // Promote the OCR-confirmed candidate to the top, marked confident.
  const reordered = [
    { ...matchedCandidate, passedThreshold: true, proposalLabel: "embedding+ocr" },
    ...candidates.filter((_, i) => i !== chosen.idx),
  ];

  return {
    candidates: reordered,
    matched: true,
    matchedExternalId: matchedCandidate.externalId,
    ocrNumber: chosen.number,
  };
}
