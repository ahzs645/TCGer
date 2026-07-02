"use client";

/**
 * Scan Review Lab (dev tool).
 *
 * Scrub a local video with the offline pipeline's results overlaid: YOLO
 * boxes, per-box identification, gate decisions, and an identification
 * timeline compared against a ground-truth fixture — so gaps ("cards the
 * scanner missed") are visible at a glance and one click away.
 *
 * Inputs:
 *  - the video file itself (never uploaded; object URL only)
 *  - a results JSON from backend `live-video-stream-scan.ts`
 *  - optionally a ground-truth fixture (video-recognition-ground-truth)
 *
 * Preprocess example (1 fps, full-res crops, gate, fast native backend):
 *   npm --prefix backend run scan:video-live-stream -- \
 *     --video <video.mp4> --sample-seconds 1 \
 *     --gate backend/fixtures/models/card-face-rejection-gate-dinov2.v1.json \
 *     --full-res-crops --native-backend --out-dir /tmp/scan-review
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Upload } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

// ---------- results / ground-truth file shapes ----------

interface ResultCandidate {
  externalId: string;
  name: string;
  setCode?: string | null;
  confidence: number;
  passedThreshold?: boolean;
  proposalLabel?: string;
}

interface ResultProposalMatch {
  cardFaceScore?: number | null;
  proposal: {
    label: string;
    left: number;
    top: number;
    width: number;
    height: number;
  };
  bestMatch: ResultCandidate | null;
  candidates: ResultCandidate[];
}

interface ResultFrame {
  timestampSeconds: number;
  bestMatch: ResultCandidate | null;
  proposalMatches: ResultProposalMatch[];
  yoloDetections?: Array<{
    confidence: number;
    cx: number;
    cy: number;
    width: number;
    height: number;
    angle: number;
  }>;
}

interface ScanResults {
  summary: {
    video?: string;
    sampleSeconds: number;
    frames: number;
    fullResCrops?: boolean;
    rejectionGate?: { threshold: number; rejectedBoxes: number } | null;
  };
  frames: ResultFrame[];
}

interface GroundTruthWindow {
  id: string;
  startSeconds: number;
  endSeconds: number;
  name: string;
  acceptedNames?: string[];
  expectedExternalIds?: string[];
  tags?: string[];
}

interface GroundTruth {
  name?: string;
  windows: GroundTruthWindow[];
}

// ---------- helpers ----------

const GT_TOLERANCE_SECONDS = 5;

function normName(value: string | null | undefined): string {
  return (value ?? "")
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Stable hue per card so timeline segments/boxes are visually trackable. */
function hueFor(key: string): number {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) % 360;
  return h;
}

interface IdSegment {
  name: string;
  externalId: string;
  start: number;
  end: number;
  frames: number;
  maxConfidence: number;
}

/**
 * Timestamps at which each (normalized) card name is "confirmed": seen in at
 * least two observations within a small neighborhood. This is the production
 * surfacing rule — on the Sinnoh benchmark it takes per-frame precision from
 * ~88% to 100% by suppressing one-frame transition misreads.
 */
function buildConfirmation(results: ScanResults): Map<number, Set<string>> {
  const window = Math.max(results.summary.sampleSeconds * 2, 2.5) + 0.6;
  const observations = results.frames
    .filter((f) => f.bestMatch)
    .map((f) => ({ t: f.timestampSeconds, name: normName(f.bestMatch!.name) }));
  const confirmed = new Map<number, Set<string>>();
  for (const obs of observations) {
    const support = observations.filter(
      (other) => Math.abs(other.t - obs.t) <= window && other.name === obs.name,
    ).length;
    if (support >= 2) {
      let set = confirmed.get(obs.t);
      if (!set) {
        set = new Set();
        confirmed.set(obs.t, set);
      }
      set.add(obs.name);
    }
  }
  return confirmed;
}

function buildSegments(
  results: ScanResults,
  confirmation: Map<number, Set<string>> | null,
): IdSegment[] {
  // With smoothing, allow a wider merge gap so segments bridge the dropped
  // one-frame blips instead of splitting (Slowking–Shinx–Slowking → Slowking).
  const gap = Math.max(results.summary.sampleSeconds * (confirmation ? 3 : 2), 2.5);
  const segments: IdSegment[] = [];
  for (const frame of results.frames) {
    const best = frame.bestMatch;
    if (!best) continue;
    if (
      confirmation &&
      !confirmation.get(frame.timestampSeconds)?.has(normName(best.name))
    ) {
      continue;
    }
    const last = segments[segments.length - 1];
    if (
      last &&
      last.name === best.name &&
      frame.timestampSeconds - last.end <= gap
    ) {
      last.end = frame.timestampSeconds;
      last.frames += 1;
      last.maxConfidence = Math.max(last.maxConfidence, best.confidence);
    } else {
      segments.push({
        name: best.name,
        externalId: best.externalId,
        start: frame.timestampSeconds,
        end: frame.timestampSeconds,
        frames: 1,
        maxConfidence: best.confidence,
      });
    }
  }
  return segments;
}

function windowNames(window: GroundTruthWindow): Set<string> {
  const names = new Set([normName(window.name)]);
  for (const alias of window.acceptedNames ?? []) names.add(normName(alias));
  return names;
}

function windowMatched(window: GroundTruthWindow, results: ScanResults): boolean {
  const names = windowNames(window);
  return results.frames.some(
    (frame) =>
      frame.bestMatch &&
      frame.timestampSeconds >= window.startSeconds - GT_TOLERANCE_SECONDS &&
      frame.timestampSeconds <= window.endSeconds + GT_TOLERANCE_SECONDS &&
      names.has(normName(frame.bestMatch.name)),
  );
}

// ---------- component ----------

export function ScanReviewLab() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const overlayRef = useRef<HTMLCanvasElement | null>(null);
  const timelineRef = useRef<HTMLCanvasElement | null>(null);

  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [results, setResults] = useState<ScanResults | null>(null);
  const [groundTruth, setGroundTruth] = useState<GroundTruth | null>(null);
  const [status, setStatus] = useState<string>(
    "Pick the video file and a results JSON to start.",
  );
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [smoothed, setSmoothed] = useState(true);

  const confirmation = useMemo(
    () => (results && smoothed ? buildConfirmation(results) : null),
    [results, smoothed],
  );

  const segments = useMemo(
    () => (results ? buildSegments(results, confirmation) : []),
    [results, confirmation],
  );

  const scoredWindows = useMemo(
    () =>
      (groundTruth?.windows ?? []).filter(
        (w) => !(w.tags ?? []).includes("jumbo"),
      ),
    [groundTruth],
  );

  const missedWindows = useMemo(() => {
    if (!results || !groundTruth) return [];
    return scoredWindows.filter((w) => !windowMatched(w, results));
  }, [results, groundTruth, scoredWindows]);

  // ----- file loading -----

  const onVideoFile = useCallback((file: File | undefined) => {
    if (!file) return;
    setVideoUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return URL.createObjectURL(file);
    });
  }, []);

  const onResultsFile = useCallback(async (file: File | undefined) => {
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text()) as ScanResults;
      if (!Array.isArray(parsed.frames)) throw new Error("no frames[]");
      setResults(parsed);
      setStatus(
        `Loaded ${parsed.frames.length} processed frames (every ${parsed.summary.sampleSeconds}s${parsed.summary.fullResCrops ? ", full-res crops" : ""}${parsed.summary.rejectionGate ? ", gated" : ""}).`,
      );
    } catch (err) {
      setStatus(
        `Not a live-video-stream-scan results file: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }, []);

  const onGroundTruthFile = useCallback(async (file: File | undefined) => {
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text()) as GroundTruth;
      if (!Array.isArray(parsed.windows)) throw new Error("no windows[]");
      setGroundTruth(parsed);
    } catch (err) {
      setStatus(
        `Not a ground-truth fixture: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }, []);

  const loadBundled = useCallback(async () => {
    setStatus("Loading bundled Sinnoh run…");
    try {
      const [resultsRes, gtRes] = await Promise.all([
        fetch("/scan-review/sinnoh-full-1s.json"),
        fetch("/scan-review/sinnoh-ground-truth.v2.json"),
      ]);
      if (resultsRes.ok) {
        const parsed = (await resultsRes.json()) as ScanResults;
        setResults(parsed);
        setStatus(
          `Loaded bundled run: ${parsed.frames.length} frames. Now pick the matching video file.`,
        );
      } else {
        setStatus(
          "No bundled run found (frontend/public/scan-review/sinnoh-full-1s.json).",
        );
      }
      if (gtRes.ok) setGroundTruth((await gtRes.json()) as GroundTruth);
    } catch {
      setStatus("Failed to fetch the bundled run.");
    }
  }, []);

  // ----- nearest processed frame -----

  const nearestFrame = useMemo(() => {
    if (!results?.frames.length) return null;
    const sample = results.summary.sampleSeconds;
    let best: ResultFrame | null = null;
    let bestDelta = Infinity;
    for (const frame of results.frames) {
      const delta = Math.abs(frame.timestampSeconds - currentTime);
      if (delta < bestDelta) {
        bestDelta = delta;
        best = frame;
      }
    }
    return best && bestDelta <= Math.max(sample * 0.75, 0.6) ? best : null;
  }, [results, currentTime]);

  // ----- overlay drawing -----

  const drawOverlay = useCallback(() => {
    const video = videoRef.current;
    const canvas = overlayRef.current;
    if (!video || !canvas || !video.videoWidth) return;

    canvas.width = video.clientWidth;
    canvas.height = video.clientHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!results || !nearestFrame) return;

    // Detection coords are in the processed-frame space: native pixels when
    // the run used --full-res-crops, else the 640-max-dim downscale.
    const sourceWidth = results.summary.fullResCrops
      ? video.videoWidth
      : video.videoWidth >= video.videoHeight
        ? 640
        : Math.round((video.videoWidth / video.videoHeight) * 640);
    const scale = canvas.width / sourceWidth;
    const gateThreshold = results.summary.rejectionGate?.threshold ?? null;

    // Boxes 3+ were detected but never embedded (harness embeds top-2 only).
    for (const det of (nearestFrame.yoloDetections ?? []).slice(2)) {
      ctx.strokeStyle = "rgba(148,163,184,0.8)";
      ctx.setLineDash([4, 4]);
      ctx.lineWidth = 1.5;
      ctx.strokeRect(
        (det.cx - det.width / 2) * scale,
        (det.cy - det.height / 2) * scale,
        det.width * scale,
        det.height * scale,
      );
      ctx.setLineDash([]);
    }

    for (const pm of nearestFrame.proposalMatches) {
      const { left, top, width, height } = pm.proposal;
      const x = left * scale;
      const y = top * scale;
      const w = width * scale;
      const h = height * scale;

      const gated =
        gateThreshold !== null &&
        typeof pm.cardFaceScore === "number" &&
        pm.cardFaceScore < gateThreshold;
      const identified =
        !gated &&
        pm.bestMatch !== null &&
        pm.bestMatch.passedThreshold === true &&
        !pm.bestMatch.externalId.startsWith("yolo-");

      let label: string;
      if (gated) {
        ctx.strokeStyle = "rgba(248,113,113,0.95)";
        ctx.setLineDash([6, 4]);
        label = `not a card face (${pm.cardFaceScore?.toFixed(2)})`;
      } else if (identified && pm.bestMatch) {
        const rawName = normName(pm.bestMatch.name);
        const isConfirmed =
          !confirmation ||
          confirmation.get(nearestFrame.timestampSeconds)?.has(rawName) === true;
        if (isConfirmed) {
          ctx.strokeStyle = `hsl(${hueFor(pm.bestMatch.externalId)} 90% 55%)`;
          ctx.setLineDash([]);
          label = `${pm.bestMatch.name} ${(pm.bestMatch.confidence * 100).toFixed(0)}%`;
        } else {
          // One-frame blip: hold the surrounding stable identification if a
          // smoothed segment covers this moment, else fall back to "detected".
          const held = segments.find(
            (s) =>
              nearestFrame.timestampSeconds >= s.start - 2 &&
              nearestFrame.timestampSeconds <= s.end + 2,
          );
          if (held) {
            ctx.strokeStyle = `hsl(${hueFor(held.externalId)} 90% 55%)`;
            ctx.setLineDash([2, 3]);
            label = `${held.name} (held — raw: ${pm.bestMatch.name})`;
          } else {
            ctx.strokeStyle = "rgba(250,204,21,0.95)";
            ctx.setLineDash([]);
            label = `card detected (unconfirmed: ${pm.bestMatch.name})`;
          }
        }
      } else {
        ctx.strokeStyle = "rgba(250,204,21,0.95)";
        ctx.setLineDash([]);
        label = "card detected";
      }

      ctx.lineWidth = 2.5;
      ctx.strokeRect(x, y, w, h);
      ctx.setLineDash([]);

      ctx.font = "600 12px ui-sans-serif, system-ui";
      const metrics = ctx.measureText(label);
      const ly = Math.max(14, y - 6);
      ctx.fillStyle = "rgba(15,23,42,0.85)";
      ctx.fillRect(x, ly - 12, metrics.width + 10, 16);
      ctx.fillStyle = "#fff";
      ctx.fillText(label, x + 5, ly);
    }
  }, [results, nearestFrame, confirmation, segments]);

  // ----- timeline drawing -----

  const drawTimeline = useCallback(() => {
    const canvas = timelineRef.current;
    if (!canvas || !duration) return;
    const width = canvas.clientWidth;
    canvas.width = width;
    canvas.height = 76;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const x = (t: number) => (t / duration) * width;
    ctx.fillStyle = "rgba(30,41,59,0.6)";
    ctx.fillRect(0, 0, width, canvas.height);

    // Row 1 (y 6..30): identification segments, colored per card.
    for (const seg of segments) {
      ctx.fillStyle = `hsl(${hueFor(seg.externalId)} 85% 55%)`;
      ctx.fillRect(x(seg.start), 6, Math.max(2, x(seg.end) - x(seg.start) + 2), 24);
    }

    // Row 2 (y 40..64): ground-truth windows — green matched, red missed.
    if (results) {
      for (const w of scoredWindows) {
        const matched = !missedWindows.includes(w);
        ctx.fillStyle = matched
          ? "rgba(74,222,128,0.85)"
          : "rgba(248,113,113,0.95)";
        ctx.fillRect(
          x(w.startSeconds),
          40,
          Math.max(2, x(w.endSeconds) - x(w.startSeconds)),
          24,
        );
      }
    }

    // Cursor.
    ctx.fillStyle = "#fff";
    ctx.fillRect(x(currentTime) - 1, 0, 2, canvas.height);
  }, [duration, segments, results, scoredWindows, missedWindows, currentTime]);

  useEffect(() => {
    drawOverlay();
    drawTimeline();
  }, [drawOverlay, drawTimeline]);

  // Keep the overlay live while playing.
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const video = videoRef.current;
      if (video && !video.paused && !video.ended) {
        setCurrentTime(video.currentTime);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  const seekTo = useCallback((seconds: number) => {
    const video = videoRef.current;
    if (!video) return;
    video.currentTime = Math.max(0, seconds);
    setCurrentTime(video.currentTime);
  }, []);

  const onTimelineClick = useCallback(
    (event: React.MouseEvent<HTMLCanvasElement>) => {
      const canvas = timelineRef.current;
      if (!canvas || !duration) return;
      const rect = canvas.getBoundingClientRect();
      seekTo(((event.clientX - rect.left) / rect.width) * duration);
    },
    [duration, seekTo],
  );

  const stepSample = useCallback(
    (direction: 1 | -1) => {
      const sample = results?.summary.sampleSeconds ?? 1;
      seekTo(currentTime + direction * sample);
    },
    [results, currentTime, seekTo],
  );

  const fmt = (t: number) =>
    `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, "0")}`;

  // ----- render -----

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <label className="inline-flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm hover:bg-accent">
          <Upload className="h-4 w-4" /> Video file
          <input
            type="file"
            accept="video/*"
            className="hidden"
            onChange={(e) => onVideoFile(e.target.files?.[0])}
          />
        </label>
        <label className="inline-flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm hover:bg-accent">
          <Upload className="h-4 w-4" /> Results JSON
          <input
            type="file"
            accept="application/json"
            className="hidden"
            onChange={(e) => onResultsFile(e.target.files?.[0])}
          />
        </label>
        <label className="inline-flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm hover:bg-accent">
          <Upload className="h-4 w-4" /> Ground truth (optional)
          <input
            type="file"
            accept="application/json"
            className="hidden"
            onChange={(e) => onGroundTruthFile(e.target.files?.[0])}
          />
        </label>
        <Button variant="secondary" size="sm" onClick={loadBundled}>
          Load bundled Sinnoh run
        </Button>
        <label className="inline-flex cursor-pointer items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={smoothed}
            onChange={(e) => setSmoothed(e.target.checked)}
          />
          Smoothed (2-frame vote)
        </label>
        <span className="text-xs text-muted-foreground">{status}</span>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(260px,1fr)]">
        <div className="space-y-2">
          <div className="relative overflow-hidden rounded-lg border bg-black">
            {videoUrl ? (
              <>
                <video
                  ref={videoRef}
                  src={videoUrl}
                  controls
                  className="w-full"
                  onLoadedMetadata={(e) =>
                    setDuration(e.currentTarget.duration || 0)
                  }
                  onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
                  onSeeked={(e) => setCurrentTime(e.currentTarget.currentTime)}
                />
                <canvas
                  ref={overlayRef}
                  className="pointer-events-none absolute inset-0"
                />
              </>
            ) : (
              <div className="flex h-64 items-center justify-center text-sm text-muted-foreground">
                No video loaded
              </div>
            )}
          </div>

          <canvas
            ref={timelineRef}
            className="h-[76px] w-full cursor-crosshair rounded-md border"
            onClick={onTimelineClick}
            title="Top row: scanner identifications. Bottom row: ground-truth windows (green = matched, red = missed). Click to seek."
          />
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Button variant="outline" size="sm" onClick={() => stepSample(-1)}>
              ◀ sample
            </Button>
            <Button variant="outline" size="sm" onClick={() => stepSample(1)}>
              sample ▶
            </Button>
            <span>
              {fmt(currentTime)} / {fmt(duration)}
            </span>
            <span className="ml-auto">
              top row = identifications · bottom row = ground truth (red =
              missed)
            </span>
          </div>
        </div>

        <div className="space-y-4">
          <div className="rounded-lg border p-3">
            <div className="mb-2 flex items-center gap-2 text-sm font-medium">
              Nearest processed frame
              {nearestFrame ? (
                <Badge variant="outline">{fmt(nearestFrame.timestampSeconds)}</Badge>
              ) : (
                <Badge variant="outline">none</Badge>
              )}
            </div>
            {nearestFrame ? (
              <div className="space-y-2 text-xs">
                {nearestFrame.proposalMatches.length === 0 && (
                  <div className="text-muted-foreground">No detections.</div>
                )}
                {nearestFrame.proposalMatches.map((pm, i) => {
                  const gateThreshold =
                    results?.summary.rejectionGate?.threshold ?? null;
                  const gated =
                    gateThreshold !== null &&
                    typeof pm.cardFaceScore === "number" &&
                    pm.cardFaceScore < gateThreshold;
                  return (
                    <div key={i} className="rounded border p-2">
                      <div className="font-medium">
                        box {i + 1}
                        {typeof pm.cardFaceScore === "number" &&
                          ` · face ${pm.cardFaceScore.toFixed(2)}`}
                        {gated && " · REJECTED by gate"}
                      </div>
                      {pm.candidates.slice(0, 3).map((c) => (
                        <div key={c.externalId} className="flex justify-between">
                          <span>
                            {c.name}{" "}
                            <span className="text-muted-foreground">
                              {c.externalId}
                            </span>
                          </span>
                          <span>{(c.confidence * 100).toFixed(1)}%</span>
                        </div>
                      ))}
                      {!gated && pm.candidates.length === 0 && (
                        <div className="text-muted-foreground">
                          no candidates (skipped or unidentified)
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="text-xs text-muted-foreground">
                No processed frame near this time
                {results
                  ? ` (sampled every ${results.summary.sampleSeconds}s).`
                  : "."}
              </div>
            )}
          </div>

          {groundTruth && results && (
            <div className="rounded-lg border p-3">
              <div className="mb-2 text-sm font-medium">
                Missed ground-truth cards ({missedWindows.length}/
                {scoredWindows.length})
              </div>
              {missedWindows.length === 0 ? (
                <div className="text-xs text-muted-foreground">
                  Every scored window has a matching identification.
                </div>
              ) : (
                <div className="max-h-56 space-y-1 overflow-y-auto text-xs">
                  {missedWindows.map((w) => (
                    <button
                      key={w.id}
                      className="flex w-full justify-between rounded border px-2 py-1 text-left hover:bg-accent"
                      onClick={() => seekTo(w.startSeconds)}
                    >
                      <span>{w.name}</span>
                      <span className="text-muted-foreground">
                        {fmt(w.startSeconds)}–{fmt(w.endSeconds)}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {results && (
            <div className="rounded-lg border p-3">
              <div className="mb-2 text-sm font-medium">
                Identified cards ({segments.length} segments)
              </div>
              <div className="max-h-72 space-y-1 overflow-y-auto text-xs">
                {segments.map((seg, i) => (
                  <button
                    key={`${seg.externalId}-${i}`}
                    className="flex w-full items-center gap-2 rounded border px-2 py-1 text-left hover:bg-accent"
                    onClick={() => seekTo(seg.start)}
                  >
                    <span
                      className="h-3 w-3 shrink-0 rounded-sm"
                      style={{
                        background: `hsl(${hueFor(seg.externalId)} 85% 55%)`,
                      }}
                    />
                    <span className="truncate">{seg.name}</span>
                    <span className="ml-auto whitespace-nowrap text-muted-foreground">
                      {fmt(seg.start)} · {seg.frames}f ·{" "}
                      {(seg.maxConfidence * 100).toFixed(0)}%
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
