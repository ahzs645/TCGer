import type { CSSProperties } from "react";
import type {
  BrowserVideoFrameScanResult,
  BrowserVideoScanCandidate,
  VideoQuad,
  VideoWindowProposal,
} from "@/lib/scan/browser-video-matcher";
import type { TcgCode } from "@/types/card";

// ---------- filter type ----------

export type ScanFilter = TcgCode | "all";

// ---------- state types ----------

export interface VideoScanProgress {
  processed: number;
  total: number;
}

export interface VideoScanFrameState extends BrowserVideoFrameScanResult {
  timestampSeconds: number;
}

export interface VideoTimelineItem {
  id: string;
  trackId: number;
  timestampSeconds: number;
  match: BrowserVideoScanCandidate;
  proposal: VideoWindowProposal | null;
}

export interface VideoTrack {
  id: number;
  proposal: VideoWindowProposal;
  overlayQuad: VideoQuad;
  /** Smoothed quad for rendering (EMA-filtered to prevent jitter). */
  smoothedQuad: VideoQuad;
  refinementMethod: string | null;
  isClipped: boolean;
  match: BrowserVideoScanCandidate;
  lastSeenSeconds: number;
  seenFrames: number;
  stableFrames: number;
  missedFrames: number;
  /** Accumulated match votes: externalId → { count, totalConfidence, bestMatch }. */
  matchVotes: Map<string, MatchVote>;
}

export interface MatchVote {
  count: number;
  totalConfidence: number;
  bestMatch: BrowserVideoScanCandidate;
}

export interface VideoOverlayItem {
  key: string;
  polygonPoints: string;
  label: string;
  labelStyle: CSSProperties;
  match: BrowserVideoScanCandidate | null;
  strokeColor: string;
  fillColor: string;
}

export interface VideoViewportRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

// ---------- constants ----------

export const HASH_PAGE_SIZE = 2000;
export const MAX_TIMELINE_ITEMS = 24;
export const DEFAULT_SAMPLE_FPS = 1;
export const DEFAULT_MAX_FRAMES = 60;
export const MAX_FRAME_LONG_SIDE = 960;
export const TRACK_ASSOCIATION_IOU = 0.25;
export const TRACK_MISS_TTL = 2;
export const MIN_TRACK_STABLE_FRAMES = 2;
export const MIN_IMMEDIATE_TRACK_CONFIDENCE = 0.84;

// ---------- format helpers ----------

export function formatSeconds(seconds: number): string {
  const wholeSeconds = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(wholeSeconds / 60);
  const remainingSeconds = wholeSeconds % 60;
  return `${minutes}:${remainingSeconds.toString().padStart(2, "0")}`;
}

export function formatMatchScore(confidence: number): string {
  return `${Math.round(confidence * 100)}%`;
}

export function getCandidateTone(
  candidate: BrowserVideoScanCandidate | null,
): string {
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
