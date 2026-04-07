import { MAX_FRAME_LONG_SIDE } from "./video-scan-types";

/**
 * Wait for the video element to have loaded metadata (duration, dimensions).
 */
export async function ensureVideoMetadata(
  video: HTMLVideoElement,
): Promise<void> {
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

/**
 * Seek the video element to a given timestamp and wait for the seek to finish.
 */
export async function seekVideo(
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

/**
 * Draw the current video frame onto a canvas, optionally downscaling.
 */
export function drawVideoFrameToCanvas(
  video: HTMLVideoElement,
  canvas: HTMLCanvasElement,
  targetLongSide = MAX_FRAME_LONG_SIDE,
): { width: number; height: number } {
  const longestSide = Math.max(video.videoWidth, video.videoHeight);
  const scale =
    longestSide > targetLongSide ? targetLongSide / longestSide : 1;
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

/**
 * Build an array of evenly-spaced sample timestamps across a video duration.
 */
export function buildSampleTimestamps(
  durationSeconds: number,
  sampleFps: number,
  maxFrames: number,
): number[] {
  const safeFps = Math.max(0.1, sampleFps);
  const step = 1 / safeFps;
  const safeMaxFrames = Math.max(1, maxFrames);
  const upperBound =
    durationSeconds > 0.05
      ? durationSeconds - 0.05
      : Math.max(0, durationSeconds);
  const timestamps: number[] = [];

  for (
    let timestampSeconds = 0;
    timestampSeconds <= upperBound + 0.0001 &&
    timestamps.length < safeMaxFrames;
    timestampSeconds += step
  ) {
    timestamps.push(Number(timestampSeconds.toFixed(3)));
  }

  if (!timestamps.length) {
    timestamps.push(0);
  }

  return timestamps;
}

/**
 * Yield to the browser event loop so the UI can paint between frames.
 */
export async function yieldToBrowser(): Promise<void> {
  await new Promise<void>((resolve) => {
    window.requestAnimationFrame(() => resolve());
  });
}

/**
 * Schedule a callback for the next video frame.
 *
 * Uses `requestVideoFrameCallback` when available (syncs to actual decoded
 * frames), falling back to `requestAnimationFrame` (syncs to display refresh).
 */
export function scheduleNextFrame(
  video: HTMLVideoElement,
  callback: () => void,
): void {
  if ("requestVideoFrameCallback" in video) {
    (video as any).requestVideoFrameCallback(callback);
  } else {
    requestAnimationFrame(callback);
  }
}

/**
 * Pick a target frame long side based on sample rate (higher fps → smaller frames).
 */
export function getTargetFrameLongSide(sampleFps: number): number {
  if (sampleFps >= 6) {
    return 640;
  }

  if (sampleFps >= 4) {
    return 720;
  }

  if (sampleFps >= 2) {
    return 840;
  }

  return MAX_FRAME_LONG_SIDE;
}
