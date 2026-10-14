import type { EmbeddingIndex, EmbeddingIndexEntry } from "./embedding-matcher";
import type { BrowserVideoScanCandidate } from "./scan-types";
import type { TcgCode } from "@/types/card";
import type { ScannerPrintingMode } from "./scanner-options";

/**
 * Stable identity for the shared encoder behind one or more game shards.
 * Automatic mode computes a crop embedding once, so every searched shard
 * must use this exact contract. The catalog vectors and thresholds may remain
 * game-specific.
 */
export function embeddingModelKey(
  index: Pick<
    EmbeddingIndex,
    "model" | "dtype" | "encoder" | "dimension" | "modelUrl"
  >,
): string {
  return JSON.stringify({
    model: index.model,
    dtype: index.dtype,
    encoder: index.encoder,
    dimension: index.dimension,
    modelUrl: index.modelUrl,
  });
}

export function embeddingIndexesShareModel(
  indexes: readonly EmbeddingIndex[],
): boolean {
  const first = indexes[0];
  if (!first) return true;
  const key = embeddingModelKey(first);
  return indexes.every((index) => embeddingModelKey(index) === key);
}

// ---------- matching ----------

/** Map cosine similarity → integer distance (mirrors backend convention). */
function distanceFromSimilarity(similarity: number): number {
  return Math.round((1 - Math.max(0, Math.min(1, similarity))) * 1000);
}

export const DEFAULT_EMBEDDING_MATCH_THRESHOLDS = {
  /** Direct visible-name acceptance threshold for raw embedding matches. */
  minSimilarity: 0.72,
  /** Lower bound reserved for candidates promoted by independent verification. */
  minVerifiedSimilarity: 0.65,
  /** Strong top1-top2 separation required for the verified lower-similarity path. */
  minMargin: 0.08,
} as const;

export interface EmbeddingMatchOptions {
  topK?: number;
  tcgFilter?: TcgCode | "all";
  proposalLabel?: string;
  /** Min top-1 similarity to mark a raw embedding candidate as confident. */
  minSimilarity?: number;
  /** Lower similarity allowed only when independent verification can promote it. */
  minVerifiedSimilarity?: number;
  /** Min top1−top2 margin for optional verified lower-similarity acceptance. */
  minMargin?: number;
  /** Keep false for raw embedding; OCR/downstream verification promotes later. */
  allowVerifiedMarginAcceptance?: boolean;
  /** Optional explicit deck gallery. Thresholds remain unchanged and an empty
   * intersection returns no candidates rather than falling back to catalog. */
  allowedExternalIds?: ReadonlySet<string>;
}

export function embeddingEntryMatchesExternalIds(
  entry: EmbeddingIndexEntry,
  allowedExternalIds: ReadonlySet<string>,
): boolean {
  if (allowedExternalIds.size === 0) return false;
  const contains = (value: string | null | undefined) =>
    value ? allowedExternalIds.has(value.trim().toLowerCase()) : false;
  if (contains(entry.externalId) || contains(entry.exactPrintingId))
    return true;
  return (
    entry.printings?.some(
      (printing) =>
        contains(printing.externalId) || contains(printing.exactPrintingId),
    ) ?? false
  );
}

/** Build a tiny exact-search gallery for an explicitly selected deck. The
 * source index remains immutable/cached, and an empty intersection stays
 * empty so callers cannot silently fall back to the full catalog. */
export function restrictEmbeddingIndexToExternalIds(
  index: EmbeddingIndex,
  allowedExternalIds: ReadonlySet<string>,
): EmbeddingIndex {
  const normalized = new Set(
    [...allowedExternalIds]
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean),
  );
  const selectedRows: number[] = [];
  for (let row = 0; row < index.entries.length; row++) {
    if (embeddingEntryMatchesExternalIds(index.entries[row]!, normalized)) {
      selectedRows.push(row);
    }
  }
  const vectors = new Int8Array(selectedRows.length * index.dimension);
  const invNorms = new Float32Array(selectedRows.length);
  selectedRows.forEach((sourceRow, targetRow) => {
    const sourceOffset = sourceRow * index.dimension;
    vectors.set(
      index.vectors.subarray(sourceOffset, sourceOffset + index.dimension),
      targetRow * index.dimension,
    );
    invNorms[targetRow] = index.invNorms[sourceRow]!;
  });
  const entries = selectedRows.map((row) => index.entries[row]!);
  return {
    ...index,
    total: entries.length,
    printingTotal: entries.reduce(
      (sum, entry) => sum + Math.max(entry.printings?.length ?? 0, 1),
      0,
    ),
    entries,
    vectors,
    invNorms,
  };
}

/**
 * Brute-force int8 cosine top-K over the reference index.
 * The query must be L2-normalised (computeEmbeddingFromCanvas does this).
 */
export function matchEmbeddingTopK(
  query: Float32Array,
  index: EmbeddingIndex,
  options: EmbeddingMatchOptions = {},
): BrowserVideoScanCandidate[] {
  // Threshold defaults come from the index (the operating point calibrated to
  // its encoder); explicit options still win for sweeps/experiments. The ??
  // covers IndexedDB rows cached before thresholds existed on the type.
  const indexThresholds =
    index.thresholds ?? DEFAULT_EMBEDDING_MATCH_THRESHOLDS;
  const {
    topK = 20,
    tcgFilter,
    proposalLabel = "embedding",
    minSimilarity = indexThresholds.minSimilarity,
    minVerifiedSimilarity = indexThresholds.minVerifiedSimilarity,
    minMargin = indexThresholds.minMargin,
    allowVerifiedMarginAcceptance = false,
    allowedExternalIds,
  } = options;

  const { dimension, vectors, invNorms, entries, tcg } = index;
  if (query.length !== dimension) return [];
  if (tcgFilter && tcgFilter !== "all" && tcgFilter !== tcg) return [];

  // Top-K by similarity (small K → linear insertion is fine).
  const bestIdx: number[] = [];
  const bestSim: number[] = [];
  let worst = -Infinity;

  for (let i = 0; i < entries.length; i++) {
    if (
      allowedExternalIds &&
      !embeddingEntryMatchesExternalIds(entries[i]!, allowedExternalIds)
    ) {
      continue;
    }
    const inv = invNorms[i]!;
    if (inv === 0) continue;
    const base = i * dimension;
    let dot = 0;
    for (let k = 0; k < dimension; k++) dot += query[k]! * vectors[base + k]!;
    const sim = dot * inv;

    if (bestIdx.length < topK) {
      bestIdx.push(i);
      bestSim.push(sim);
      if (bestIdx.length === topK) worst = Math.min(...bestSim);
    } else if (sim > worst) {
      // replace current worst
      let wi = 0;
      for (let j = 1; j < bestSim.length; j++)
        if (bestSim[j]! < bestSim[wi]!) wi = j;
      bestIdx[wi] = i;
      bestSim[wi] = sim;
      worst = Math.min(...bestSim);
    }
  }

  // sort descending by similarity
  const order = bestIdx
    .map((idx, j) => ({ idx, sim: bestSim[j]! }))
    .sort((a, b) => b.sim - a.sim);

  const top1 = order[0]?.sim ?? 0;
  const top2 = order[1]?.sim ?? 0;
  const margin = order.length >= 2 ? top1 - top2 : 0;

  return order.map(({ idx, sim }, rank) => {
    const entry = entries[idx]!;
    const passesDirectThreshold = sim >= minSimilarity;
    const passesVerifiedMarginThreshold =
      allowVerifiedMarginAcceptance &&
      sim >= minVerifiedSimilarity &&
      margin >= minMargin;
    // Raw embedding never passes on margin alone; low-similarity matches need
    // independent verification to opt into the lower threshold.
    const confident =
      rank === 0 && (passesDirectThreshold || passesVerifiedMarginThreshold);
    const distance = distanceFromSimilarity(sim);
    const candidate: BrowserVideoScanCandidate = {
      externalId: entry.externalId,
      tcg,
      name: entry.name,
      setCode: entry.setCode,
      setName: entry.setName,
      rarity: entry.rarity,
      imageUrl: entry.imageUrl,
      confidence: Math.max(0, Math.min(1, sim)),
      distance,
      scoreDistance: distance,
      passedThreshold: confident,
      fullDistance: distance,
      titleDistance: null,
      footerDistance: null,
      proposalLabel,
      artworkSimilarity: sim,
      recognitionFamilyId: entry.recognitionFamilyId,
      exactPrintingId: entry.exactPrintingId,
      releaseDate: entry.releaseDate,
      printings: entry.printings,
    };
    return candidate;
  });
}

export function resolveEmbeddingPrintingCandidates(
  candidates: BrowserVideoScanCandidate[],
  mode: ScannerPrintingMode,
  verifiedExactPrintingId?: string | null,
): BrowserVideoScanCandidate[] {
  const primary = candidates[0];
  if (!primary) return candidates;
  const familyId = primary.recognitionFamilyId;
  const nestedFamily = (primary.printings ?? []).map((printing) => ({
    ...primary,
    externalId: printing.externalId,
    exactPrintingId: printing.exactPrintingId,
    setCode: printing.setCode,
    setName: printing.setName,
    rarity: printing.rarity,
    imageUrl: printing.imageUrl,
    releaseDate: printing.releaseDate,
    printings: undefined,
  }));
  const family = [...nestedFamily, ...candidates]
    .filter((candidate) =>
      familyId
        ? candidate.recognitionFamilyId === familyId
        : candidate.externalId === primary.externalId,
    )
    .filter(
      (candidate, index, rows) =>
        rows.findIndex(
          (row) =>
            (row.exactPrintingId ?? row.externalId) ===
            (candidate.exactPrintingId ?? candidate.externalId),
        ) === index,
    )
    .sort(
      (left, right) =>
        (right.releaseDate ?? "").localeCompare(left.releaseDate ?? "") ||
        (right.exactPrintingId ?? right.externalId).localeCompare(
          left.exactPrintingId ?? left.externalId,
        ),
    );

  const verified = verifiedExactPrintingId
    ? family.find(
        (candidate) =>
          (candidate.exactPrintingId ?? candidate.externalId) ===
          verifiedExactPrintingId,
      )
    : null;
  if (verified) {
    return promotePrinting(candidates, verified, "verified", false);
  }
  if (family.length <= 1) {
    return promotePrinting(
      candidates,
      family[0] ?? primary,
      "single_printing",
      false,
    );
  }
  if (mode === "exact_printing") {
    const familyIds = new Set(family.map((candidate) => candidate.externalId));
    return [
      ...family.map((candidate) => ({
        ...candidate,
        printingResolutionProvenance: "unresolved" as const,
        requiresPrintingChoice: true,
      })),
      ...candidates.filter((candidate) => !familyIds.has(candidate.externalId)),
    ];
  }
  return promotePrinting(candidates, family[0]!, "latest_fallback", false);
}

function promotePrinting(
  candidates: BrowserVideoScanCandidate[],
  selected: BrowserVideoScanCandidate,
  provenance: "verified" | "single_printing" | "latest_fallback",
  requiresPrintingChoice: boolean,
): BrowserVideoScanCandidate[] {
  const primary = candidates[0]!;
  const promoted = {
    ...selected,
    confidence: primary.confidence,
    distance: primary.distance,
    scoreDistance: primary.scoreDistance,
    passedThreshold: primary.passedThreshold,
    printingResolutionProvenance: provenance,
    requiresPrintingChoice,
  };
  return [
    promoted,
    ...candidates.filter(
      (candidate) => candidate.externalId !== selected.externalId,
    ),
  ];
}

/**
 * Search compatible per-game shards with one shared query embedding.
 *
 * Each shard keeps its own calibrated thresholds and within-game margin. The
 * returned candidates are then globally ranked, which makes the winning
 * candidate's `tcg` the automatic game route. A manually selected game simply
 * supplies one shard and follows the same code path.
 */
export function matchEmbeddingShardsTopK(
  query: Float32Array,
  indexes: readonly EmbeddingIndex[],
  options: EmbeddingMatchOptions = {},
): BrowserVideoScanCandidate[] {
  if (!embeddingIndexesShareModel(indexes)) return [];

  const topK = options.topK ?? 20;
  return indexes
    .flatMap((index) =>
      matchEmbeddingTopK(query, index, {
        ...options,
        topK,
        // Shard selection already scopes the game. In automatic mode the
        // caller passes "all", while a fixed mode loads exactly one shard.
        tcgFilter: index.tcg,
      }),
    )
    .sort((left, right) => right.confidence - left.confidence)
    .slice(0, topK);
}
