"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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

import {
  DEFAULT_SAMPLE_FPS,
  MIN_IMMEDIATE_TRACK_CONFIDENCE,
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
import { buildTrackOverlayItems, computeContainedVideoRect } from "./video-scan-overlay";
import {
  ActiveTracksPanel,
  ScanControlsSidebar,
  TimelinePanel,
  VideoPlayerWithOverlay,
} from "./video-scan-panels";

export function VideoScanLab() {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const frameCanvasRef = useRef<HTMLCanvasElement | null>(null);

  const { token, isAuthenticated } = useAuthStore((s) => ({
    token: s.token,
    isAuthenticated: s.isAuthenticated,
  }));
  const selectedGame = useGameFilterStore((s) => s.selectedGame);

  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  // ---------- state ----------

  const [scanFilter, setScanFilter] = useState<ScanFilter>(
    selectedGame === "all" ? "pokemon" : selectedGame,
  );
  const [sampleFpsValue, setSampleFpsValue] = useState<number[]>([
    DEFAULT_SAMPLE_FPS * 10,
  ]);
  const [maxFrames, setMaxFrames] = useState("60");
  const [detectionOnly, setDetectionOnly] = useState(false);
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
  const { ensureHashIndex, artworkDbRef } = useVideoScanData(
    token,
    dataCallbacks,
  );

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
  const { processBatch, processLiveDetection, requestStop, resetTracking } =
    useVideoScanProcessor(processorCallbacks);

  // ---------- derived ----------

  const sampleFps = sampleFpsValue[0] / 10;
  const progressPercent =
    progress.total > 0
      ? Math.min(100, (progress.processed / progress.total) * 100)
      : 0;

  const visibleTracks = useMemo(
    () =>
      activeTracks.filter((track) => {
        if (!track.match.passedThreshold) return false;
        if (detectionOnly) return true;
        return (
          track.stableFrames >= MIN_TRACK_STABLE_FRAMES ||
          track.match.confidence >= MIN_IMMEDIATE_TRACK_CONFIDENCE
        );
      }),
    [activeTracks, detectionOnly],
  );
  const primaryTrack = visibleTracks[0] ?? null;
  const primaryCandidate = primaryTrack?.match ?? null;

  const overlayItems = useMemo(
    () =>
      videoMetadata && videoViewportRect
        ? buildTrackOverlayItems(visibleTracks, videoMetadata, videoViewportRect)
        : [],
    [videoMetadata, videoViewportRect, visibleTracks],
  );

  // ---------- effects ----------

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

  const stopAndCleanup = useCallback(() => {
    requestStop();
    if (videoUrl) URL.revokeObjectURL(videoUrl);
  }, [requestStop, videoUrl]);

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
        });
      } catch (err) {
        setError(err instanceof Error ? err.message : "Detection failed.");
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
      await processBatch({
        video: videoRef.current,
        frameCanvas: frameCanvasRef.current,
        hashEntries,
        artworkDb: artworkDbRef.current ?? undefined,
        scanFilter,
        sampleFps,
        maxFrames,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Processing failed.");
    } finally {
      setIsProcessing(false);
    }
  };

  // ---------- render ----------

  return (
    <Card className="overflow-hidden border-dashed">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Film className="h-5 w-5" />
          Video Scan Lab
          <Badge variant="secondary">Experimental</Badge>
        </CardTitle>
        <CardDescription>
          Import a video from your computer, download the scan hash corpus into
          the browser, and step through sampled frames with a live guess panel.
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
            onScanFilterChange={setScanFilter}
            sampleFpsValue={sampleFpsValue}
            onSampleFpsChange={setSampleFpsValue}
            sampleFps={sampleFps}
            maxFrames={maxFrames}
            onMaxFramesChange={setMaxFrames}
            detectionOnly={detectionOnly}
            onDetectionOnlyChange={setDetectionOnly}
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
