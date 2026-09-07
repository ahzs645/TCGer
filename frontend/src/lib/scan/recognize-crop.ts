import {
  ensureEmbeddingModel,
  computeEmbeddingFromCanvas,
  ensureCardFaceGate,
  scoreCardFaceGate,
  matchEmbeddingShardsTopK,
  type EmbeddingIndex,
} from "./embedding-matcher";
import type { BrowserVideoScanCandidate } from "./scan-types";

/** A model, index, calibrated threshold and rejection gate are always used together. */
export async function recognizeCrop(
  canvas: HTMLCanvasElement,
  indexes: EmbeddingIndex[],
): Promise<BrowserVideoScanCandidate[]> {
  const candidates: BrowserVideoScanCandidate[] = [];
  for (const index of indexes) {
    await ensureEmbeddingModel({
      model: index.model,
      dtype: index.dtype,
      encoder: index.encoder,
      modelUrl: index.modelUrl,
    });
    const embedding = await computeEmbeddingFromCanvas(canvas);
    if (!embedding) continue;
    const gate = await ensureCardFaceGate(index);
    if (index.gateUrl && !gate)
      throw new Error(
        "This model's rejection gate could not be loaded. Retry the model download.",
      );
    if (gate && scoreCardFaceGate(gate, embedding) < gate.threshold) continue;
    candidates.push(
      ...matchEmbeddingShardsTopK(embedding, [index], {
        topK: 5,
        proposalLabel: "reviewed-crop",
      }),
    );
  }
  return candidates.sort((a, b) => b.confidence - a.confidence).slice(0, 5);
}
