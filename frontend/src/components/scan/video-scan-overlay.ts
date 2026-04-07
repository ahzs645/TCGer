import type {
  BrowserVideoProposalMatch,
  BrowserVideoScanCandidate,
  VideoQuad,
} from "@/lib/scan/browser-video-matcher";

import type {
  VideoOverlayItem,
  VideoScanFrameState,
  VideoTrack,
  VideoViewportRect,
} from "./video-scan-types";

// ---------- viewport geometry ----------

/**
 * Compute the contained (object-fit: contain) rect of a video inside its element.
 */
export function computeContainedVideoRect(
  video: HTMLVideoElement,
  metadata: { width: number; height: number } | null,
): VideoViewportRect | null {
  const containerWidth = video.clientWidth;
  const containerHeight = video.clientHeight;

  if (
    !metadata ||
    metadata.width <= 0 ||
    metadata.height <= 0 ||
    containerWidth <= 0 ||
    containerHeight <= 0
  ) {
    return null;
  }

  const sourceAspect = metadata.width / metadata.height;
  const containerAspect = containerWidth / containerHeight;

  if (!Number.isFinite(sourceAspect) || !Number.isFinite(containerAspect)) {
    return null;
  }

  if (sourceAspect > containerAspect) {
    const width = containerWidth;
    const height = width / sourceAspect;
    return {
      left: 0,
      top: (containerHeight - height) / 2,
      width,
      height,
    };
  }

  const height = containerHeight;
  const width = height * sourceAspect;
  return {
    left: (containerWidth - width) / 2,
    top: 0,
    width,
    height,
  };
}

/**
 * Map a quad from frame coordinates to viewport pixel coordinates.
 */
export function mapQuadToViewport(
  quad: VideoQuad,
  metadata: { width: number; height: number },
  viewportRect: VideoViewportRect,
): VideoQuad {
  return quad.map((point) => ({
    x: viewportRect.left + (point.x / metadata.width) * viewportRect.width,
    y: viewportRect.top + (point.y / metadata.height) * viewportRect.height,
  })) as VideoQuad;
}

// ---------- palette ----------

export function getOverlayPalette(
  match: BrowserVideoScanCandidate | null,
): {
  strokeColor: string;
  fillColor: string;
} {
  if (!match) {
    return {
      strokeColor: "rgba(203, 213, 225, 0.95)",
      fillColor: "rgba(148, 163, 184, 0.08)",
    };
  }

  if (match.passedThreshold && match.confidence >= 0.8) {
    return {
      strokeColor: "rgba(74, 222, 128, 0.98)",
      fillColor: "rgba(74, 222, 128, 0.12)",
    };
  }

  if (match.passedThreshold) {
    return {
      strokeColor: "rgba(251, 191, 36, 0.98)",
      fillColor: "rgba(251, 191, 36, 0.12)",
    };
  }

  return {
    strokeColor: "rgba(251, 113, 133, 0.98)",
    fillColor: "rgba(251, 113, 133, 0.1)",
  };
}

// ---------- overlay item builders ----------

/**
 * Build overlay items for detection-only mode.
 * Only refined quads arrive here (scan-frame already filters + deduplicates).
 */
export function buildDetectionOverlayItems(
  frameState: VideoScanFrameState,
  metadata: { width: number; height: number },
  viewportRect: VideoViewportRect,
): VideoOverlayItem[] {
  return frameState.proposalMatches.map(
    (pm: BrowserVideoProposalMatch, index: number) => {
      const quad = mapQuadToViewport(pm.overlayQuad, metadata, viewportRect);
      const labelPoint = quad[0] ?? { x: 0, y: 0 };
      const methodLabel = pm.refinementMethod
        ? `${pm.refinementMethod}${pm.isClipped ? " (clipped)" : ""}`
        : "detected";

      return {
        key: `detect:${index}`,
        polygonPoints: quad
          .map((point) => `${point.x.toFixed(1)},${point.y.toFixed(1)}`)
          .join(" "),
        label: methodLabel,
        labelStyle: {
          left: labelPoint.x + 8,
          top: Math.max(6, labelPoint.y - 22),
        },
        match: null,
        strokeColor: pm.isClipped
          ? "rgba(251, 191, 36, 0.95)"
          : "rgba(96, 165, 250, 0.95)",
        fillColor: pm.isClipped
          ? "rgba(251, 191, 36, 0.08)"
          : "rgba(96, 165, 250, 0.08)",
      };
    },
  );
}

/**
 * Build overlay items from tracked matches (normal mode).
 */
export function buildTrackOverlayItems(
  tracks: VideoTrack[],
  metadata: { width: number; height: number },
  viewportRect: VideoViewportRect,
): VideoOverlayItem[] {
  return tracks.map((track, index) => {
    // Use the smoothed quad for rendering (EMA-filtered, no jitter)
    const quad = mapQuadToViewport(track.smoothedQuad, metadata, viewportRect);
    const palette = getOverlayPalette(track.match);
    const labelPoint = quad[0] ?? { x: 0, y: 0 };

    return {
      key: `${track.id}:${track.match.externalId}:${index}`,
      polygonPoints: quad
        .map((point) => `${point.x.toFixed(1)},${point.y.toFixed(1)}`)
        .join(" "),
      label: `#${index + 1}${track.match ? ` · ${track.match.name}` : ""}`,
      labelStyle: {
        left: labelPoint.x + 8,
        top: Math.max(6, labelPoint.y - 22),
      },
      match: track.match,
      strokeColor: palette.strokeColor,
      fillColor: palette.fillColor,
    };
  });
}
