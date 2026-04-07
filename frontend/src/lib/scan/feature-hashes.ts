import type { CardScanHashEntry } from "@/lib/api/scan";
import type {
  CardFeatureHashes,
  SupportedTcg,
  TcgCode,
} from "./scan-types";
import { computeRGBHashFromCanvas } from "./rgb-hash";
import { clamp, createCanvas, getContext2d } from "./canvas-utils";

const FEATURE_REGION_SPECS: Record<
  SupportedTcg,
  Array<{
    name: "title" | "footer";
    left: number;
    top: number;
    width: number;
    height: number;
  }>
> = {
  magic: [
    { name: "title", left: 0.06, top: 0.03, width: 0.88, height: 0.09 },
    { name: "footer", left: 0.06, top: 0.88, width: 0.88, height: 0.08 },
  ],
  pokemon: [
    { name: "title", left: 0.06, top: 0.04, width: 0.88, height: 0.11 },
    { name: "footer", left: 0.06, top: 0.79, width: 0.88, height: 0.16 },
  ],
  yugioh: [
    { name: "title", left: 0.07, top: 0.04, width: 0.86, height: 0.09 },
    { name: "footer", left: 0.05, top: 0.8, width: 0.9, height: 0.16 },
  ],
};

export function computeFeatureHashesByTcg(
  canvas: HTMLCanvasElement,
  hashEntries: CardScanHashEntry[],
  tcgFilter?: TcgCode | "all",
): Partial<Record<SupportedTcg, CardFeatureHashes>> {
  const tcgs = new Set<SupportedTcg>();

  if (tcgFilter === "magic" || tcgFilter === "pokemon" || tcgFilter === "yugioh") {
    tcgs.add(tcgFilter);
  } else {
    for (const entry of hashEntries) {
      if (entry.tcg === "magic" || entry.tcg === "pokemon" || entry.tcg === "yugioh") {
        tcgs.add(entry.tcg);
      }
    }
  }

  const output: Partial<Record<SupportedTcg, CardFeatureHashes>> = {};

  for (const tcg of tcgs) {
    output[tcg] = computeCardFeatureHashes(tcg, canvas);
  }

  return output;
}

function computeCardFeatureHashes(
  tcg: SupportedTcg,
  canvas: HTMLCanvasElement,
): CardFeatureHashes {
  const hashes: CardFeatureHashes = {
    title: null,
    footer: null,
  };

  for (const region of FEATURE_REGION_SPECS[tcg]) {
    const regionCanvas = extractRegionCanvas(canvas, region);
    hashes[region.name] = computeRGBHashFromCanvas(regionCanvas);
  }

  return hashes;
}

function extractRegionCanvas(
  sourceCanvas: HTMLCanvasElement,
  region: {
    left: number;
    top: number;
    width: number;
    height: number;
  },
): HTMLCanvasElement {
  const left = clamp(
    Math.round(sourceCanvas.width * region.left),
    0,
    sourceCanvas.width - 1,
  );
  const top = clamp(
    Math.round(sourceCanvas.height * region.top),
    0,
    sourceCanvas.height - 1,
  );
  const width = clamp(
    Math.round(sourceCanvas.width * region.width),
    32,
    sourceCanvas.width - left,
  );
  const height = clamp(
    Math.round(sourceCanvas.height * region.height),
    32,
    sourceCanvas.height - top,
  );

  const canvas = createCanvas(width, height);
  const context = getContext2d(canvas);
  context.drawImage(sourceCanvas, left, top, width, height, 0, 0, width, height);
  return canvas;
}
