import type {
  BrowserVideoProposalMatch,
  BrowserVideoScanCandidate,
  VideoWindowProposal,
} from "@/lib/scan/browser-video-matcher";

import {
  TRACK_ASSOCIATION_IOU,
  TRACK_MISS_TTL,
  type VideoTimelineItem,
  type VideoTrack,
} from "./video-scan-types";

/**
 * Reconcile incoming per-frame proposal detections with existing tracks.
 *
 * Associates new detections to existing tracks by spatial IOU + card identity,
 * creates new tracks for unmatched detections, and expires stale tracks.
 */
export function reconcileVideoTracks(
  existingTracks: VideoTrack[],
  proposalMatches: BrowserVideoProposalMatch[],
  timestampSeconds: number,
  nextTrackId: number,
): {
  tracks: VideoTrack[];
  timelineEntries: VideoTimelineItem[];
  nextTrackId: number;
} {
  const detections = proposalMatches
    .filter(
      (
        proposalMatch,
      ): proposalMatch is BrowserVideoProposalMatch & {
        bestMatch: BrowserVideoScanCandidate;
      } =>
        proposalMatch.bestMatch !== null &&
        proposalMatch.bestMatch.passedThreshold,
    )
    .sort((left, right) => {
      return (
        right.bestMatch.confidence - left.bestMatch.confidence ||
        left.bestMatch.scoreDistance - right.bestMatch.scoreDistance
      );
    });

  const tracks = existingTracks.map((track) => ({
    ...track,
    missedFrames: track.missedFrames + 1,
  }));
  const assignedTrackIds = new Set<number>();
  const timelineEntries: VideoTimelineItem[] = [];
  let currentNextTrackId = nextTrackId;

  for (const detection of detections) {
    const detectionKey = `${detection.bestMatch.tcg}:${detection.bestMatch.externalId}`;
    let bestTrackIndex = -1;
    let bestAssociationScore = -1;

    for (const [index, track] of tracks.entries()) {
      if (assignedTrackIds.has(track.id)) {
        continue;
      }

      const iou = computeProposalIou(track.proposal, detection.proposal);
      if (iou < TRACK_ASSOCIATION_IOU) {
        continue;
      }

      const trackKey = `${track.match.tcg}:${track.match.externalId}`;
      const associationScore = iou + (trackKey === detectionKey ? 0.25 : 0);
      if (associationScore > bestAssociationScore) {
        bestAssociationScore = associationScore;
        bestTrackIndex = index;
      }
    }

    if (bestTrackIndex >= 0) {
      const track = tracks[bestTrackIndex]!;
      const previousKey = `${track.match.tcg}:${track.match.externalId}`;

      tracks[bestTrackIndex] = {
        ...track,
        proposal: detection.proposal,
        overlayQuad: detection.overlayQuad,
        refinementMethod: detection.refinementMethod,
        isClipped: detection.isClipped,
        match: detection.bestMatch,
        lastSeenSeconds: timestampSeconds,
        seenFrames: track.seenFrames + 1,
        stableFrames:
          previousKey === detectionKey ? track.stableFrames + 1 : 1,
        missedFrames: 0,
      };

      assignedTrackIds.add(track.id);

      if (
        previousKey !== detectionKey &&
        detection.bestMatch.passedThreshold
      ) {
        timelineEntries.push({
          id: `${track.id}:${detectionKey}:${timestampSeconds.toFixed(2)}`,
          trackId: track.id,
          timestampSeconds,
          match: detection.bestMatch,
          proposal: detection.proposal,
        });
      }

      continue;
    }

    const newTrack: VideoTrack = {
      id: currentNextTrackId++,
      proposal: detection.proposal,
      overlayQuad: detection.overlayQuad,
      refinementMethod: detection.refinementMethod,
      isClipped: detection.isClipped,
      match: detection.bestMatch,
      lastSeenSeconds: timestampSeconds,
      seenFrames: 1,
      stableFrames: 1,
      missedFrames: 0,
    };
    tracks.push(newTrack);
    assignedTrackIds.add(newTrack.id);

    if (detection.bestMatch.passedThreshold) {
      timelineEntries.push({
        id: `${newTrack.id}:${detectionKey}:${timestampSeconds.toFixed(2)}`,
        trackId: newTrack.id,
        timestampSeconds,
        match: detection.bestMatch,
        proposal: detection.proposal,
      });
    }
  }

  return {
    tracks: tracks
      .filter((track) => track.missedFrames <= TRACK_MISS_TTL)
      .sort((left, right) => {
        return (
          right.match.confidence - left.match.confidence ||
          right.stableFrames - left.stableFrames ||
          right.lastSeenSeconds - left.lastSeenSeconds
        );
      }),
    timelineEntries,
    nextTrackId: currentNextTrackId,
  };
}

function computeProposalIou(
  left: VideoWindowProposal,
  right: VideoWindowProposal,
): number {
  const leftRight = left.left + left.width;
  const rightRight = right.left + right.width;
  const leftBottom = left.top + left.height;
  const rightBottom = right.top + right.height;

  const overlapWidth = Math.max(
    0,
    Math.min(leftRight, rightRight) - Math.max(left.left, right.left),
  );
  const overlapHeight = Math.max(
    0,
    Math.min(leftBottom, rightBottom) - Math.max(left.top, right.top),
  );
  const intersection = overlapWidth * overlapHeight;

  if (intersection <= 0) {
    return 0;
  }

  const union =
    left.width * left.height + right.width * right.height - intersection;
  return union > 0 ? intersection / union : 0;
}
