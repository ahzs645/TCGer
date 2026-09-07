import type { VideoQuad } from "./scan-types";
import type { CardScanMatch } from "@/lib/api/scan";

export interface ScanRegion {
  id: string;
  quad: VideoQuad;
  candidates: CardScanMatch[];
  selected: number;
  confirmed: boolean;
  included: boolean;
  saved?: boolean;
  error?: string;
}

export function gridQuads(
  width: number,
  height: number,
  rows = 3,
  columns = 3,
): VideoQuad[] {
  return Array.from({ length: rows * columns }, (_, index) => {
    const x = index % columns,
      y = Math.floor(index / columns);
    const left = ((x + 0.08) * width) / columns,
      right = ((x + 0.92) * width) / columns;
    const top = ((y + 0.04) * height) / rows,
      bottom = ((y + 0.96) * height) / rows;
    return [
      { x: left, y: top },
      { x: right, y: top },
      { x: right, y: bottom },
      { x: left, y: bottom },
    ];
  });
}

export function validQuad(quad: VideoQuad): boolean {
  const cross = quad.map((a, i) => {
    const b = quad[(i + 1) % 4]!,
      c = quad[(i + 2) % 4]!;
    return (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
  });
  return (
    quad.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y)) &&
    cross.every((value) => value > 1)
  );
}

export function scanCurrencyTotals(
  quotes: Array<{ price: number; currency: string }>,
): Record<string, number> {
  return quotes.reduce<Record<string, number>>((totals, quote) => {
    if (Number.isFinite(quote.price))
      totals[quote.currency] = (totals[quote.currency] ?? 0) + quote.price;
    return totals;
  }, {});
}

export class ScanConsensus {
  private previous: string | null = null;
  private accepted: string | null = null;
  observe(candidate: CardScanMatch | null): boolean {
    if (!candidate) {
      this.previous = null;
      this.accepted = null;
      return false;
    }
    const key = `${candidate.tcg}:${candidate.externalId}`;
    const stable = this.previous === key && this.accepted !== key;
    this.previous = key;
    if (stable) this.accepted = key;
    return stable;
  }
  nextCard() {
    this.previous = null;
    this.accepted = null;
  }
}
