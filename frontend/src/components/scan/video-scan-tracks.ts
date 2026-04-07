import type {
  BrowserVideoProposalMatch,
  BrowserVideoScanCandidate,
  VideoQuad,
  VideoQuadPoint,
  VideoWindowProposal,
} from "@/lib/scan/browser-video-matcher";

import {
  TRACK_ASSOCIATION_IOU,
  TRACK_MISS_TTL,
  type MatchVote,
  type VideoTimelineItem,
  type VideoTrack,
} from "./video-scan-types";

// ---------- smoothing constants ----------

/** EMA alpha for quad corner positions (0 = no smoothing, 1 = no memory). */
const QUAD_SMOOTH_ALPHA = 0.35;
/** Minimum pixel movement before updating a smoothed quad corner. */
const QUAD_STICKY_PX = 1.5;
/** Minimum frames with same top match before committing identity. */
const MIN_VOTE_FRAMES = 2;

// ---------- public API ----------

/**
 * Reconcile incoming per-frame proposal detections with existing tracks.
 *
 * Improvements over naive per-frame replacement:
 * - Quad positions are EMA-smoothed to prevent visual jitter
 * - Match identity is accumulated via voting (confidence integral)
 * - The displayed match is the accumulated leader, not the last frame's result
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
        pm,
      ): pm is BrowserVideoProposalMatch & {
        bestMatch: BrowserVideoScanCandidate;
      } => pm.bestMatch !== null && pm.bestMatch.passedThreshold,
    )
    .sort(
      (a, b) =>
        b.bestMatch.confidence - a.bestMatch.confidence ||
        a.bestMatch.scoreDistance - b.bestMatch.scoreDistance,
    );

  const tracks = existingTracks.map((track) => ({
    ...track,
    matchVotes: new Map(track.matchVotes),
    missedFrames: track.missedFrames + 1,
  }));
  const assignedTrackIds = new Set<number>();
  const timelineEntries: VideoTimelineItem[] = [];
  let currentNextTrackId = nextTrackId;

  for (const detection of detections) {
    const bestTrackIndex = findBestTrack(
      tracks,
      detection,
      assignedTrackIds,
    );

    if (bestTrackIndex >= 0) {
      const track = tracks[bestTrackIndex]!;
      const previousLeader = getVoteLeader(track.matchVotes);

      // Accumulate vote for this detection's match
      accumulateVote(track.matchVotes, detection.bestMatch);
      const newLeader = getVoteLeader(track.matchVotes);

      // Smooth the quad position (EMA + hysteresis)
      const smoothed = smoothQuad(
        track.smoothedQuad,
        detection.overlayQuad,
      );

      tracks[bestTrackIndex] = {
        ...track,
        proposal: detection.proposal,
        overlayQuad: detection.overlayQuad,
        smoothedQuad: smoothed,
        refinementMethod: detection.refinementMethod,
        isClipped: detection.isClipped,
        // Use the accumulated vote leader, not the raw frame result
        match: newLeader ?? detection.bestMatch,
        lastSeenSeconds: timestampSeconds,
        seenFrames: track.seenFrames + 1,
        stableFrames:
          newLeader?.externalId === previousLeader?.externalId
            ? track.stableFrames + 1
            : 1,
        missedFrames: 0,
      };

      assignedTrackIds.add(track.id);

      // Timeline: emit when the vote leader changes
      if (
        newLeader &&
        previousLeader &&
        newLeader.externalId !== previousLeader.externalId &&
        newLeader.passedThreshold
      ) {
        timelineEntries.push({
          id: `${track.id}:${newLeader.tcg}:${newLeader.externalId}:${timestampSeconds.toFixed(2)}`,
          trackId: track.id,
          timestampSeconds,
          match: newLeader,
          proposal: detection.proposal,
        });
      }

      continue;
    }

    // New track
    const votes = new Map<string, MatchVote>();
    accumulateVote(votes, detection.bestMatch);

    const newTrack: VideoTrack = {
      id: currentNextTrackId++,
      proposal: detection.proposal,
      overlayQuad: detection.overlayQuad,
      smoothedQuad: [...detection.overlayQuad] as VideoQuad,
      refinementMethod: detection.refinementMethod,
      isClipped: detection.isClipped,
      match: detection.bestMatch,
      lastSeenSeconds: timestampSeconds,
      seenFrames: 1,
      stableFrames: 1,
      missedFrames: 0,
      matchVotes: votes,
    };
    tracks.push(newTrack);
    assignedTrackIds.add(newTrack.id);

    if (detection.bestMatch.passedThreshold) {
      timelineEntries.push({
        id: `${newTrack.id}:${detection.bestMatch.tcg}:${detection.bestMatch.externalId}:${timestampSeconds.toFixed(2)}`,
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
      .sort(
        (a, b) =>
          b.match.confidence - a.match.confidence ||
          b.stableFrames - a.stableFrames ||
          b.lastSeenSeconds - a.lastSeenSeconds,
      ),
    timelineEntries,
    nextTrackId: currentNextTrackId,
  };
}

// ---------- track association ----------

function findBestTrack(
  tracks: VideoTrack[],
  detection: BrowserVideoProposalMatch & {
    bestMatch: BrowserVideoScanCandidate;
  },
  assignedIds: Set<number>,
): number {
  let bestIndex = -1;
  let bestScore = -1;

  for (const [index, track] of tracks.entries()) {
    if (assignedIds.has(track.id)) continue;

    const iou = computeProposalIou(track.proposal, detection.proposal);
    if (iou < TRACK_ASSOCIATION_IOU) continue;

    // Bonus for matching the same card identity
    const trackKey = `${track.match.tcg}:${track.match.externalId}`;
    const detKey = `${detection.bestMatch.tcg}:${detection.bestMatch.externalId}`;
    const score = iou + (trackKey === detKey ? 0.25 : 0);

    if (score > bestScore) {
      bestScore = score;
      bestIndex = index;
    }
  }

  return bestIndex;
}

// ---------- vote accumulation ----------

function accumulateVote(
  votes: Map<string, MatchVote>,
  match: BrowserVideoScanCandidate,
): void {
  const key = `${match.tcg}:${match.externalId}`;
  const existing = votes.get(key);
  if (existing) {
    existing.count += 1;
    existing.totalConfidence += match.confidence;
    if (match.confidence > existing.bestMatch.confidence) {
      existing.bestMatch = match;
    }
  } else {
    votes.set(key, {
      count: 1,
      totalConfidence: match.confidence,
      bestMatch: match,
    });
  }
}

/**
 * Get the vote leader: the match with the highest confidence integral
 * (count × avgConfidence), requiring at least MIN_VOTE_FRAMES votes.
 */
function getVoteLeader(
  votes: Map<string, MatchVote>,
): BrowserVideoScanCandidate | null {
  let bestScore = -1;
  let leader: BrowserVideoScanCandidate | null = null;

  for (const vote of votes.values()) {
    if (vote.count < MIN_VOTE_FRAMES) continue;
    // Confidence integral: duration × average confidence
    const score = vote.totalConfidence;
    if (score > bestScore) {
      bestScore = score;
      leader = vote.bestMatch;
    }
  }

  return leader;
}

// ---------- quad smoothing ----------

/**
 * EMA smooth a quad toward a new target, with hysteresis to prevent
 * micro-jitter when the card is nearly still.
 */
function smoothQuad(previous: VideoQuad, target: VideoQuad): VideoQuad {
  return previous.map((prev, i) => {
    const tgt = target[i]!;
    const dx = tgt.x - prev.x;
    const dy = tgt.y - prev.y;
    const dist = Math.hypot(dx, dy);

    // Below sticky threshold: don't move (prevents jitter)
    if (dist < QUAD_STICKY_PX) {
      return prev;
    }

    // EMA toward target
    return {
      x: prev.x + dx * QUAD_SMOOTH_ALPHA,
      y: prev.y + dy * QUAD_SMOOTH_ALPHA,
    };
  }) as VideoQuad;
}

// ---------- IOU ----------

function computeProposalIou(
  left: VideoWindowProposal,
  right: VideoWindowProposal,
): number {
  const overlapW = Math.max(
    0,
    Math.min(left.left + left.width, right.left + right.width) -
      Math.max(left.left, right.left),
  );
  const overlapH = Math.max(
    0,
    Math.min(left.top + left.height, right.top + right.height) -
      Math.max(left.top, right.top),
  );
  const inter = overlapW * overlapH;
  if (inter <= 0) return 0;
  const union =
    left.width * left.height + right.width * right.height - inter;
  return union > 0 ? inter / union : 0;
}
