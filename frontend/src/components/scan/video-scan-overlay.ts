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

/** Max detection overlays shown at once. */
const MAX_DETECTION_OVERLAYS = 6;

/**
 * Build overlay items for detection-only mode (no matching, just quads).
 *
 * Refined quads are shown in blue; raw (unrefined) proposals are shown in
 * faint gray so the user can see what regions the system is scanning.
 */
export function buildDetectionOverlayItems(
  frameState: VideoScanFrameState,
  metadata: { width: number; height: number },
  viewportRect: VideoViewportRect,
): VideoOverlayItem[] {
  // Sort: refined first, then raw proposals
  const sorted = [...frameState.proposalMatches].sort((a, b) => {
    if (a.refinementMethod && !b.refinementMethod) return -1;
    if (!a.refinementMethod && b.refinementMethod) return 1;
    return 0;
  });

  return sorted.slice(0, MAX_DETECTION_OVERLAYS).map(
    (pm: BrowserVideoProposalMatch, index: number) => {
      const quad = mapQuadToViewport(pm.overlayQuad, metadata, viewportRect);
      const labelPoint = quad[0] ?? { x: 0, y: 0 };
      const isRefined = pm.refinementMethod !== null;
      const methodLabel = isRefined
        ? `${pm.refinementMethod}${pm.isClipped ? " (clipped)" : ""}`
        : pm.proposal.label;

      // Refined quads: blue/yellow. Raw proposals: faint gray.
      let strokeColor: string;
      let fillColor: string;
      if (!isRefined) {
        strokeColor = "rgba(148, 163, 184, 0.4)";
        fillColor = "rgba(148, 163, 184, 0.03)";
      } else if (pm.isClipped) {
        strokeColor = "rgba(251, 191, 36, 0.95)";
        fillColor = "rgba(251, 191, 36, 0.08)";
      } else {
        strokeColor = "rgba(96, 165, 250, 0.95)";
        fillColor = "rgba(96, 165, 250, 0.08)";
      }

      return {
        key: `detect:${index}`,
        polygonPoints: quad
          .map((point) => `${point.x.toFixed(1)},${point.y.toFixed(1)}`)
          .join(" "),
        label: isRefined ? `${methodLabel}` : "",
        labelStyle: {
          left: labelPoint.x + 8,
          top: Math.max(6, labelPoint.y - 22),
        },
        match: null,
        strokeColor,
        fillColor,
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
    const quad = mapQuadToViewport(track.overlayQuad, metadata, viewportRect);
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
