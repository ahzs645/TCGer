import { useEffect } from "react";
import {
  AlertCircle,
  Cpu,
  Film,
  Loader2,
  Play,
  Square,
  Upload,
} from "lucide-react";

import type { BrowserVideoScanCandidate } from "@/lib/scan/browser-video-matcher";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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

import {
  formatMatchScore,
  formatSeconds,
  getCandidateTone,
  type ScanFilter,
  type VideoOverlayItem,
  type VideoScanFrameState,
  type VideoTimelineItem,
  type VideoTrack,
  type VideoViewportRect,
} from "./video-scan-types";
import { computeContainedVideoRect } from "./video-scan-overlay";

// ---------- Controls Sidebar ----------

export interface ScanControlsProps {
  scanFilter: ScanFilter;
  onScanFilterChange: (filter: ScanFilter) => void;
  sampleFpsValue: number[];
  onSampleFpsChange: (value: number[]) => void;
  sampleFps: number;
  maxFrames: string;
  onMaxFramesChange: (value: string) => void;
  detectionOnly: boolean;
  onDetectionOnlyChange: (value: boolean) => void;
  isProcessing: boolean;
  isLoadingIndex: boolean;
  hasVideo: boolean;
  hasFrame: boolean;
  onChooseVideo: () => void;
  onProcess: () => void;
  onStop: () => void;
  onReset: () => void;
  selectedVideo: File | null;
  videoMetadata: { duration: number; width: number; height: number } | null;
  hashStatus: string | null;
  hashCount: number | null;
  progress: { processed: number; total: number };
  progressPercent: number;
  error: string | null;
  mounted: boolean;
  isAuthenticated: boolean;
}

export function ScanControlsSidebar(props: ScanControlsProps) {
  const hashScopeLabel =
    props.scanFilter === "all"
      ? "all games"
      : GAME_LABELS[props.scanFilter];

  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <Label>Scan Scope</Label>
        <Select
          value={props.scanFilter}
          onValueChange={(v) => props.onScanFilterChange(v as ScanFilter)}
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

      {!props.detectionOnly && (
        <>
          <div className="space-y-3 rounded-xl border bg-muted/30 p-4">
            <div className="space-y-1">
              <Label>Sample Rate</Label>
              <div className="flex items-center justify-between text-sm text-muted-foreground">
                <span>{props.sampleFps.toFixed(1)} fps</span>
                <span>Higher is heavier</span>
              </div>
            </div>
            <Slider
              value={props.sampleFpsValue}
              min={2}
              max={80}
              step={1}
              onValueChange={props.onSampleFpsChange}
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
              value={props.maxFrames}
              onChange={(e) => props.onMaxFramesChange(e.target.value)}
              placeholder="60"
            />
          </div>
        </>
      )}

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={props.detectionOnly}
          onChange={(e) => props.onDetectionOnlyChange(e.target.checked)}
          className="rounded border-gray-300"
        />
        Detection only (skip matching)
      </label>

      <div className="flex flex-wrap gap-2">
        <Button type="button" onClick={props.onChooseVideo} className="gap-2">
          <Upload className="h-4 w-4" />
          Import Video
        </Button>
        {props.isProcessing ? (
          <Button
            type="button"
            variant="secondary"
            onClick={props.onStop}
            className="gap-2"
          >
            <Square className="h-4 w-4" />
            Stop
          </Button>
        ) : (
          <Button
            type="button"
            variant="secondary"
            onClick={props.onProcess}
            disabled={!props.hasVideo || props.isLoadingIndex}
            className="gap-2"
          >
            {props.isLoadingIndex ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Play className="h-4 w-4" />
            )}
            {props.detectionOnly
              ? "Start Live Detection"
              : "Process In Browser"}
          </Button>
        )}
        <Button
          type="button"
          variant="outline"
          onClick={props.onReset}
          disabled={!props.hasVideo && !props.hasFrame}
        >
          Reset
        </Button>
      </div>

      {props.selectedVideo ? (
        <div className="rounded-lg border bg-background px-3 py-2 text-sm">
          <p className="font-medium">{props.selectedVideo.name}</p>
          <p className="text-muted-foreground">
            {(props.selectedVideo.size / 1024 / 1024).toFixed(2)} MB
          </p>
          {props.videoMetadata ? (
            <p className="text-muted-foreground">
              {formatSeconds(props.videoMetadata.duration)} ·{" "}
              {props.videoMetadata.width}x{props.videoMetadata.height}
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
          {props.hashStatus ?? "The browser index is ready."}
        </p>
        <div className="flex flex-wrap gap-2">
          {props.hashCount !== null ? (
            <Badge variant="outline">
              {props.hashCount.toLocaleString()} hashes loaded
            </Badge>
          ) : null}
          <Badge variant="secondary">{hashScopeLabel}</Badge>
        </div>
      </div>

      <div className="space-y-2 rounded-xl border bg-muted/30 p-4 text-sm">
        <div className="flex items-center justify-between">
          <span className="font-medium">Progress</span>
          <span className="text-muted-foreground">
            {props.progress.total > 0
              ? `${props.progress.processed.toLocaleString()} / ${props.progress.total.toLocaleString()}`
              : props.progress.processed > 0
                ? `${props.progress.processed.toLocaleString()} frames (live)`
                : "—"}
          </span>
        </div>
        {props.progress.total > 0 && (
          <div className="h-2 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-primary transition-[width]"
              style={{ width: `${props.progressPercent}%` }}
            />
          </div>
        )}
      </div>

      {props.mounted && (props.error || !props.isAuthenticated) && (
        <div className="rounded-lg border border-rose-300 bg-rose-50 px-3 py-2 text-sm text-rose-900">
          <div className="flex items-center gap-2">
            <AlertCircle className="h-4 w-4" />
            <span>
              {props.error ??
                "Sign in to download the scan hashes and process video locally."}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------- Video Player with Overlay ----------

export function VideoPlayerWithOverlay({
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

// ---------- Active Tracks Panel ----------

export function ActiveTracksPanel({
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

// ---------- Timeline Panel ----------

export function TimelinePanel({
  timeline,
}: {
  timeline: VideoTimelineItem[];
}) {
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
