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
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn, GAME_LABELS } from "@/lib/utils";
import type { DeckResponse } from "@/lib/api/decks";
import type { ScannerPrintingMode } from "@/lib/scan/scanner-options";

import {
  formatMatchScore,
  formatSeconds,
  getCandidateTone,
  type ScanFilter,
  type VideoOverlayItem,
  type VideoScanFrameState,
  type VideoTimelineItem,
  type VideoTrack,
} from "./video-scan-types";

// ---------- Controls Sidebar ----------

export interface ScanControlsProps {
  scanFilter: ScanFilter;
  onScanFilterChange: (filter: ScanFilter) => void;
  yugiohDecks: DeckResponse[];
  selectedDeckId: string;
  onSelectedDeckIdChange: (deckId: string) => void;
  deckStatus: string | null;
  detectionOnly: boolean;
  onDetectionOnlyChange: (value: boolean) => void;
  embeddingMode: boolean;
  onEmbeddingModeChange: (value: boolean) => void;
  printingMode: ScannerPrintingMode;
  onPrintingModeChange: (value: ScannerPrintingMode) => void;
  analysisIntervalMs: number;
  onAnalysisIntervalChange: (value: number) => void;
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
    props.scanFilter === "all" ? "all games" : GAME_LABELS[props.scanFilter];

  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <Label htmlFor="video-scan-scope">Scan Scope</Label>
        <Select
          value={props.scanFilter}
          onValueChange={(v) => props.onScanFilterChange(v as ScanFilter)}
        >
          <SelectTrigger id="video-scan-scope">
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
          Recommended: select one TCG before downloading its visual index into
          the browser.
        </p>
      </div>

      {props.scanFilter === "yugioh" ? (
        <div className="space-y-2 rounded-xl border border-amber-500/30 bg-amber-500/5 p-3">
          <Label htmlFor="video-scan-gallery">Recognition Gallery</Label>
          <Select
            value={props.selectedDeckId}
            onValueChange={props.onSelectedDeckIdChange}
            disabled={
              props.isProcessing || props.detectionOnly || !props.embeddingMode
            }
          >
            <SelectTrigger id="video-scan-gallery">
              <SelectValue placeholder="Choose a gallery" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="full_catalog">
                Full Yu-Gi-Oh catalog
              </SelectItem>
              {props.yugiohDecks.map((deck) => {
                const identities = new Set(
                  deck.cards.map((card) => card.externalId.toLowerCase()),
                ).size;
                return (
                  <SelectItem key={deck.id} value={deck.id}>
                    Deck Scan · {deck.name} ({identities})
                  </SelectItem>
                );
              })}
            </SelectContent>
          </Select>
          {props.detectionOnly ? (
            <p className="text-xs text-muted-foreground">
              Detection-only mode outlines cards and skips every recognition
              gallery.
            </p>
          ) : !props.embeddingMode ? (
            <p className="text-xs text-muted-foreground">
              Deck Scan requires the on-device ArcFace model.
            </p>
          ) : props.selectedDeckId === "full_catalog" ? (
            <p className="text-xs text-muted-foreground">
              {props.deckStatus ??
                "Full-catalog matching remains active. Sign in to select one of your Yu-Gi-Oh decks."}
            </p>
          ) : (
            <p className="text-xs text-amber-900 dark:text-amber-200">
              Deck Scan searches only the selected deck and may still abstain.
              Its results are deck-restricted, not full-catalog accuracy.
            </p>
          )}
        </div>
      ) : null}

      <div className="space-y-1">
        <label className="flex items-center gap-2 text-sm font-medium">
          <input
            type="checkbox"
            checked={props.embeddingMode}
            onChange={(e) => props.onEmbeddingModeChange(e.target.checked)}
            disabled={props.detectionOnly}
            className="rounded border-gray-300"
          />
          On-device ArcFace model
          <Badge variant="secondary" className="ml-1">
            Recommended
          </Badge>
        </label>
        <p className="pl-6 text-xs text-muted-foreground">
          Runs fully in your browser — no sign-in or server needed. Best
          accuracy. Published indexes are available for Pokémon, Magic: The
          Gathering, and Yu-Gi-Oh!.
        </p>
      </div>

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={props.detectionOnly}
          onChange={(e) => props.onDetectionOnlyChange(e.target.checked)}
          className="rounded border-gray-300"
        />
        Detection only (outlines, skip matching)
      </label>

      <div className="space-y-2">
        <Label htmlFor="scanner-printing-mode">Printing</Label>
        <Select
          value={props.printingMode}
          onValueChange={(value) =>
            props.onPrintingModeChange(value as ScannerPrintingMode)
          }
        >
          <SelectTrigger id="scanner-printing-mode">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="quick_latest">Quick Scan</SelectItem>
            <SelectItem value="exact_printing">Exact Printing</SelectItem>
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">
          {props.printingMode === "quick_latest"
            ? "Uses verified print details when available; otherwise selects the newest printing in the artwork family."
            : "Stops on visually identical printings so you can choose the set."}
        </p>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between gap-3 text-sm">
          <Label htmlFor="scanner-analysis-interval">Analysis interval</Label>
          <span className="tabular-nums text-muted-foreground">
            {props.analysisIntervalMs} ms
          </span>
        </div>
        <input
          id="scanner-analysis-interval"
          type="range"
          min={100}
          max={2000}
          step={50}
          value={props.analysisIntervalMs}
          onChange={(event) =>
            props.onAnalysisIntervalChange(Number(event.target.value))
          }
          disabled={props.isProcessing}
          className="w-full accent-primary"
        />
        <p className="text-xs text-muted-foreground">
          Minimum time between analyzed video frames. Shorter intervals are more
          responsive and use more CPU.
        </p>
      </div>

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

      {props.mounted &&
        (props.error ||
          (!props.isAuthenticated &&
            !props.embeddingMode &&
            !props.detectionOnly)) && (
          <div className="rounded-lg border border-rose-300 bg-rose-50 px-3 py-2 text-sm text-rose-900">
            <div className="flex items-center gap-2">
              <AlertCircle className="h-4 w-4" />
              <span>
                {props.error ??
                  "Sign in to use the legacy server-backed hash matcher."}
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
        ref={videoRef}
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

          {primaryCandidate.requiresPrintingChoice ? (
            <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm">
              This artwork has multiple printings. Exact Printing mode requires
              you to choose the set before adding it.
            </div>
          ) : primaryCandidate.printingResolutionProvenance ===
            "latest_fallback" ? (
            <p className="text-xs text-muted-foreground">
              Exact print details were unreadable, so Quick Scan selected the
              newest compatible printing.
            </p>
          ) : null}

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

export function TimelinePanel({ timeline }: { timeline: VideoTimelineItem[] }) {
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
