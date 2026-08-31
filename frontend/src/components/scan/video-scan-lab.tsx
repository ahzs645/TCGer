"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { Film } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useAuthStore } from "@/stores/auth";
import { useGameFilterStore } from "@/stores/game-filter";
import { getDecks, type DeckResponse } from "@/lib/api/decks";
import { restrictEmbeddingIndexToExternalIds } from "@/lib/scan/embedding-matcher";
import { isSupportedScannerTcg } from "@/lib/scan/scan-types";
import {
  normalizeScannerPrintingMode,
  readScannerOcrEnabled,
  SCANNER_PRINTING_MODE_STORAGE_KEY,
  type ScannerPrintingMode,
} from "@/lib/scan/scanner-options";

import {
  MIN_TRACK_STABLE_FRAMES,
  type ScanFilter,
  type VideoScanFrameState,
  type VideoScanProgress,
  type VideoTimelineItem,
  type VideoTrack,
  type VideoViewportRect,
} from "./video-scan-types";
import { useVideoScanData } from "./use-video-scan-data";
import { useVideoScanProcessor } from "./use-video-scan-processor";
import {
  buildTrackOverlayItems,
  computeContainedVideoRect,
} from "./video-scan-overlay";
import {
  clampAnalysisInterval,
  DEFAULT_ANALYSIS_INTERVAL_MS,
} from "./video-scan-sampling";
import {
  ActiveTracksPanel,
  ScanControlsSidebar,
  TimelinePanel,
  VideoPlayerWithOverlay,
} from "./video-scan-panels";

import { useShallow } from "zustand/react/shallow";

const subscribeToHydration = () => () => undefined;

export function VideoScanLab() {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const frameCanvasRef = useRef<HTMLCanvasElement | null>(null);

  const { token, isAuthenticated } = useAuthStore(
    useShallow((s) => ({
      token: s.token,
      isAuthenticated: s.isAuthenticated,
    })),
  );
  const selectedGame = useGameFilterStore((s) => s.selectedGame);

  const mounted = useSyncExternalStore(
    subscribeToHydration,
    () => true,
    () => false,
  );

  // ---------- state ----------

  const [scanFilter, setScanFilter] = useState<ScanFilter>(
    selectedGame === "all"
      ? "pokemon"
      : isSupportedScannerTcg(selectedGame)
        ? selectedGame
        : "all",
  );
  const [detectionOnly, setDetectionOnly] = useState(false);
  // Default to the on-device DINOv2 embedding model: fully client-side, no
  // sign-in, and the highest-accuracy path. Users can switch to the
  // hash/artwork matcher or detection-only below.
  const [embeddingMode, setEmbeddingMode] = useState(true);
  const [printingMode, setPrintingMode] =
    useState<ScannerPrintingMode>("quick_latest");
  const [analysisIntervalMs, setAnalysisIntervalMs] = useState(
    DEFAULT_ANALYSIS_INTERVAL_MS,
  );
  const [yugiohDecks, setYugiohDecks] = useState<DeckResponse[]>([]);
  const [selectedDeckId, setSelectedDeckId] = useState<string>("full_catalog");
  const [deckStatus, setDeckStatus] = useState<string | null>(null);
  const [selectedVideo, setSelectedVideo] = useState<File | null>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [videoMetadata, setVideoMetadata] = useState<{
    duration: number;
    width: number;
    height: number;
  } | null>(null);
  const [videoViewportRect, setVideoViewportRect] =
    useState<VideoViewportRect | null>(null);
  const [frameState, setFrameState] = useState<VideoScanFrameState | null>(
    null,
  );
  const [activeTracks, setActiveTracks] = useState<VideoTrack[]>([]);
  const [timeline, setTimeline] = useState<VideoTimelineItem[]>([]);
  const [progress, setProgress] = useState<VideoScanProgress>({
    processed: 0,
    total: 0,
  });
  const [isLoadingIndex, setIsLoadingIndex] = useState(false);
  const [hashStatus, setHashStatus] = useState<string | null>(
    "Select a video and start a browser-side run.",
  );
  const [hashCount, setHashCount] = useState<number | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ---------- hooks ----------

  const dataCallbacks = useMemo(
    () => ({
      onHashStatus: setHashStatus,
      onHashCount: setHashCount,
      onLoadingChange: setIsLoadingIndex,
    }),
    [],
  );
  const { ensureHashIndex, ensureEmbeddingIndexes, artworkDbRef } =
    useVideoScanData(token, dataCallbacks);

  const processorCallbacks = useMemo(
    () => ({
      onFrameState: setFrameState,
      onTracks: setActiveTracks,
      onTimeline: setTimeline,
      onProgress: setProgress,
      onStatus: setHashStatus,
      onMetadata: setVideoMetadata,
      onProcessing: setIsProcessing,
      onError: setError,
    }),
    [],
  );
  const {
    processLiveDetection,
    processYoloWithMatching,
    processYoloWithEmbedding,
    requestStop,
    resetTracking,
  } = useVideoScanProcessor(processorCallbacks);

  // ---------- derived ----------

  const progressPercent =
    progress.total > 0
      ? Math.min(100, (progress.processed / progress.total) * 100)
      : 0;

  const visibleTracks = useMemo(
    () =>
      activeTracks.filter(
        (track) =>
          track.match.passedThreshold &&
          track.stableFrames >= MIN_TRACK_STABLE_FRAMES,
      ),
    [activeTracks],
  );
  const primaryTrack = visibleTracks[0] ?? null;
  const primaryCandidate = primaryTrack?.match ?? null;

  const overlayItems = useMemo(
    () =>
      videoMetadata && videoViewportRect
        ? buildTrackOverlayItems(
            visibleTracks,
            videoMetadata,
            videoViewportRect,
          )
        : [],
    [videoMetadata, videoViewportRect, visibleTracks],
  );

  const stopAndCleanup = useCallback(() => {
    requestStop();
    if (videoUrl) URL.revokeObjectURL(videoUrl);
  }, [requestStop, videoUrl]);

  // ---------- effects ----------

  useEffect(() => {
    setPrintingMode(
      normalizeScannerPrintingMode(
        window.localStorage.getItem(SCANNER_PRINTING_MODE_STORAGE_KEY),
      ),
    );
  }, []);

  useEffect(() => {
    let cancelled = false;
    if (!token || !isAuthenticated) {
      queueMicrotask(() => {
        if (cancelled) return;
        setYugiohDecks([]);
        setSelectedDeckId("full_catalog");
        setDeckStatus(null);
      });
      return () => {
        cancelled = true;
      };
    }
    void getDecks(token)
      .then((decks) => {
        if (cancelled) return;
        const eligible = decks.filter(
          (deck) =>
            ["yugioh", "yu-gi-oh", "yu-gi-oh!", "yu_gi_oh"].includes(
              deck.tcg.trim().toLowerCase(),
            ) && deck.cards.length > 0,
        );
        setYugiohDecks(eligible);
        setDeckStatus(null);
        setSelectedDeckId((current) =>
          current === "full_catalog" ||
          eligible.some((deck) => deck.id === current)
            ? current
            : "full_catalog",
        );
      })
      .catch(() => {
        if (cancelled) return;
        setYugiohDecks([]);
        setSelectedDeckId("full_catalog");
        setDeckStatus("Decks unavailable; full-catalog scan remains active.");
      });
    return () => {
      cancelled = true;
    };
  }, [isAuthenticated, token]);

  useEffect(() => {
    return () => {
      stopAndCleanup();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [videoUrl]);

  useEffect(() => {
    const el = videoRef.current;
    if (!el || !videoMetadata) return;
    const update = () =>
      setVideoViewportRect(computeContainedVideoRect(el, videoMetadata));
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, [videoMetadata]);

  // ---------- handlers ----------

  const resetRunState = useCallback(() => {
    setFrameState(null);
    setActiveTracks([]);
    setTimeline([]);
    setProgress({ processed: 0, total: 0 });
    setError(null);
    resetTracking();
  }, [resetTracking]);

  const handleVideoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    resetRunState();
    setSelectedVideo(file);
    setVideoUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return URL.createObjectURL(file);
    });
    setHashStatus("Video loaded. Choose options and start processing.");
  };

  const handleReset = () => {
    resetRunState();
    setSelectedVideo(null);
    setVideoMetadata(null);
    setHashStatus("Select a video and start a browser-side run.");
    setHashCount(null);
    setVideoUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return null;
    });
    if (inputRef.current) inputRef.current.value = "";
  };

  const handleProcess = async () => {
    if (!selectedVideo || !videoRef.current || !frameCanvasRef.current) {
      setError("Choose a local video file first.");
      return;
    }

    if (detectionOnly) {
      resetRunState();
      setIsProcessing(true);
      try {
        await processLiveDetection({
          video: videoRef.current,
          frameCanvas: frameCanvasRef.current,
          scanFilter,
          analysisIntervalMs,
        });
      } catch (err) {
        setError(err instanceof Error ? err.message : "Detection failed.");
        setIsProcessing(false);
      }
      return;
    }

    // Client-side embedding mode is fully server-free (static index + on-device
    // CLIP), so it does not require sign-in.
    if (embeddingMode) {
      resetRunState();
      setIsProcessing(true);
      setHashStatus(null);
      try {
        let indexes = await ensureEmbeddingIndexes(scanFilter);
        if (indexes.length === 0) {
          setError(
            scanFilter === "all"
              ? "No compatible game embedding shards are published yet."
              : `No embedding index published for ${scanFilter} yet.`,
          );
          setIsProcessing(false);
          return;
        }
        const selectedDeck = yugiohDecks.find(
          (deck) => deck.id === selectedDeckId,
        );
        if (selectedDeck) {
          const allowedIds = new Set(
            selectedDeck.cards.map((card) => card.externalId.toLowerCase()),
          );
          indexes = indexes.map((index) =>
            index.tcg === "yugioh"
              ? restrictEmbeddingIndexToExternalIds(index, allowedIds)
              : index,
          );
          const scopedRows = indexes.reduce(
            (sum, index) => sum + index.total,
            0,
          );
          if (scopedRows === 0) {
            setError(
              `None of the ${selectedDeck.name} deck identities are present in the installed Yu-Gi-Oh scanner index.`,
            );
            setIsProcessing(false);
            return;
          }
          setHashStatus(
            `Deck Scan: ${selectedDeck.name} · ${scopedRows} restricted visual identities.`,
          );
        }
        await processYoloWithEmbedding({
          video: videoRef.current,
          frameCanvas: frameCanvasRef.current,
          embeddingIndexes: indexes,
          scanFilter,
          analysisIntervalMs,
          printingMode,
          ocrEnabled: readScannerOcrEnabled(),
        });
      } catch (err) {
        setError(err instanceof Error ? err.message : "Embedding scan failed.");
        setIsProcessing(false);
      }
      return;
    }

    if (!isAuthenticated || !token) {
      setError("Sign in is required.");
      return;
    }

    resetRunState();
    setIsProcessing(true);
    setHashStatus(null);
    try {
      const hashEntries = await ensureHashIndex(scanFilter);
      // Use YOLO + matching for live card identification
      await processYoloWithMatching({
        video: videoRef.current,
        frameCanvas: frameCanvasRef.current,
        hashEntries,
        artworkDb: artworkDbRef.current ?? undefined,
        scanFilter,
        analysisIntervalMs,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Processing failed.");
      setIsProcessing(false);
    }
  };

  // ---------- render ----------

  return (
    <Card className="overflow-hidden border-dashed">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Film className="h-5 w-5" />
          Duel / Table Scan
          <Badge variant="secondary">Oriented boxes</Badge>
        </CardTitle>
        <CardDescription>
          Recover multiple rotated or steep-angle cards from a local video,
          de-rotate each oriented box, perspective-refine failed crops, and
          recognize them on-device. Keep the ordinary scanner for a single
          handheld card.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-6 xl:grid-cols-[380px_1fr]">
        <div>
          <input
            ref={inputRef}
            type="file"
            accept="video/*"
            className="hidden"
            onChange={handleVideoChange}
          />
          <canvas ref={frameCanvasRef} className="hidden" />
          <ScanControlsSidebar
            scanFilter={scanFilter}
            onScanFilterChange={(filter) => {
              setScanFilter(filter);
              if (filter !== "yugioh") setSelectedDeckId("full_catalog");
            }}
            yugiohDecks={yugiohDecks}
            selectedDeckId={selectedDeckId}
            onSelectedDeckIdChange={setSelectedDeckId}
            deckStatus={deckStatus}
            detectionOnly={detectionOnly}
            onDetectionOnlyChange={setDetectionOnly}
            embeddingMode={embeddingMode}
            onEmbeddingModeChange={(enabled) => {
              setEmbeddingMode(enabled);
              if (!enabled) setSelectedDeckId("full_catalog");
            }}
            printingMode={printingMode}
            onPrintingModeChange={(mode) => {
              setPrintingMode(mode);
              window.localStorage.setItem(
                SCANNER_PRINTING_MODE_STORAGE_KEY,
                mode,
              );
            }}
            analysisIntervalMs={analysisIntervalMs}
            onAnalysisIntervalChange={(value) =>
              setAnalysisIntervalMs(clampAnalysisInterval(value))
            }
            isProcessing={isProcessing}
            isLoadingIndex={isLoadingIndex}
            hasVideo={!!selectedVideo}
            hasFrame={!!frameState}
            onChooseVideo={() => inputRef.current?.click()}
            onProcess={handleProcess}
            onStop={requestStop}
            onReset={handleReset}
            selectedVideo={selectedVideo}
            videoMetadata={videoMetadata}
            hashStatus={hashStatus}
            hashCount={hashCount}
            progress={progress}
            progressPercent={progressPercent}
            error={error}
            mounted={mounted}
            isAuthenticated={isAuthenticated}
          />
        </div>

        <div className="space-y-5">
          <VideoPlayerWithOverlay
            videoRef={videoRef}
            videoUrl={videoUrl}
            overlayItems={overlayItems}
            onMetadataLoaded={setVideoMetadata}
          />
          <div className="grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
            <ActiveTracksPanel
              visibleTracks={visibleTracks}
              primaryTrack={primaryTrack}
              primaryCandidate={primaryCandidate}
              frameState={frameState}
            />
            <TimelinePanel timeline={timeline} />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
