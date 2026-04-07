"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  Cpu,
  Film,
  Loader2,
  Play,
  Square,
  Upload,
} from "lucide-react";

import {
  scanVideoFrameCanvasInBrowser,
  type BrowserVideoScanCandidate,
} from "@/lib/scan/browser-video-matcher";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { cn, GAME_LABELS } from "@/lib/utils";
import { useAuthStore } from "@/stores/auth";
import { useGameFilterStore } from "@/stores/game-filter";

import {
  DEFAULT_MAX_FRAMES,
  DEFAULT_SAMPLE_FPS,
  MAX_TIMELINE_ITEMS,
  MIN_IMMEDIATE_TRACK_CONFIDENCE,
  MIN_TRACK_STABLE_FRAMES,
  formatMatchScore,
  formatSeconds,
  getCandidateTone,
  type ScanFilter,
  type VideoOverlayItem,
  type VideoScanFrameState,
  type VideoScanProgress,
  type VideoTimelineItem,
  type VideoTrack,
  type VideoViewportRect,
} from "./video-scan-types";
import { useVideoScanData } from "./use-video-scan-data";
import { reconcileVideoTracks } from "./video-scan-tracks";
import {
  buildDetectionOverlayItems,
  buildTrackOverlayItems,
  computeContainedVideoRect,
} from "./video-scan-overlay";
import {
  buildSampleTimestamps,
  drawVideoFrameToCanvas,
  ensureVideoMetadata,
  getTargetFrameLongSide,
  seekVideo,
  yieldToBrowser,
} from "./video-scan-video-utils";

export function VideoScanLab() {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const frameCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const stopRequestedRef = useRef(false);
  const trackStateRef = useRef<VideoTrack[]>([]);
  const nextTrackIdRef = useRef(1);

  const { token, isAuthenticated } = useAuthStore((state) => ({
    token: state.token,
    isAuthenticated: state.isAuthenticated,
  }));
  const selectedGame = useGameFilterStore((state) => state.selectedGame);

  // Defer auth-dependent rendering to avoid SSR/client hydration mismatch.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const [scanFilter, setScanFilter] = useState<ScanFilter>(
    selectedGame === "all" ? "pokemon" : selectedGame,
  );
  const [sampleFpsValue, setSampleFpsValue] = useState<number[]>([
    DEFAULT_SAMPLE_FPS * 10,
  ]);
  const [maxFrames, setMaxFrames] = useState(String(DEFAULT_MAX_FRAMES));
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

  const sampleFps = sampleFpsValue[0] / 10;
  const progressPercent =
    progress.total > 0
      ? Math.min(100, (progress.processed / progress.total) * 100)
      : 0;
  const hashScopeLabel =
    scanFilter === "all" ? "all games" : GAME_LABELS[scanFilter];

  const visibleTracks = useMemo(
    () =>
      activeTracks.filter(
        (track) =>
          track.match.passedThreshold &&
          (track.stableFrames >= MIN_TRACK_STABLE_FRAMES ||
            track.match.confidence >= MIN_IMMEDIATE_TRACK_CONFIDENCE),
      ),
    [activeTracks],
  );
  const primaryTrack = visibleTracks[0] ?? null;
  const primaryCandidate = primaryTrack?.match ?? null;

  const overlayItems = useMemo<VideoOverlayItem[]>(() => {
    if (!videoMetadata || !videoViewportRect) {
      return [];
    }

    if (detectionOnly && frameState) {
      return buildDetectionOverlayItems(
        frameState,
        videoMetadata,
        videoViewportRect,
      );
    }

    return buildTrackOverlayItems(
      visibleTracks,
      videoMetadata,
      videoViewportRect,
    );
  }, [
    videoMetadata,
    videoViewportRect,
    visibleTracks,
    detectionOnly,
    frameState,
  ]);

  useEffect(() => {
    return () => {
      stopRequestedRef.current = true;
      if (videoUrl) {
        URL.revokeObjectURL(videoUrl);
      }
    };
  }, [videoUrl]);

  useEffect(() => {
    const videoElement = videoRef.current;
    if (!videoElement || !videoMetadata) {
      return;
    }

    const updateRect = () => {
      setVideoViewportRect(
        computeContainedVideoRect(videoElement, videoMetadata),
      );
    };
    updateRect();

    const observer = new ResizeObserver(updateRect);
    observer.observe(videoElement);
    return () => observer.disconnect();
  }, [videoMetadata]);

  // ---------- handlers ----------

  const resetRunState = () => {
    setFrameState(null);
    setActiveTracks([]);
    setTimeline([]);
    setProgress({ processed: 0, total: 0 });
    setError(null);
    trackStateRef.current = [];
    nextTrackIdRef.current = 1;
  };

  const handleVideoChange = (
    event: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    resetRunState();
    setSelectedVideo(file);
    setVideoUrl((previousUrl) => {
      if (previousUrl) {
        URL.revokeObjectURL(previousUrl);
      }
      return URL.createObjectURL(file);
    });
    setHashStatus("Video loaded. Choose options and start processing.");
  };

  const handleChooseVideo = () => {
    inputRef.current?.click();
  };

  const handleReset = () => {
    resetRunState();
    setSelectedVideo(null);
    setVideoMetadata(null);
    setHashStatus("Select a video and start a browser-side run.");
    setHashCount(null);

    setVideoUrl((previousUrl) => {
      if (previousUrl) {
        URL.revokeObjectURL(previousUrl);
      }
      return null;
    });

    if (inputRef.current) {
      inputRef.current.value = "";
    }
  };

  const handleProcess = async () => {
    if (detectionOnly) {
      return handleLiveDetection();
    }

    if (!isAuthenticated || !token) {
      setError(
        "Sign in is required before you can run the browser-side video scan.",
      );
      return;
    }

    if (!selectedVideo || !videoRef.current || !frameCanvasRef.current) {
      setError("Choose a local video file first.");
      return;
    }

    stopRequestedRef.current = false;
    resetRunState();
    setIsProcessing(true);
    setHashStatus(null);

    try {
      const hashEntries = await ensureHashIndex(scanFilter);
      const video = videoRef.current;
      const frameCanvas = frameCanvasRef.current;
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

      setProgress({ processed: 0, total: timestamps.length });
      setHashStatus(
        `Running ${timestamps.length} sampled frames against ${hashEntries.length.toLocaleString()} hashes at ${sampleFps.toFixed(1)} fps.`,
      );

      for (const [index, timestampSeconds] of timestamps.entries()) {
        if (stopRequestedRef.current) {
          break;
        }

        await seekVideo(video, timestampSeconds);
        const { width, height } = drawVideoFrameToCanvas(
          video,
          frameCanvas,
          getTargetFrameLongSide(sampleFps),
        );
        setVideoMetadata({ duration: video.duration, width, height });

        const nextFrameState: VideoScanFrameState = {
          timestampSeconds,
          ...scanVideoFrameCanvasInBrowser({
            frameCanvas,
            hashEntries,
            artworkDb: artworkDbRef.current ?? undefined,
            tcgFilter: scanFilter,
          }),
        };

        setFrameState(nextFrameState);
        const trackUpdate = reconcileVideoTracks(
          trackStateRef.current,
          nextFrameState.proposalMatches,
          timestampSeconds,
          nextTrackIdRef.current,
        );
        trackStateRef.current = trackUpdate.tracks;
        nextTrackIdRef.current = trackUpdate.nextTrackId;
        setActiveTracks(trackUpdate.tracks);
        setProgress({ processed: index + 1, total: timestamps.length });
        processedFrames = index + 1;

        if (trackUpdate.timelineEntries.length) {
          setTimeline((previous) =>
            [...trackUpdate.timelineEntries, ...previous].slice(
              0,
              MAX_TIMELINE_ITEMS,
            ),
          );
        }

        await yieldToBrowser();
      }

      setHashStatus(
        stopRequestedRef.current
          ? `Stopped after ${processedFrames.toLocaleString()} sampled frames.`
          : `Finished ${timestamps.length.toLocaleString()} sampled frames.`,
      );
    } catch (processingError) {
      setError(
        processingError instanceof Error
          ? processingError.message
          : "The browser-side video scan failed.",
      );
    } finally {
      setIsProcessing(false);
      stopRequestedRef.current = false;
    }
  };

  /**
   * Live detection mode: runs a persistent rAF loop that detects card quads
   * whenever the video frame changes — during playback, manual seeking, or
   * scrubbing. Stops only when the user clicks Stop.
   */
  const handleLiveDetection = async () => {
    if (!selectedVideo || !videoRef.current || !frameCanvasRef.current) {
      setError("Choose a local video file first.");
      return;
    }

    const video = videoRef.current;
    const frameCanvas = frameCanvasRef.current;

    stopRequestedRef.current = false;
    resetRunState();
    setIsProcessing(true);

    try {
      await ensureVideoMetadata(video);

      setHashStatus(
        "Live detection active — play, pause, or scrub the video. Outlines update in real time.",
      );
      let processedFrames = 0;
      let lastProcessedTime = -1;

      const processFrame = () => {
        if (stopRequestedRef.current) {
          setIsProcessing(false);
          setHashStatus(
            `Live detection stopped after ${processedFrames} frames.`,
          );
          return;
        }

        // Only re-process when the video time actually changed
        // (avoids burning CPU while paused on the same frame).
        const currentTime = video.currentTime;
        if (Math.abs(currentTime - lastProcessedTime) > 0.01) {
          lastProcessedTime = currentTime;

          const { width, height } = drawVideoFrameToCanvas(
            video,
            frameCanvas,
            720,
          );
          setVideoMetadata({ duration: video.duration, width, height });

          const nextFrameState: VideoScanFrameState = {
            timestampSeconds: currentTime,
            ...scanVideoFrameCanvasInBrowser({
              frameCanvas,
              hashEntries: [],
              tcgFilter: scanFilter,
              detectionOnly: true,
            }),
          };

          setFrameState(nextFrameState);
          processedFrames++;
          setProgress({ processed: processedFrames, total: 0 });
        }

        requestAnimationFrame(processFrame);
      };

      requestAnimationFrame(processFrame);
    } catch (processingError) {
      setError(
        processingError instanceof Error
          ? processingError.message
          : "Live detection failed.",
      );
      setIsProcessing(false);
    }
  };

  const handleStop = () => {
    stopRequestedRef.current = true;
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
        {/* Left sidebar: controls */}
        <div className="space-y-5">
          <input
            ref={inputRef}
            type="file"
            accept="video/*"
            className="hidden"
            onChange={handleVideoChange}
          />
          <canvas ref={frameCanvasRef} className="hidden" />

          <div className="space-y-2">
            <Label>Scan Scope</Label>
            <Select
              value={scanFilter}
              onValueChange={(value) => setScanFilter(value as ScanFilter)}
            >
              <SelectTrigger>
                <SelectValue placeholder="Choose a game" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All games</SelectItem>
                <SelectItem value="pokemon">{GAME_LABELS.pokemon}</SelectItem>
                <SelectItem value="magic">{GAME_LABELS.magic}</SelectItem>
                <SelectItem value="yugioh">{GAME_LABELS.yugioh}</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              Recommended: select one TCG before downloading hashes into the
              browser.
            </p>
          </div>

          {!detectionOnly && (
            <>
              <div className="space-y-3 rounded-xl border bg-muted/30 p-4">
                <div className="space-y-1">
                  <Label>Sample Rate</Label>
                  <div className="flex items-center justify-between text-sm text-muted-foreground">
                    <span>{sampleFps.toFixed(1)} fps</span>
                    <span>Higher is heavier</span>
                  </div>
                </div>
                <Slider
                  value={sampleFpsValue}
                  min={2}
                  max={80}
                  step={1}
                  onValueChange={setSampleFpsValue}
                />
                <p className="text-xs text-muted-foreground">
                  Higher sample rates automatically downscale frames to keep
                  browser runs usable.
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="video-max-frames">Max Frames</Label>
                <Input
                  id="video-max-frames"
                  inputMode="numeric"
                  value={maxFrames}
                  onChange={(event) => setMaxFrames(event.target.value)}
                  placeholder={String(DEFAULT_MAX_FRAMES)}
                />
              </div>
            </>
          )}

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={detectionOnly}
              onChange={(e) => setDetectionOnly(e.target.checked)}
              className="rounded border-gray-300"
            />
            Detection only (skip matching)
          </label>

          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              onClick={handleChooseVideo}
              className="gap-2"
            >
              <Upload className="h-4 w-4" />
              Import Video
            </Button>
            {isProcessing ? (
              <Button
                type="button"
                variant="secondary"
                onClick={handleStop}
                className="gap-2"
              >
                <Square className="h-4 w-4" />
                Stop
              </Button>
            ) : (
              <Button
                type="button"
                variant="secondary"
                onClick={handleProcess}
                disabled={!selectedVideo || isLoadingIndex}
                className="gap-2"
              >
                {isLoadingIndex ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Play className="h-4 w-4" />
                )}
                {detectionOnly ? "Start Live Detection" : "Process In Browser"}
              </Button>
            )}
            <Button
              type="button"
              variant="outline"
              onClick={handleReset}
              disabled={!selectedVideo && !frameState}
            >
              Reset
            </Button>
          </div>

          {selectedVideo ? (
            <div className="rounded-lg border bg-background px-3 py-2 text-sm">
              <p className="font-medium">{selectedVideo.name}</p>
              <p className="text-muted-foreground">
                {(selectedVideo.size / 1024 / 1024).toFixed(2)} MB
              </p>
              {videoMetadata ? (
                <p className="text-muted-foreground">
                  {formatSeconds(videoMetadata.duration)} ·{" "}
                  {videoMetadata.width}x{videoMetadata.height}
                </p>
              ) : null}
            </div>
          ) : null}

          <div className="space-y-3 rounded-xl border bg-muted/30 p-4 text-sm">
            <div className="flex items-center gap-2 font-medium">
              <Cpu className="h-4 w-4" />
              Browser Index
            </div>
            <p className="text-muted-foreground">
              {hashStatus ?? "The browser index is ready."}
            </p>
            <div className="flex flex-wrap gap-2">
              {hashCount !== null ? (
                <Badge variant="outline">
                  {hashCount.toLocaleString()} hashes loaded
                </Badge>
              ) : null}
              <Badge variant="secondary">{hashScopeLabel}</Badge>
            </div>
          </div>

          <div className="space-y-2 rounded-xl border bg-muted/30 p-4 text-sm">
            <div className="flex items-center justify-between">
              <span className="font-medium">Progress</span>
              <span className="text-muted-foreground">
                {progress.total > 0
                  ? `${progress.processed.toLocaleString()} / ${progress.total.toLocaleString()}`
                  : progress.processed > 0
                    ? `${progress.processed.toLocaleString()} frames (live)`
                    : "—"}
              </span>
            </div>
            {progress.total > 0 && (
              <div className="h-2 overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-primary transition-[width]"
                  style={{ width: `${progressPercent}%` }}
                />
              </div>
            )}
          </div>

          {mounted && (error || !isAuthenticated) && (
            <div className="rounded-lg border border-rose-300 bg-rose-50 px-3 py-2 text-sm text-rose-900">
              <div className="flex items-center gap-2">
                <AlertCircle className="h-4 w-4" />
                <span>
                  {error ??
                    "Sign in to download the scan hashes and process video locally."}
                </span>
              </div>
            </div>
          )}
        </div>

        {/* Right: video + results */}
        <div className="space-y-5">
          <VideoPlayerWithOverlay
            videoRef={videoRef}
            videoUrl={videoUrl}
            overlayItems={overlayItems}
            onMetadataLoaded={(meta) => setVideoMetadata(meta)}
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

// ---------- sub-components ----------

function VideoPlayerWithOverlay({
  videoRef,
  videoUrl,
  overlayItems,
  onMetadataLoaded,
}: {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  videoUrl: string | null;
  overlayItems: VideoOverlayItem[];
  onMetadataLoaded: (meta: {
    duration: number;
    width: number;
    height: number;
  }) => void;
}) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ref = videoRef as any;

  if (!videoUrl) {
    return (
      <div className="relative overflow-hidden rounded-xl border bg-black">
        <div className="flex aspect-video flex-col items-center justify-center gap-3 bg-[radial-gradient(circle_at_top,_rgba(255,255,255,0.12),_rgba(2,6,23,0.9)_55%,_rgba(2,6,23,1))] p-6 text-center text-white/80">
          <Film className="h-10 w-10" />
          <div className="space-y-1">
            <p className="font-medium text-white">No video selected</p>
            <p className="text-sm text-white/70">
              Import a local video to try browser-side frame matching.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="relative overflow-hidden rounded-xl border bg-black">
      <video
        ref={ref}
        src={videoUrl}
        controls
        preload="metadata"
        className="aspect-video w-full bg-black object-contain"
        onLoadedMetadata={(event) => {
          const target = event.currentTarget;
          onMetadataLoaded({
            duration: target.duration,
            width: target.videoWidth,
            height: target.videoHeight,
          });
        }}
      />
      <div className="pointer-events-none absolute inset-0">
        <svg className="absolute inset-0 h-full w-full overflow-visible">
          {overlayItems.map((overlay) => (
            <polygon
              key={overlay.key}
              points={overlay.polygonPoints}
              fill={overlay.fillColor}
              stroke={overlay.strokeColor}
              strokeWidth={2}
              vectorEffect="non-scaling-stroke"
            />
          ))}
        </svg>
        {overlayItems
          .filter((overlay) => overlay.label)
          .map((overlay) => (
            <div
              key={`${overlay.key}:label`}
              className="absolute rounded bg-black/70 px-1.5 py-0.5 text-[10px] font-medium text-white shadow-sm"
              style={overlay.labelStyle}
            >
              {overlay.label}
            </div>
          ))}
      </div>
    </div>
  );
}

function ActiveTracksPanel({
  visibleTracks,
  primaryTrack,
  primaryCandidate,
  frameState,
}: {
  visibleTracks: VideoTrack[];
  primaryTrack: VideoTrack | null;
  primaryCandidate: BrowserVideoScanCandidate | null;
  frameState: VideoScanFrameState | null;
}) {
  return (
    <div className="space-y-4 rounded-xl border bg-muted/20 p-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-medium">Active Tracks</p>
          <p className="text-xs text-muted-foreground">
            Overlays appear only after a track stabilizes or is very confident.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {frameState ? (
            <Badge variant="outline">
              {formatSeconds(frameState.timestampSeconds)}
            </Badge>
          ) : null}
          <Badge variant="secondary">{visibleTracks.length}</Badge>
        </div>
      </div>

      {primaryCandidate ? (
        <div className="space-y-3">
          <div
            className={cn(
              "rounded-xl border px-4 py-3",
              getCandidateTone(primaryCandidate),
            )}
          >
            <div className="flex items-start justify-between gap-4">
              <div className="space-y-1">
                <p className="font-semibold">{primaryCandidate.name}</p>
                <p className="text-sm opacity-80">
                  {GAME_LABELS[primaryCandidate.tcg]} ·{" "}
                  {primaryCandidate.setCode ?? "unknown set"}
                </p>
              </div>
              <Badge
                variant={
                  primaryCandidate.passedThreshold ? "default" : "outline"
                }
              >
                {formatMatchScore(primaryCandidate.confidence)}
              </Badge>
            </div>
          </div>

          <div className="grid gap-2 text-sm sm:grid-cols-3">
            <div className="rounded-lg border bg-background px-3 py-2">
              <div className="text-xs uppercase tracking-wide text-muted-foreground">
                Distance
              </div>
              <div className="font-medium">{primaryCandidate.distance}</div>
            </div>
            <div className="rounded-lg border bg-background px-3 py-2">
              <div className="text-xs uppercase tracking-wide text-muted-foreground">
                Tracked
              </div>
              <div className="font-medium">
                {primaryTrack?.stableFrames ?? 1} stable frames
              </div>
            </div>
            <div className="rounded-lg border bg-background px-3 py-2">
              <div className="text-xs uppercase tracking-wide text-muted-foreground">
                Status
              </div>
              <div className="font-medium">
                {primaryCandidate.passedThreshold
                  ? "Within threshold"
                  : "Outside threshold"}
              </div>
            </div>
          </div>

          {visibleTracks.length ? (
            <div className="space-y-2">
              <p className="text-sm font-medium">Visible Track Matches</p>
              <div className="space-y-2">
                {visibleTracks.map((track) => (
                  <div
                    key={track.id}
                    className="flex items-center justify-between rounded-lg border bg-background px-3 py-2 text-sm"
                  >
                    <div className="space-y-0.5">
                      <p className="font-medium">
                        #{track.id} · {track.match.name}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {track.match.proposalLabel} ·{" "}
                        {GAME_LABELS[track.match.tcg]}
                        {track.isClipped ? " · clipped inference" : ""} ·{" "}
                        {formatSeconds(track.lastSeenSeconds)}
                      </p>
                    </div>
                    <Badge variant="outline">
                      {formatMatchScore(track.match.confidence)}
                    </Badge>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      ) : (
        <div className="rounded-xl border bg-background px-4 py-6 text-sm text-muted-foreground">
          No stable track is visible yet. This is intentional; weak one-frame
          guesses are kept out of the overlay.
        </div>
      )}
    </div>
  );
}

function TimelinePanel({ timeline }: { timeline: VideoTimelineItem[] }) {
  return (
    <div className="space-y-4 rounded-xl border bg-muted/20 p-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-medium">Timeline</p>
          <p className="text-xs text-muted-foreground">
            New entries are added when a track locks onto a new guess.
          </p>
        </div>
        <Badge variant="secondary">{timeline.length}</Badge>
      </div>

      {timeline.length ? (
        <div className="space-y-2">
          {timeline.map((item) => (
            <div
              key={item.id}
              className="rounded-lg border bg-background px-3 py-2 text-sm"
            >
              <div className="flex items-center justify-between gap-3">
                <div className="space-y-0.5">
                  <p className="font-medium">
                    #{item.trackId} · {item.match.name}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {GAME_LABELS[item.match.tcg]} ·{" "}
                    {item.match.setCode ?? "unknown set"}
                  </p>
                </div>
                <Badge variant="outline">
                  {formatSeconds(item.timestampSeconds)}
                </Badge>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="rounded-lg border bg-background px-3 py-6 text-sm text-muted-foreground">
          The timeline will start filling in after the first track lands on a
          confident guess.
        </div>
      )}
    </div>
  );
}
