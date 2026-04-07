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
  getCardScanHashesPageApi,
  type CardScanHashEntry,
} from "@/lib/api/scan";
import {
  scanVideoFrameCanvasInBrowser,
  type BrowserVideoFrameScanResult,
  type BrowserVideoScanCandidate,
  type VideoWindowProposal,
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
import type { TcgCode } from "@/types/card";

type ScanFilter = TcgCode | "all";

interface VideoScanProgress {
  processed: number;
  total: number;
}

interface VideoScanFrameState extends BrowserVideoFrameScanResult {
  timestampSeconds: number;
}

interface VideoTimelineItem {
  id: string;
  timestampSeconds: number;
  match: BrowserVideoScanCandidate;
  proposal: VideoWindowProposal | null;
}

const HASH_PAGE_SIZE = 2000;
const MAX_TIMELINE_ITEMS = 24;
const DEFAULT_SAMPLE_FPS = 1;
const DEFAULT_MAX_FRAMES = 60;
const MAX_FRAME_LONG_SIDE = 960;

function formatSeconds(seconds: number): string {
  const wholeSeconds = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(wholeSeconds / 60);
  const remainingSeconds = wholeSeconds % 60;
  return `${minutes}:${remainingSeconds.toString().padStart(2, "0")}`;
}

function formatConfidence(confidence: number): string {
  return `${Math.round(confidence * 100)}%`;
}

function getCandidateTone(candidate: BrowserVideoScanCandidate | null): string {
  if (!candidate) {
    return "border-slate-300 bg-slate-500/10 text-slate-700";
  }
  if (candidate.passedThreshold && candidate.confidence >= 0.8) {
    return "border-emerald-300 bg-emerald-500/10 text-emerald-700";
  }
  if (candidate.passedThreshold) {
    return "border-amber-300 bg-amber-500/10 text-amber-700";
  }
  return "border-rose-300 bg-rose-500/10 text-rose-700";
}

export function VideoScanLab() {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const frameCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const hashCacheRef = useRef(new Map<string, CardScanHashEntry[]>());
  const stopRequestedRef = useRef(false);
  const lastTimelineKeyRef = useRef<string | null>(null);

  const { token, isAuthenticated } = useAuthStore((state) => ({
    token: state.token,
    isAuthenticated: state.isAuthenticated,
  }));
  const selectedGame = useGameFilterStore((state) => state.selectedGame);

  const [scanFilter, setScanFilter] = useState<ScanFilter>(
    selectedGame === "all" ? "pokemon" : selectedGame,
  );
  const [sampleFpsValue, setSampleFpsValue] = useState<number[]>([
    DEFAULT_SAMPLE_FPS * 10,
  ]);
  const [maxFrames, setMaxFrames] = useState(String(DEFAULT_MAX_FRAMES));
  const [selectedVideo, setSelectedVideo] = useState<File | null>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [videoMetadata, setVideoMetadata] = useState<{
    duration: number;
    width: number;
    height: number;
  } | null>(null);
  const [frameState, setFrameState] = useState<VideoScanFrameState | null>(null);
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

  const sampleFps = sampleFpsValue[0] / 10;
  const progressPercent =
    progress.total > 0 ? Math.min(100, (progress.processed / progress.total) * 100) : 0;
  const hashScopeLabel = scanFilter === "all" ? "all games" : GAME_LABELS[scanFilter];
  const activeCandidate = frameState?.bestMatch ?? null;
  const activeProposal = frameState?.activeProposal ?? null;

  const overlayStyle = useMemo(() => {
    if (!activeProposal || !videoMetadata) {
      return null;
    }

    return {
      left: `${(activeProposal.left / videoMetadata.width) * 100}%`,
      top: `${(activeProposal.top / videoMetadata.height) * 100}%`,
      width: `${(activeProposal.width / videoMetadata.width) * 100}%`,
      height: `${(activeProposal.height / videoMetadata.height) * 100}%`,
    };
  }, [activeProposal, videoMetadata]);

  useEffect(() => {
    return () => {
      stopRequestedRef.current = true;
      if (videoUrl) {
        URL.revokeObjectURL(videoUrl);
      }
    };
  }, [videoUrl]);

  const resetRunState = () => {
    setFrameState(null);
    setTimeline([]);
    setProgress({ processed: 0, total: 0 });
    setError(null);
    lastTimelineKeyRef.current = null;
  };

  const handleChooseVideo = () => {
    inputRef.current?.click();
  };

  const handleVideoChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const nextFile = event.target.files?.[0] ?? null;
    if (!nextFile) {
      return;
    }

    stopRequestedRef.current = true;
    setSelectedVideo(nextFile);
    setVideoMetadata(null);
    resetRunState();
    setVideoUrl((previousUrl) => {
      if (previousUrl) {
        URL.revokeObjectURL(previousUrl);
      }
      return URL.createObjectURL(nextFile);
    });
  };

  const handleReset = () => {
    stopRequestedRef.current = true;
    setSelectedVideo(null);
    setVideoMetadata(null);
    resetRunState();
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

  const appendTimelineItem = (
    timestampSeconds: number,
    match: BrowserVideoScanCandidate,
    proposal: VideoWindowProposal | null,
  ) => {
    const key = `${match.tcg}:${match.externalId}`;
    if (key === lastTimelineKeyRef.current) {
      return;
    }

    lastTimelineKeyRef.current = key;
    setTimeline((previous) => {
      const nextItem: VideoTimelineItem = {
        id: `${key}:${timestampSeconds.toFixed(2)}`,
        timestampSeconds,
        match,
        proposal,
      };

      return [nextItem, ...previous].slice(0, MAX_TIMELINE_ITEMS);
    });
  };

  const ensureHashIndex = async (
    requestedFilter: ScanFilter,
  ): Promise<CardScanHashEntry[]> => {
    if (!token) {
      throw new Error("Sign in is required before loading the scan hash index.");
    }

    const cacheKey = requestedFilter;
    const cached = hashCacheRef.current.get(cacheKey);
    if (cached) {
      setHashCount(cached.length);
      setHashStatus(
        `Loaded ${cached.length.toLocaleString()} hashes for ${requestedFilter === "all" ? "all games" : GAME_LABELS[requestedFilter]}.`,
      );
      return cached;
    }

    setIsLoadingIndex(true);
    setHashStatus(`Loading ${hashScopeLabel} hash index into the browser...`);

    try {
      const entries: CardScanHashEntry[] = [];
      let page = 1;
      let totalPages = 1;
      let totalEntries = 0;

      while (page <= totalPages) {
        const response = await getCardScanHashesPageApi({
          token,
          tcg: requestedFilter,
          page,
          pageSize: HASH_PAGE_SIZE,
        });

        entries.push(...response.entries);
        totalPages = response.totalPages;
        totalEntries = response.total;
        setHashCount(entries.length);
        setHashStatus(
          `Loading ${hashScopeLabel} hash index: ${entries.length.toLocaleString()} / ${totalEntries.toLocaleString()} entries.`,
        );
        page += 1;
      }

      hashCacheRef.current.set(cacheKey, entries);
      setHashStatus(
        `Loaded ${entries.length.toLocaleString()} hashes for ${requestedFilter === "all" ? "all games" : GAME_LABELS[requestedFilter]}.`,
      );

      return entries;
    } finally {
      setIsLoadingIndex(false);
    }
  };

  const handleProcess = async () => {
    if (!isAuthenticated || !token) {
      setError("Sign in is required before you can run the browser-side video scan.");
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
        `Running ${timestamps.length} sampled frames locally in the browser against ${hashEntries.length.toLocaleString()} hashes.`,
      );

      for (const [index, timestampSeconds] of timestamps.entries()) {
        if (stopRequestedRef.current) {
          break;
        }

        await seekVideo(video, timestampSeconds);
        const { width, height } = drawVideoFrameToCanvas(video, frameCanvas);
        const nextMetadata = {
          duration: video.duration,
          width,
          height,
        };
        setVideoMetadata(nextMetadata);

        const nextFrameState: VideoScanFrameState = {
          timestampSeconds,
          ...scanVideoFrameCanvasInBrowser({
            frameCanvas,
            hashEntries,
            tcgFilter: scanFilter,
          }),
        };

        setFrameState(nextFrameState);
        setProgress({ processed: index + 1, total: timestamps.length });
        processedFrames = index + 1;

        if (nextFrameState.bestMatch) {
          appendTimelineItem(
            timestampSeconds,
            nextFrameState.bestMatch,
            nextFrameState.activeProposal,
          );
        }

        await yieldToBrowser();
      }

      setHashStatus(
        stopRequestedRef.current
          ? `Stopped after ${processedFrames.toLocaleString()} sampled frames.`
          : `Finished ${timestamps.length.toLocaleString()} sampled frames locally in the browser.`,
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

  const handleStop = () => {
    stopRequestedRef.current = true;
  };

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
          The outline is currently driven by portrait crop proposals rather than
          the backend detector.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-6 xl:grid-cols-[380px_1fr]">
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

          <div className="space-y-3 rounded-xl border bg-muted/30 p-4">
            <div className="space-y-1">
              <Label>Sample Rate</Label>
              <div className="flex items-center justify-between text-sm text-muted-foreground">
                <span>{sampleFps.toFixed(1)} fps</span>
                <span>Lower is faster</span>
              </div>
            </div>
            <Slider
              value={sampleFpsValue}
              min={2}
              max={20}
              step={1}
              onValueChange={setSampleFpsValue}
            />
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

          <div className="flex flex-wrap gap-2">
            <Button type="button" onClick={handleChooseVideo} className="gap-2">
              <Upload className="h-4 w-4" />
              Import Video
            </Button>
            {isProcessing ? (
              <Button type="button" variant="secondary" onClick={handleStop} className="gap-2">
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
                Process In Browser
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
                  {formatSeconds(videoMetadata.duration)} · {videoMetadata.width}×
                  {videoMetadata.height}
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
                {progress.processed.toLocaleString()} / {progress.total.toLocaleString()}
              </span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-primary transition-[width]"
                style={{ width: `${progressPercent}%` }}
              />
            </div>
          </div>

          {(error || !isAuthenticated) && (
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

        <div className="space-y-5">
          <div className="relative overflow-hidden rounded-xl border bg-black">
            {videoUrl ? (
              <>
                <video
                  ref={videoRef}
                  src={videoUrl}
                  controls
                  preload="metadata"
                  className="aspect-video w-full bg-black object-contain"
                  onLoadedMetadata={(event) => {
                    const target = event.currentTarget;
                    setVideoMetadata({
                      duration: target.duration,
                      width: target.videoWidth,
                      height: target.videoHeight,
                    });
                  }}
                />
                {overlayStyle ? (
                  <div
                    className="pointer-events-none absolute border-2 border-emerald-400 shadow-[0_0_0_9999px_rgba(15,23,42,0.08)]"
                    style={overlayStyle}
                  />
                ) : null}
              </>
            ) : (
              <div className="flex aspect-video flex-col items-center justify-center gap-3 bg-[radial-gradient(circle_at_top,_rgba(255,255,255,0.12),_rgba(2,6,23,0.9)_55%,_rgba(2,6,23,1))] p-6 text-center text-white/80">
                <Film className="h-10 w-10" />
                <div className="space-y-1">
                  <p className="font-medium text-white">No video selected</p>
                  <p className="text-sm text-white/70">
                    Import a local video to try browser-side frame matching.
                  </p>
                </div>
              </div>
            )}
          </div>

          <div className="grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
            <div className="space-y-4 rounded-xl border bg-muted/20 p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium">Active Guess</p>
                  <p className="text-xs text-muted-foreground">
                    Updates as sampled frames are processed locally.
                  </p>
                </div>
                {frameState ? (
                  <Badge variant="outline">
                    {formatSeconds(frameState.timestampSeconds)}
                  </Badge>
                ) : null}
              </div>

              {activeCandidate ? (
                <div className="space-y-3">
                  <div
                    className={cn(
                      "rounded-xl border px-4 py-3",
                      getCandidateTone(activeCandidate),
                    )}
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="space-y-1">
                        <p className="font-semibold">{activeCandidate.name}</p>
                        <p className="text-sm opacity-80">
                          {GAME_LABELS[activeCandidate.tcg]} ·{" "}
                          {activeCandidate.setCode ?? "unknown set"}
                        </p>
                      </div>
                      <Badge
                        variant={
                          activeCandidate.passedThreshold ? "default" : "outline"
                        }
                      >
                        {formatConfidence(activeCandidate.confidence)}
                      </Badge>
                    </div>
                  </div>

                  <div className="grid gap-2 text-sm sm:grid-cols-3">
                    <div className="rounded-lg border bg-background px-3 py-2">
                      <div className="text-xs uppercase tracking-wide text-muted-foreground">
                        Distance
                      </div>
                      <div className="font-medium">{activeCandidate.distance}</div>
                    </div>
                    <div className="rounded-lg border bg-background px-3 py-2">
                      <div className="text-xs uppercase tracking-wide text-muted-foreground">
                        Proposal
                      </div>
                      <div className="font-medium">{activeCandidate.proposalLabel}</div>
                    </div>
                    <div className="rounded-lg border bg-background px-3 py-2">
                      <div className="text-xs uppercase tracking-wide text-muted-foreground">
                        Status
                      </div>
                      <div className="font-medium">
                        {activeCandidate.passedThreshold
                          ? "Within threshold"
                          : "Low confidence"}
                      </div>
                    </div>
                  </div>

                  {frameState?.candidates.length ? (
                    <div className="space-y-2">
                      <p className="text-sm font-medium">Current Candidates</p>
                      <div className="space-y-2">
                        {frameState.candidates.map((candidate) => (
                          <div
                            key={`${candidate.tcg}:${candidate.externalId}:${candidate.proposalLabel}`}
                            className="flex items-center justify-between rounded-lg border bg-background px-3 py-2 text-sm"
                          >
                            <div className="space-y-0.5">
                              <p className="font-medium">{candidate.name}</p>
                              <p className="text-xs text-muted-foreground">
                                {candidate.proposalLabel} · {candidate.distance}
                              </p>
                            </div>
                            <Badge variant="outline">
                              {formatConfidence(candidate.confidence)}
                            </Badge>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </div>
              ) : (
                <div className="rounded-xl border bg-background px-4 py-6 text-sm text-muted-foreground">
                  The active guess will appear here once sampled frames start
                  matching against the downloaded hash corpus.
                </div>
              )}
            </div>

            <div className="space-y-4 rounded-xl border bg-muted/20 p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium">Timeline</p>
                  <p className="text-xs text-muted-foreground">
                    New entries are added when the guessed card changes.
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
                          <p className="font-medium">{item.match.name}</p>
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
                  The timeline will start filling in after the first confident
                  guess lands.
                </div>
              )}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

async function ensureVideoMetadata(video: HTMLVideoElement): Promise<void> {
  if (
    Number.isFinite(video.duration) &&
    video.duration > 0 &&
    video.videoWidth > 0 &&
    video.videoHeight > 0
  ) {
    return;
  }

  await new Promise<void>((resolve, reject) => {
    const handleLoaded = () => {
      cleanup();
      resolve();
    };
    const handleError = () => {
      cleanup();
      reject(new Error("Unable to load video metadata."));
    };
    const cleanup = () => {
      video.removeEventListener("loadedmetadata", handleLoaded);
      video.removeEventListener("error", handleError);
    };

    video.addEventListener("loadedmetadata", handleLoaded, { once: true });
    video.addEventListener("error", handleError, { once: true });
  });
}

async function seekVideo(
  video: HTMLVideoElement,
  timestampSeconds: number,
): Promise<void> {
  const safeDuration =
    Number.isFinite(video.duration) && video.duration > 0.05
      ? video.duration - 0.05
      : Math.max(0, video.duration);
  const nextTime = Math.max(0, Math.min(timestampSeconds, safeDuration));

  if (Math.abs(video.currentTime - nextTime) < 0.01) {
    return;
  }

  await new Promise<void>((resolve, reject) => {
    const handleSeeked = () => {
      cleanup();
      resolve();
    };
    const handleError = () => {
      cleanup();
      reject(new Error("Unable to seek the local video file."));
    };
    const cleanup = () => {
      video.removeEventListener("seeked", handleSeeked);
      video.removeEventListener("error", handleError);
    };

    video.addEventListener("seeked", handleSeeked, { once: true });
    video.addEventListener("error", handleError, { once: true });
    video.currentTime = nextTime;
  });
}

function drawVideoFrameToCanvas(
  video: HTMLVideoElement,
  canvas: HTMLCanvasElement,
): { width: number; height: number } {
  const longestSide = Math.max(video.videoWidth, video.videoHeight);
  const scale = longestSide > MAX_FRAME_LONG_SIDE ? MAX_FRAME_LONG_SIDE / longestSide : 1;
  const width = Math.max(1, Math.round(video.videoWidth * scale));
  const height = Math.max(1, Math.round(video.videoHeight * scale));

  canvas.width = width;
  canvas.height = height;

  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) {
    throw new Error("Unable to extract a frame from the video.");
  }

  context.drawImage(video, 0, 0, width, height);
  return { width, height };
}

function buildSampleTimestamps(
  durationSeconds: number,
  sampleFps: number,
  maxFrames: number,
): number[] {
  const safeFps = Math.max(0.1, sampleFps);
  const step = 1 / safeFps;
  const safeMaxFrames = Math.max(1, maxFrames);
  const upperBound =
    durationSeconds > 0.05 ? durationSeconds - 0.05 : Math.max(0, durationSeconds);
  const timestamps: number[] = [];

  for (
    let timestampSeconds = 0;
    timestampSeconds <= upperBound + 0.0001 && timestamps.length < safeMaxFrames;
    timestampSeconds += step
  ) {
    timestamps.push(Number(timestampSeconds.toFixed(3)));
  }

  if (!timestamps.length) {
    timestamps.push(0);
  }

  return timestamps;
}

async function yieldToBrowser(): Promise<void> {
  await new Promise<void>((resolve) => {
    window.requestAnimationFrame(() => resolve());
  });
}
