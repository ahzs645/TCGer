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
  ensureEmbeddingModel,
  matchEmbeddingTopK,
  type EmbeddingIndex,
} from "@/lib/scan/embedding-matcher";
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
      let lastProcessedTime = -1;

      const processFrame = () => {
        if (stopRequestedRef.current) {
          callbacks.onProcessing(false);
          callbacks.onStatus(
            `YOLO detection stopped after ${processedFrames} frames.`,
          );
          return;
        }

        if (video.ended) {
          callbacks.onProcessing(false);
          callbacks.onStatus(
            `YOLO detection finished — ${processedFrames} frames processed.`,
          );
          return;
        }

        const currentTime = video.currentTime;
        if (Math.abs(currentTime - lastProcessedTime) > 0.01) {
          lastProcessedTime = currentTime;

          const { width, height } = drawVideoFrameToCanvas(
            video,
            frameCanvas,
            MODEL_FRAME_SIZE,
          );
          callbacks.onMetadata({ duration: video.duration, width, height });

          const detections = detectCards(frameCanvas);

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
        }

        requestAnimationFrame(processFrame);
      };

      requestAnimationFrame(processFrame);
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
      const { video, frameCanvas, hashEntries, artworkDb, scanFilter } =
        params;

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

      const processFrame = () => {
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
        const timeChanged =
          Math.abs(currentTime - lastProcessedTime) > 0.01;

        // Skip this frame if we're still matching the previous one
        if (timeChanged && processing) {
          skippedFrames++;
          requestAnimationFrame(processFrame);
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
          const detections = detectCards(frameCanvas);

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
          processing = false;
        }

        requestAnimationFrame(processFrame);
      };

      requestAnimationFrame(processFrame);
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
      const ocrTracker = new OcrVoteTracker();

      callbacks.onStatus(
        "YOLO + embedding active — play, pause, or scrub. Cards are identified on-device.",
      );
      prevFrameGrayRef.current = null;
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
          callbacks.onMetadata({ duration: video.duration, width, height });

          const detections = detectCards(frameCanvas);

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
            const pm = await matchDetectionEmbedding(
              det,
              frameCanvas,
              embeddingIndex,
              scanFilter,
              motion.still,
              ocrTracker,
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
const ARTWORK_MIN_SIM = 0.90;

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

    if (artworkMatches.length > 0 && artworkMatches[0]!.similarity >= ARTWORK_MIN_SIM) {
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
  frameCanvas: HTMLCanvasElement,
  embeddingIndex: EmbeddingIndex,
  scanFilter: ScanFilter,
  frameStill: boolean,
  ocrTracker: OcrVoteTracker | null,
): Promise<BrowserVideoProposalMatch> {
  const cropCanvas = extractCardCrop(frameCanvas, det);

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
    if (embedding) {
      candidates = matchEmbeddingTopK(embedding, embeddingIndex, {
        topK: 5,
        tcgFilter: scanFilter,
        proposalLabel: "yolo+embedding",
      });

      // Tiebreaker: when the top-2 are close (twins), read the footer collector
      // number and intersect it with the shortlist's known numbers, voting
      // across frames. The embedding alone can't split same-art reprints.
      const margin =
        candidates.length >= 2
          ? candidates[0]!.confidence - candidates[1]!.confidence
          : 1;
      if (ocrTracker && candidates.length >= 2 && margin < OCR_MARGIN_THRESHOLD) {
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

      if (candidates.length > 0) {
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

