import { useCallback, useRef } from "react";

import {
  computeArtworkFingerprintFromCanvas,
  computeHSVHistogramFromCanvas,
  matchArtworkFingerprint,
  scanVideoFrameCanvasInBrowser,
  type ArtworkFingerprintEntry,
  type BrowserVideoScanCandidate,
  type BrowserVideoProposalMatch,
  type CardScanHashEntry,
} from "@/lib/scan/browser-video-matcher";
import {
  computeEmbeddingFromCanvas,
  ensureCardFaceGate,
  ensureEmbeddingModel,
  matchEmbeddingTopK,
  scoreCardFaceGate,
  type CardFaceGate,
  type EmbeddingIndex,
} from "@/lib/scan/embedding-matcher";
import { rectifyCardCrop } from "@/lib/scan/card-rectify";
import {
  assessCropSharpness,
  assessFrameMotion,
  DEFAULT_QUALITY_GATE,
} from "@/lib/scan/quality-gate";
import {
  ensureOcrWorker,
  fuseOcrWithShortlist,
  OcrVoteTracker,
  readFooterText,
} from "@/lib/scan/collector-ocr";
import {
  detectCards,
  ensureYoloModel,
  extractCardCrop,
  isYoloModelReady,
  type OBBDetection,
} from "@/lib/scan/yolo-detector";

import {
  DEFAULT_MAX_FRAMES,
  MAX_TIMELINE_ITEMS,
  type ScanFilter,
  type VideoScanFrameState,
  type VideoTimelineItem,
  type VideoTrack,
} from "./video-scan-types";
import { reconcileVideoTracks } from "./video-scan-tracks";
import {
  buildSampleTimestamps,
  drawVideoFrameToCanvas,
  ensureVideoMetadata,
  getTargetFrameLongSide,
  seekVideo,
  yieldToBrowser,
} from "./video-scan-video-utils";

/** Frame size for YOLO detection. */
const MODEL_FRAME_SIZE = 640;
/**
 * Frame size for recognition crops. Detection runs on the 640px frame, but
 * crops for embedding/OCR come from this higher-resolution capture of the same
 * frame — crop resolution was the dominant accuracy lever in the offline
 * benchmark (100% vs 85% committed-label precision on the Sinnoh video).
 */
const CROP_FRAME_SIZE = 1920;
const EMBEDDING_SHORTLIST_SIZE = 20;

export interface ProcessorCallbacks {
  onFrameState: (state: VideoScanFrameState) => void;
  onTracks: (tracks: VideoTrack[]) => void;
  onTimeline: (
    updater: (prev: VideoTimelineItem[]) => VideoTimelineItem[],
  ) => void;
  onProgress: (progress: { processed: number; total: number }) => void;
  onStatus: (status: string) => void;
  onMetadata: (meta: {
    duration: number;
    width: number;
    height: number;
  }) => void;
  onProcessing: (processing: boolean) => void;
  onError: (error: string) => void;
}

/**
 * Hook that encapsulates the two processing modes:
 * - Batch frame-by-frame scan with hash matching
 * - Live YOLO detection
 */
export function useVideoScanProcessor(callbacks: ProcessorCallbacks) {
  const stopRequestedRef = useRef(false);
  const trackStateRef = useRef<VideoTrack[]>([]);
  const nextTrackIdRef = useRef(1);
  /** Previous frame grayscale for the stillness gate (embedding mode). */
  const prevFrameGrayRef = useRef<Float32Array | null>(null);

  const resetTracking = useCallback(() => {
    trackStateRef.current = [];
    nextTrackIdRef.current = 1;
  }, []);

  const requestStop = useCallback(() => {
    stopRequestedRef.current = true;
  }, []);

  /**
   * Run a track update and push results to callbacks.
   */
  const updateTracks = useCallback(
    (
      proposalMatches: BrowserVideoProposalMatch[],
      timestampSeconds: number,
    ) => {
      const trackUpdate = reconcileVideoTracks(
        trackStateRef.current,
        proposalMatches,
        timestampSeconds,
        nextTrackIdRef.current,
      );
      trackStateRef.current = trackUpdate.tracks;
      nextTrackIdRef.current = trackUpdate.nextTrackId;
      callbacks.onTracks(trackUpdate.tracks);

      if (trackUpdate.timelineEntries.length) {
        callbacks.onTimeline((prev) =>
          [...trackUpdate.timelineEntries, ...prev].slice(
            0,
            MAX_TIMELINE_ITEMS,
          ),
        );
      }
    },
    [callbacks],
  );

  /**
   * Batch mode: seek frame-by-frame, run hash + artwork matching.
   */
  const processBatch = useCallback(
    async (params: {
      video: HTMLVideoElement;
      frameCanvas: HTMLCanvasElement;
      hashEntries: Awaited<ReturnType<any>>; // CardScanHashEntry[]
      artworkDb: ArtworkFingerprintEntry[] | undefined;
      scanFilter: ScanFilter;
      sampleFps: number;
      maxFrames: string;
    }) => {
      const {
        video,
        frameCanvas,
        hashEntries,
        artworkDb,
        scanFilter,
        sampleFps,
        maxFrames,
      } = params;

      stopRequestedRef.current = false;
      let processedFrames = 0;

      await ensureVideoMetadata(video);
      if (!Number.isFinite(video.duration) || video.duration <= 0) {
        throw new Error("Unable to read the video duration for this file.");
      }

      const timestamps = buildSampleTimestamps(
        video.duration,
        sampleFps,
        Number.parseInt(maxFrames, 10) || DEFAULT_MAX_FRAMES,
      );

      callbacks.onProgress({ processed: 0, total: timestamps.length });
      callbacks.onStatus(
        `Running ${timestamps.length} sampled frames against ${hashEntries.length.toLocaleString()} hashes at ${sampleFps.toFixed(1)} fps.`,
      );

      for (const [index, timestampSeconds] of timestamps.entries()) {
        if (stopRequestedRef.current) break;

        await seekVideo(video, timestampSeconds);
        const { width, height } = drawVideoFrameToCanvas(
          video,
          frameCanvas,
          getTargetFrameLongSide(sampleFps),
        );
        callbacks.onMetadata({ duration: video.duration, width, height });

        const nextFrameState: VideoScanFrameState = {
          timestampSeconds,
          ...scanVideoFrameCanvasInBrowser({
            frameCanvas,
            hashEntries,
            artworkDb,
            tcgFilter: scanFilter,
          }),
        };

        callbacks.onFrameState(nextFrameState);
        updateTracks(nextFrameState.proposalMatches, timestampSeconds);
        callbacks.onProgress({
          processed: index + 1,
          total: timestamps.length,
        });
        processedFrames = index + 1;

        await yieldToBrowser();
      }

      callbacks.onStatus(
        stopRequestedRef.current
          ? `Stopped after ${processedFrames.toLocaleString()} sampled frames.`
          : `Finished ${timestamps.length.toLocaleString()} sampled frames.`,
      );
    },
    [callbacks, updateTracks],
  );

  /**
   * Live YOLO detection mode: persistent rAF loop on the video.
   */
  const processLiveDetection = useCallback(
    async (params: {
      video: HTMLVideoElement;
      frameCanvas: HTMLCanvasElement;
      scanFilter: ScanFilter;
    }) => {
      const { video, frameCanvas, scanFilter } = params;

      stopRequestedRef.current = false;

      await ensureVideoMetadata(video);

      if (!isYoloModelReady()) {
        await ensureYoloModel((msg) => callbacks.onStatus(msg));
      }

      callbacks.onStatus(
        "YOLO detection active — play, pause, or scrub. Outlines update in real time.",
      );
      let processedFrames = 0;
      let skippedFrames = 0;
      let lastProcessedTime = -1;
      let processing = false;

      const processFrame = async () => {
        if (stopRequestedRef.current) {
          callbacks.onProcessing(false);
          const skipNote =
            skippedFrames > 0 ? ` (${skippedFrames} skipped)` : "";
          callbacks.onStatus(
            `YOLO detection stopped after ${processedFrames} frames${skipNote}.`,
          );
          return;
        }

        if (video.ended && !processing) {
          callbacks.onProcessing(false);
          const skipNote =
            skippedFrames > 0 ? ` (${skippedFrames} skipped)` : "";
          callbacks.onStatus(
            `YOLO detection finished — ${processedFrames} frames${skipNote}.`,
          );
          return;
        }

        const currentTime = video.currentTime;
        const timeChanged = Math.abs(currentTime - lastProcessedTime) > 0.01;
        if (timeChanged && processing) {
          skippedFrames++;
          requestAnimationFrame(() => void processFrame());
          return;
        }

        if (timeChanged) {
          processing = true;
          lastProcessedTime = currentTime;

          try {
            const { width, height } = drawVideoFrameToCanvas(
              video,
              frameCanvas,
              MODEL_FRAME_SIZE,
            );
            callbacks.onMetadata({ duration: video.duration, width, height });

            const detections = await detectCards(frameCanvas);

            const proposalMatches = detections.map((det) => {
              const spatialKey = `${Math.round(det.cx / 50)}-${Math.round(det.cy / 50)}`;
              const syntheticMatch: BrowserVideoScanCandidate = {
                externalId: `yolo-${spatialKey}`,
                tcg: scanFilter === "all" ? "pokemon" : scanFilter,
                name: `Detected card (${(det.confidence * 100).toFixed(0)}%)`,
                setCode: null,
                setName: null,
                rarity: null,
                imageUrl: null,
                confidence: det.confidence,
                distance: 0,
                scoreDistance: 0,
                passedThreshold: det.confidence >= 0.5,
                fullDistance: 0,
                titleDistance: null,
                footerDistance: null,
                proposalLabel: `yolo ${(det.confidence * 100).toFixed(0)}%`,
              };

              return {
                proposal: {
                  label: `yolo ${(det.confidence * 100).toFixed(0)}%`,
                  left: det.cx - det.width / 2,
                  top: det.cy - det.height / 2,
                  width: det.width,
                  height: det.height,
                },
                overlayQuad: det.quad,
                refinementMethod: "yolo-obb" as string | null,
                isClipped: false,
                bestMatch: syntheticMatch,
                candidates: [syntheticMatch],
              };
            });

            const nextFrameState: VideoScanFrameState = {
              timestampSeconds: currentTime,
              activeProposal: proposalMatches[0]?.proposal ?? null,
              bestMatch: proposalMatches[0]?.bestMatch ?? null,
              candidates: proposalMatches
                .map((pm) => pm.bestMatch!)
                .filter(Boolean),
              proposalMatches,
            };

            callbacks.onFrameState(nextFrameState);
            updateTracks(nextFrameState.proposalMatches, currentTime);

            processedFrames++;
            callbacks.onProgress({ processed: processedFrames, total: 0 });
          } catch (err) {
            callbacks.onError(
              err instanceof Error ? err.message : "YOLO detection failed.",
            );
            callbacks.onProcessing(false);
            processing = false;
            return;
          }
          processing = false;
        }

        requestAnimationFrame(() => void processFrame());
      };

      requestAnimationFrame(() => void processFrame());
    },
    [callbacks, updateTracks],
  );

  /**
   * YOLO + matching: detect cards with YOLO, crop & de-rotate,
   * then run artwork fingerprint + pHash matching to identify each card.
   * Runs as a live rAF loop like detection-only mode.
   */
  const processYoloWithMatching = useCallback(
    async (params: {
      video: HTMLVideoElement;
      frameCanvas: HTMLCanvasElement;
      hashEntries: CardScanHashEntry[];
      artworkDb: ArtworkFingerprintEntry[] | undefined;
      scanFilter: ScanFilter;
    }) => {
      const { video, frameCanvas, hashEntries, artworkDb, scanFilter } = params;

      stopRequestedRef.current = false;

      await ensureVideoMetadata(video);

      if (!isYoloModelReady()) {
        await ensureYoloModel((msg) => callbacks.onStatus(msg));
      }

      callbacks.onStatus(
        "YOLO + matching active — play, pause, or scrub. Cards are identified in real time.",
      );
      let processedFrames = 0;
      let skippedFrames = 0;
      let lastProcessedTime = -1;
      let processing = false; // busy flag — skip frames while matching

      const processFrame = async () => {
        if (stopRequestedRef.current) {
          callbacks.onProcessing(false);
          const skipNote =
            skippedFrames > 0 ? ` (${skippedFrames} skipped)` : "";
          callbacks.onStatus(
            `YOLO + matching stopped after ${processedFrames} frames${skipNote}.`,
          );
          return;
        }

        if (video.ended && !processing) {
          callbacks.onProcessing(false);
          const skipNote =
            skippedFrames > 0 ? ` (${skippedFrames} skipped)` : "";
          callbacks.onStatus(
            `YOLO + matching finished — ${processedFrames} frames${skipNote}.`,
          );
          return;
        }

        const currentTime = video.currentTime;
        const timeChanged = Math.abs(currentTime - lastProcessedTime) > 0.01;

        // Skip this frame if we're still matching the previous one
        if (timeChanged && processing) {
          skippedFrames++;
          requestAnimationFrame(() => void processFrame());
          return;
        }

        if (timeChanged) {
          processing = true;
          lastProcessedTime = currentTime;

          const { width, height } = drawVideoFrameToCanvas(
            video,
            frameCanvas,
            MODEL_FRAME_SIZE,
          );
          callbacks.onMetadata({ duration: video.duration, width, height });

          // 1. YOLO detection
          try {
            const detections = await detectCards(frameCanvas);

            // 2. For each detection, crop & match
            const proposalMatches = detections.map((det) =>
              matchDetection(
                det,
                frameCanvas,
                hashEntries,
                artworkDb,
                scanFilter,
              ),
            );

            const bestPm = proposalMatches[0];
            const nextFrameState: VideoScanFrameState = {
              timestampSeconds: currentTime,
              activeProposal: bestPm?.proposal ?? null,
              bestMatch: bestPm?.bestMatch ?? null,
              candidates: proposalMatches
                .map((pm) => pm.bestMatch!)
                .filter(Boolean),
              proposalMatches,
            };

            callbacks.onFrameState(nextFrameState);
            updateTracks(nextFrameState.proposalMatches, currentTime);

            processedFrames++;
            callbacks.onProgress({ processed: processedFrames, total: 0 });
          } catch (err) {
            callbacks.onError(
              err instanceof Error ? err.message : "YOLO matching failed.",
            );
            callbacks.onProcessing(false);
            processing = false;
            return;
          }
          processing = false;
        }

        requestAnimationFrame(() => void processFrame());
      };

      requestAnimationFrame(() => void processFrame());
    },
    [callbacks, updateTracks],
  );

  /**
   * YOLO + client-side embedding: detect cards with YOLO, crop & de-rotate,
   * embed each crop with the on-device CLIP model, and match against the
   * client-side embedding index (brute-force int8 cosine top-K). Fully
   * server-free. Embedding inference is async, so frames are skipped while a
   * previous frame is still being identified.
   */
  const processYoloWithEmbedding = useCallback(
    async (params: {
      video: HTMLVideoElement;
      frameCanvas: HTMLCanvasElement;
      embeddingIndex: EmbeddingIndex;
      scanFilter: ScanFilter;
    }) => {
      const { video, frameCanvas, embeddingIndex, scanFilter } = params;

      stopRequestedRef.current = false;

      await ensureVideoMetadata(video);

      if (!isYoloModelReady()) {
        await ensureYoloModel((msg) => callbacks.onStatus(msg));
      }
      await ensureEmbeddingModel({
        model: embeddingIndex.model,
        dtype: embeddingIndex.dtype,
        encoder: embeddingIndex.encoder,
        onStatus: (msg) => callbacks.onStatus(msg),
      });
      // Warm the OCR worker in the background; it's only invoked when the
      // embedding shortlist is ambiguous (likely twins).
      void ensureOcrWorker();
      const ocrTrackers = new Map<string, OcrVoteTracker>();
      const embedAveragers = new Map<string, EmbeddingTrackAverager>();
      // Open-set rejection gate (null = artifact missing or encoder mismatch;
      // scanning proceeds ungated).
      const cardFaceGate = await ensureCardFaceGate(embeddingIndex);

      callbacks.onStatus(
        "YOLO + embedding active — play, pause, or scrub. Cards are identified on-device.",
      );
      prevFrameGrayRef.current = null;
      // Full-resolution capture of the same frame, taken at the same instant
      // as the detection frame (the video advances during async detection, so
      // cropping from the live element would misalign with the boxes).
      const cropFrameCanvas = document.createElement("canvas");
      let processedFrames = 0;
      let skippedFrames = 0;
      let blurredFrames = 0;
      let movingFrames = 0;
      let lastProcessedTime = -1;
      let processing = false;

      const processFrame = async () => {
        if (stopRequestedRef.current) {
          callbacks.onProcessing(false);
          const notes: string[] = [];
          if (skippedFrames > 0) notes.push(`${skippedFrames} busy`);
          if (movingFrames > 0) notes.push(`${movingFrames} moving`);
          if (blurredFrames > 0) notes.push(`${blurredFrames} blurry`);
          const skipNote = notes.length ? ` (${notes.join(", ")} skipped)` : "";
          callbacks.onStatus(
            `YOLO + embedding stopped after ${processedFrames} frames${skipNote}.`,
          );
          return;
        }

        if (video.ended && !processing) {
          callbacks.onProcessing(false);
          const notes: string[] = [];
          if (skippedFrames > 0) notes.push(`${skippedFrames} busy`);
          if (movingFrames > 0) notes.push(`${movingFrames} moving`);
          if (blurredFrames > 0) notes.push(`${blurredFrames} blurry`);
          const skipNote = notes.length ? ` (${notes.join(", ")} skipped)` : "";
          callbacks.onStatus(
            `YOLO + embedding finished — ${processedFrames} frames${skipNote}.`,
          );
          return;
        }

        const currentTime = video.currentTime;
        const timeChanged = Math.abs(currentTime - lastProcessedTime) > 0.01;

        if (timeChanged && processing) {
          skippedFrames++;
          requestAnimationFrame(() => void processFrame());
          return;
        }

        if (timeChanged) {
          processing = true;
          lastProcessedTime = currentTime;

          const { width, height } = drawVideoFrameToCanvas(
            video,
            frameCanvas,
            MODEL_FRAME_SIZE,
          );
          drawVideoFrameToCanvas(video, cropFrameCanvas, CROP_FRAME_SIZE);
          const cropScale = cropFrameCanvas.width / frameCanvas.width;
          callbacks.onMetadata({ duration: video.duration, width, height });

          try {
            const detections = await detectCards(frameCanvas);

            // Stillness gate: if the camera/card is moving, skip embedding this
            // frame and just show outlines — keep accumulating until it settles.
            const motion = assessFrameMotion(
              frameCanvas,
              prevFrameGrayRef.current,
              DEFAULT_QUALITY_GATE,
            );
            prevFrameGrayRef.current = motion.gray;
            if (!motion.still) movingFrames++;

            const proposalMatches: BrowserVideoProposalMatch[] = [];
            for (const det of detections) {
              const ocrTracker = getOcrTrackerForDetection(det, ocrTrackers);
              const embedAverager = getEmbedAveragerForDetection(
                det,
                embedAveragers,
              );
              const pm = await matchDetectionEmbedding(
                det,
                cropFrameCanvas,
                cropScale,
                embeddingIndex,
                scanFilter,
                motion.still,
                ocrTracker,
                cardFaceGate,
                embedAverager,
              );
              if (pm.bestMatch?.proposalLabel === "yolo-blur") blurredFrames++;
              proposalMatches.push(pm);
            }

            const bestPm = proposalMatches[0];
            const nextFrameState: VideoScanFrameState = {
              timestampSeconds: currentTime,
              activeProposal: bestPm?.proposal ?? null,
              bestMatch: bestPm?.bestMatch ?? null,
              candidates: proposalMatches
                .map((pm) => pm.bestMatch!)
                .filter(Boolean),
              proposalMatches,
            };

            callbacks.onFrameState(nextFrameState);
            updateTracks(nextFrameState.proposalMatches, currentTime);

            processedFrames++;
            callbacks.onProgress({ processed: processedFrames, total: 0 });
          } catch (err) {
            callbacks.onError(
              err instanceof Error ? err.message : "YOLO embedding failed.",
            );
            callbacks.onProcessing(false);
            processing = false;
            return;
          }
          processing = false;
        }

        requestAnimationFrame(() => void processFrame());
      };

      requestAnimationFrame(() => void processFrame());
    },
    [callbacks, updateTracks],
  );

  return {
    processBatch,
    processLiveDetection,
    processYoloWithMatching,
    processYoloWithEmbedding,
    requestStop,
    resetTracking,
  };
}

// ---------- matching helper ----------

/** Top-N artwork candidates to pre-filter pHash against. */
const ARTWORK_TOP_N = 50;
/** Minimum artwork similarity to trust the result. */
const ARTWORK_MIN_SIM = 0.9;

/**
 * Given a YOLO detection, extract the de-rotated card crop and run
 * artwork fingerprint + pHash matching to identify the card.
 */
function matchDetection(
  det: OBBDetection,
  frameCanvas: HTMLCanvasElement,
  hashEntries: CardScanHashEntry[],
  artworkDb: ArtworkFingerprintEntry[] | undefined,
  scanFilter: ScanFilter,
): BrowserVideoProposalMatch {
  const cropCanvas = extractCardCrop(frameCanvas, det);
  const tcg = scanFilter === "all" ? "pokemon" : scanFilter;

  let bestMatch: BrowserVideoScanCandidate | null = null;
  let candidates: BrowserVideoScanCandidate[] = [];

  // Try artwork fingerprint + HSV histogram matching (primary signal)
  if (artworkDb && artworkDb.length > 0) {
    const tcgKey = tcg as "pokemon" | "magic" | "yugioh";
    const fp = computeArtworkFingerprintFromCanvas(cropCanvas, tcgKey);
    const hsvHist = computeHSVHistogramFromCanvas(cropCanvas, tcgKey);
    const artworkMatches = matchArtworkFingerprint(
      fp,
      artworkDb,
      ARTWORK_TOP_N,
      scanFilter,
      hsvHist,
    );

    if (
      artworkMatches.length > 0 &&
      artworkMatches[0]!.similarity >= ARTWORK_MIN_SIM
    ) {
      const top = artworkMatches[0]!;
      const entry = hashEntries.find(
        (e) => e.externalId === top.externalId && e.tcg === top.tcg,
      );

      bestMatch = {
        externalId: top.externalId,
        tcg: top.tcg,
        name: top.name,
        setCode: top.setCode,
        setName: entry?.setName ?? null,
        rarity: entry?.rarity ?? null,
        imageUrl: entry?.imageUrl ?? null,
        confidence: top.similarity,
        distance: Math.round((1 - top.similarity) * 240),
        scoreDistance: Math.round((1 - top.similarity) * 240),
        passedThreshold: true,
        fullDistance: Math.round((1 - top.similarity) * 240),
        titleDistance: null,
        footerDistance: null,
        proposalLabel: `yolo+artwork`,
        artworkSimilarity: top.similarity,
      };

      candidates = artworkMatches.slice(0, 5).map((m) => {
        const e = hashEntries.find(
          (h) => h.externalId === m.externalId && h.tcg === m.tcg,
        );
        return {
          externalId: m.externalId,
          tcg: m.tcg,
          name: m.name,
          setCode: m.setCode,
          setName: e?.setName ?? null,
          rarity: e?.rarity ?? null,
          imageUrl: e?.imageUrl ?? null,
          confidence: m.similarity,
          distance: Math.round((1 - m.similarity) * 240),
          scoreDistance: Math.round((1 - m.similarity) * 240),
          passedThreshold: m.similarity >= ARTWORK_MIN_SIM,
          fullDistance: Math.round((1 - m.similarity) * 240),
          titleDistance: null,
          footerDistance: null,
          proposalLabel: `yolo+artwork`,
          artworkSimilarity: m.similarity,
        };
      });
    }
  }

  // DCT pHash fallback intentionally dropped from the matching path: it gives
  // effectively random distances on handheld/compressed crops (verified — see
  // docs/client-side-scanner-options.md), producing confidently-wrong guesses.
  // Artwork color-grid + HSV above is the matcher/offline fallback; if it isn't
  // confident we show the detection unidentified rather than guess.

  // If matching didn't identify the card, still show the YOLO detection.
  // The outline should always appear — only the card name is uncertain.
  if (!bestMatch) {
    const spatialKey = `${Math.round(det.cx / 50)}-${Math.round(det.cy / 50)}`;
    bestMatch = {
      externalId: `yolo-${spatialKey}`,
      tcg: scanFilter === "all" ? "pokemon" : scanFilter,
      name: `Detected card`,
      setCode: null,
      setName: null,
      rarity: null,
      imageUrl: null,
      confidence: det.confidence,
      distance: 0,
      scoreDistance: 0,
      passedThreshold: det.confidence >= 0.5,
      fullDistance: 0,
      titleDistance: null,
      footerDistance: null,
      proposalLabel: "yolo",
    };
  }

  return {
    proposal: {
      label: bestMatch.proposalLabel,
      left: det.cx - det.width / 2,
      top: det.cy - det.height / 2,
      width: det.width,
      height: det.height,
    },
    overlayQuad: det.quad,
    refinementMethod: "yolo-obb",
    isClipped: false,
    bestMatch,
    candidates,
  };
}

function getOcrTrackerForDetection(
  det: OBBDetection,
  trackers: Map<string, OcrVoteTracker>,
): OcrVoteTracker {
  const key = `${Math.round(det.cx / 80)}:${Math.round(det.cy / 80)}`;
  let tracker = trackers.get(key);
  if (!tracker) {
    tracker = new OcrVoteTracker();
    trackers.set(key, tracker);
  }
  return tracker;
}

/**
 * Track-level embedding averaging: the mean of a track's recent sharp-frame
 * embeddings denoises per-frame glare/tilt (measured offline: Energy
 * Retrieval rank 23 -> 1, Morpeko V rank 239 -> 2). The window is short so a
 * card swapped in place flushes out within a couple of frames; the quality
 * gate upstream keeps transition frames from ever entering.
 */
const EMBED_TRACK_WINDOW = 5;

class EmbeddingTrackAverager {
  private recent: Float32Array[] = [];

  add(embedding: Float32Array): void {
    this.recent.push(embedding);
    if (this.recent.length > EMBED_TRACK_WINDOW) this.recent.shift();
  }

  size(): number {
    return this.recent.length;
  }

  /** L2-normalized mean of the window; null when empty. */
  mean(): Float32Array | null {
    if (this.recent.length === 0) return null;
    const m = new Float32Array(this.recent[0]!.length);
    for (const e of this.recent) {
      for (let i = 0; i < m.length; i++) m[i]! += e[i]!;
    }
    let sq = 0;
    for (const v of m) sq += v * v;
    const norm = Math.sqrt(sq);
    if (norm < 1e-8) return null;
    for (let i = 0; i < m.length; i++) m[i]! /= norm;
    return m;
  }
}

function getEmbedAveragerForDetection(
  det: OBBDetection,
  averagers: Map<string, EmbeddingTrackAverager>,
): EmbeddingTrackAverager {
  const key = `${Math.round(det.cx / 80)}:${Math.round(det.cy / 80)}`;
  let averager = averagers.get(key);
  if (!averager) {
    averager = new EmbeddingTrackAverager();
    averagers.set(key, averager);
  }
  return averager;
}

/**
 * Rescue cascade: when the plain crop fails the acceptance threshold, refine
 * the card quad inside a padded region and embed the perspective-flattened
 * crop instead. Blanket rectification measurably degrades good crops, so this
 * runs ONLY on failures (offline: +2 recovered cards, zero lost).
 */
async function rescueWithRectify(
  det: OBBDetection,
  cropFrameCanvas: HTMLCanvasElement,
  cropScale: number,
  embeddingIndex: EmbeddingIndex,
  scanFilter: ScanFilter,
  cardFaceGate: CardFaceGate | null,
): Promise<BrowserVideoScanCandidate[] | null> {
  // The quad fit assumes near-axis card edges; heavily rotated boxes would
  // fail it anyway, so skip the extra work.
  if (Math.abs(det.angle) > (20 * Math.PI) / 180) return null;

  const cx = det.cx * cropScale;
  const cy = det.cy * cropScale;
  const w = det.width * cropScale;
  const h = det.height * cropScale;
  const pad = 0.1;
  const left = Math.max(0, Math.round(cx - w / 2 - w * pad));
  const top = Math.max(0, Math.round(cy - h / 2 - h * pad));
  const right = Math.min(cropFrameCanvas.width, Math.round(cx + w / 2 + w * pad));
  const bottom = Math.min(cropFrameCanvas.height, Math.round(cy + h / 2 + h * pad));
  if (right - left < 40 || bottom - top < 40) return null;

  const ctx = cropFrameCanvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  const region = ctx.getImageData(left, top, right - left, bottom - top);

  const rectified = rectifyCardCrop(
    { data: region.data, width: region.width, height: region.height },
    {
      left: cx - w / 2 - left,
      top: cy - h / 2 - top,
      right: cx + w / 2 - left,
      bottom: cy + h / 2 - top,
    },
  );
  if (rectified.method !== "quad") return null;

  const warpedCanvas = document.createElement("canvas");
  warpedCanvas.width = rectified.image.width;
  warpedCanvas.height = rectified.image.height;
  const warpedCtx = warpedCanvas.getContext("2d");
  if (!warpedCtx) return null;
  warpedCtx.putImageData(
    new ImageData(
      rectified.image.data as Uint8ClampedArray<ArrayBuffer>,
      rectified.image.width,
      rectified.image.height,
    ),
    0,
    0,
  );

  const embedding = await computeEmbeddingFromCanvas(warpedCanvas);
  if (!embedding) return null;
  if (
    cardFaceGate &&
    scoreCardFaceGate(cardFaceGate, embedding) < cardFaceGate.threshold
  ) {
    return null;
  }
  return matchEmbeddingTopK(embedding, embeddingIndex, {
    topK: EMBEDDING_SHORTLIST_SIZE,
    tcgFilter: scanFilter,
    proposalLabel: "yolo+embedding+rectified",
  });
}

/**
 * Given a YOLO detection, extract the de-rotated card crop, embed it with the
 * on-device CLIP model, and brute-force int8 cosine top-K against the
 * client-side embedding index. The embedding produces a shortlist only;
 * near-identical cards are disambiguated downstream by collector-number OCR.
 */
/** Run the collector-number OCR tiebreaker only when the embedding top-2 are
 *  this close (ambiguous — likely twins / same-art reprints). */
const OCR_MARGIN_THRESHOLD = 0.1;

async function matchDetectionEmbedding(
  det: OBBDetection,
  cropFrameCanvas: HTMLCanvasElement,
  cropScale: number,
  embeddingIndex: EmbeddingIndex,
  scanFilter: ScanFilter,
  frameStill: boolean,
  ocrTracker: OcrVoteTracker | null,
  cardFaceGate: CardFaceGate | null,
  embedAverager: EmbeddingTrackAverager | null,
): Promise<BrowserVideoProposalMatch> {
  // Crop at source resolution (detection coords are in 640px-frame space).
  // The sharpness gate downsamples to 96px internally, so its calibration is
  // unaffected by the higher-resolution crop.
  const cropCanvas = extractCardCrop(cropFrameCanvas, det, cropScale);

  let bestMatch: BrowserVideoScanCandidate | null = null;
  let candidates: BrowserVideoScanCandidate[] = [];

  // Quality gate: only embed sharp crops from still frames. Blurry/moving
  // frames embed poorly (the backbone's worst case), so skip them and let the
  // next frame try — multi-frame accumulation does the rest.
  let skipLabel: string | null = null;
  if (!frameStill) {
    skipLabel = "yolo-motion";
  } else if (!assessCropSharpness(cropCanvas, DEFAULT_QUALITY_GATE).sharp) {
    skipLabel = "yolo-blur";
  }

  if (!skipLabel) {
    const embedding = await computeEmbeddingFromCanvas(cropCanvas);
    if (
      embedding &&
      cardFaceGate &&
      scoreCardFaceGate(cardFaceGate, embedding) < cardFaceGate.threshold
    ) {
      // Open-set rejection: this crop is a pack/back/hand/bad crop — matching
      // it against the index would just return the nearest wrong card.
      skipLabel = "yolo-nonface";
    } else if (embedding) {
      // Track-level averaging: query with the mean of this track's recent
      // sharp-frame embeddings once two or more have accumulated.
      embedAverager?.add(embedding);
      const query =
        embedAverager && embedAverager.size() >= 2
          ? (embedAverager.mean() ?? embedding)
          : embedding;
      candidates = matchEmbeddingTopK(query, embeddingIndex, {
        topK: EMBEDDING_SHORTLIST_SIZE,
        tcgFilter: scanFilter,
        proposalLabel: "yolo+embedding",
      });

      // Rescue cascade: below-threshold plain result -> try the rectified
      // (perspective-flattened) crop and keep whichever scores higher.
      if (candidates[0]?.passedThreshold !== true) {
        const rescue = await rescueWithRectify(
          det,
          cropFrameCanvas,
          cropScale,
          embeddingIndex,
          scanFilter,
          cardFaceGate,
        );
        if (
          rescue &&
          (rescue[0]?.confidence ?? 0) > (candidates[0]?.confidence ?? 0)
        ) {
          candidates = rescue;
        }
      }

      // Tiebreaker: when the top-2 are close (twins), read the footer collector
      // number and intersect it with the shortlist's known numbers, voting
      // across frames. The embedding alone can't split same-art reprints.
      const margin =
        candidates.length >= 2
          ? candidates[0]!.confidence - candidates[1]!.confidence
          : 1;
      if (
        ocrTracker &&
        candidates.length >= 2 &&
        margin < OCR_MARGIN_THRESHOLD
      ) {
        const tcg = scanFilter === "all" ? "pokemon" : scanFilter;
        try {
          const reading = await readFooterText(cropCanvas, tcg);
          ocrTracker.add(reading);
          const fusion = fuseOcrWithShortlist(
            candidates,
            ocrTracker.consensus(),
            tcg,
          );
          if (fusion.matched) candidates = fusion.candidates;
        } catch {
          // OCR is best-effort; fall back to the embedding ranking.
        }
      }

      if (candidates.length > 0 && candidates[0]!.passedThreshold) {
        bestMatch = candidates[0]!;
      }
    }
  }

  // If gated or unidentified, still show the YOLO detection outline (the card
  // location is certain; only the identity is deferred to a better frame).
  if (!bestMatch) {
    const spatialKey = `${Math.round(det.cx / 50)}-${Math.round(det.cy / 50)}`;
    bestMatch = {
      externalId: `yolo-${spatialKey}`,
      tcg: scanFilter === "all" ? "pokemon" : scanFilter,
      name: `Detected card`,
      setCode: null,
      setName: null,
      rarity: null,
      imageUrl: null,
      confidence: det.confidence,
      distance: 0,
      scoreDistance: 0,
      passedThreshold: det.confidence >= 0.5,
      fullDistance: 0,
      titleDistance: null,
      footerDistance: null,
      proposalLabel: skipLabel ?? "yolo",
    };
  }

  return {
    proposal: {
      label: bestMatch.proposalLabel,
      left: det.cx - det.width / 2,
      top: det.cy - det.height / 2,
      width: det.width,
      height: det.height,
    },
    overlayQuad: det.quad,
    refinementMethod: "yolo-obb",
    isClipped: false,
    bestMatch,
    candidates,
  };
}
