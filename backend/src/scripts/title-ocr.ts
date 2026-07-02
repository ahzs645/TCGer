/**
 * Title-band OCR fallback — the embedding-independent recognition path.
 *
 * For dark-art + glare crops the correct card can be unreachable by the
 * embedding entirely (Galarian Yamask: rank 46 plain, ~rank 1 but 0.61 after
 * rectification — never above threshold). The card NAME, however, is printed
 * in high-contrast type at a known position, and Tesseract reads it verbatim
 * off the rectified crop ("Basic, Galarian Yamask w60").
 *
 * Flow: read the title band -> longest index card-name that appears exactly
 * in the collapsed OCR text -> the embedding picks the PRINT among that
 * name's entries (restricted re-rank; within one name the embedding is
 * reliable even when its global rank is not).
 *
 * Conservative by construction: exact collapsed-substring only (no fuzzy),
 * minimum name length, longest-match-wins (so "Galarian Yamask" beats
 * "Yamask", "Castform Rainy Form" beats "Castform").
 */

import sharp from 'sharp';

export interface TitleNameIndex {
  /** collapsed name -> entry indices in the embedding index. */
  byCollapsedName: Map<string, number[]>;
  /** collapsed names sorted by length descending (longest match wins). */
  namesByLength: string[];
}

/** Lowercase and strip everything but letters+digits ("Mr. Mime" -> "mrmime"). */
export function collapseName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

const MIN_NAME_LENGTH = 6;

export function buildTitleNameIndex(entries: Array<{ name: string }>): TitleNameIndex {
  const byCollapsedName = new Map<string, number[]>();
  entries.forEach((entry, i) => {
    const collapsed = collapseName(entry.name);
    if (collapsed.length < MIN_NAME_LENGTH) return;
    let list = byCollapsedName.get(collapsed);
    if (!list) {
      list = [];
      byCollapsedName.set(collapsed, list);
    }
    list.push(i);
  });
  const namesByLength = [...byCollapsedName.keys()].sort((a, b) => b.length - a.length);
  return { byCollapsedName, namesByLength };
}

/**
 * Find the longest index card name contained verbatim in the OCR text.
 * Returns null when nothing (long enough) matches.
 */
export function matchTitleText(
  ocrText: string,
  nameIndex: TitleNameIndex,
): { collapsedName: string; entryIndices: number[] } | null {
  // Stage-1/2 cards print "Evolves from <pre-evolution>" directly under the
  // title; when OCR reads that line but misses the (stylized) title itself,
  // the pre-evolution name would match (observed: Slurpuff read as Swirlix).
  // Strip the phrase plus the name that follows it before matching.
  const haystack = collapseName(ocrText).replace(/evolvesfrom[a-z0-9]{1,16}/g, '');
  if (haystack.length < MIN_NAME_LENGTH) return null;
  for (const name of nameIndex.namesByLength) {
    if (haystack.includes(name)) {
      return { collapsedName: name, entryIndices: nameIndex.byCollapsedName.get(name)! };
    }
  }
  return null;
}

// ---------- band extraction + OCR ----------

type TesseractWorker = {
  setParameters: (params: Record<string, string>) => Promise<unknown>;
  recognize: (image: Buffer) => Promise<{ data: { text: string } }>;
  terminate: () => Promise<unknown>;
};

/** Shut down the OCR worker; without this the Node process never exits. */
export async function terminateTitleWorker(): Promise<void> {
  if (!workerPromise) return;
  const worker = await workerPromise;
  await worker.terminate();
  workerPromise = null;
}

let workerPromise: Promise<TesseractWorker> | null = null;

async function getTitleWorker(): Promise<TesseractWorker> {
  workerPromise ??= (async () => {
    const tess = (await import('tesseract.js')) as unknown as {
      createWorker: (lang: string) => Promise<TesseractWorker>;
    };
    const worker = await tess.createWorker('eng');
    await worker.setParameters({
      tessedit_char_whitelist:
        "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'-. &é",
    });
    return worker;
  })();
  return workerPromise;
}

/** Card title band as a fraction of the (rectified or plain) card crop. */
const BAND_TOP = 0.02;
const BAND_HEIGHT = 0.1;

/**
 * OCR the title band of a card crop (RGBA buffer). Returns the raw text
 * (empty string when unreadable).
 */
export async function readTitleBand(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
): Promise<string> {
  const top = Math.max(0, Math.round(height * BAND_TOP));
  const bandHeight = Math.max(8, Math.round(height * BAND_HEIGHT));
  if (top + bandHeight > height || width < 32) return '';

  const band = await sharp(Buffer.from(rgba.buffer, rgba.byteOffset, rgba.byteLength), {
    raw: { width, height, channels: 4 },
  })
    .extract({ left: 0, top, width, height: bandHeight })
    .resize(width * 3)
    .grayscale()
    .normalize()
    .png()
    .toBuffer();

  const worker = await getTitleWorker();
  try {
    const { data } = await worker.recognize(band);
    return data.text.replace(/\s+/g, ' ').trim();
  } catch {
    return '';
  }
}
