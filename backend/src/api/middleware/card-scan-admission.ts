import type { NextFunction, Response } from 'express';
import sharp from 'sharp';

import type { AuthRequest } from './auth';

export interface CardScanAdmissionConfig {
  windowMs: number;
  maxRequestsPerWindow: number;
  maxConcurrentGlobal: number;
  maxConcurrentPerUser: number;
  now?: () => number;
}

export interface CardScanAdmissionLease {
  release(): void;
}

export type CardScanAdmission =
  | { allowed: true; lease: CardScanAdmissionLease }
  | { allowed: false; reason: 'rate-limit' | 'concurrency'; retryAfterSeconds: number };

interface RequestWindow {
  startedAt: number;
  count: number;
}

function positiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export class CardScanAdmissionGate {
  private readonly requestWindows = new Map<string, RequestWindow>();
  private readonly activeByUser = new Map<string, number>();
  private activeGlobal = 0;
  private lastSweepAt = 0;
  private readonly now: () => number;

  constructor(private readonly config: CardScanAdmissionConfig) {
    this.now = config.now ?? Date.now;
  }

  enter(userKey: string): CardScanAdmission {
    const now = this.now();
    this.sweepExpiredWindows(now);
    const previousWindow = this.requestWindows.get(userKey);
    const window =
      !previousWindow || now - previousWindow.startedAt >= this.config.windowMs
        ? { startedAt: now, count: 0 }
        : previousWindow;

    if (window.count >= this.config.maxRequestsPerWindow) {
      const remainingMs = Math.max(1, this.config.windowMs - (now - window.startedAt));
      return {
        allowed: false,
        reason: 'rate-limit',
        retryAfterSeconds: Math.max(1, Math.ceil(remainingMs / 1_000)),
      };
    }

    const activeForUser = this.activeByUser.get(userKey) ?? 0;
    if (
      this.activeGlobal >= this.config.maxConcurrentGlobal ||
      activeForUser >= this.config.maxConcurrentPerUser
    ) {
      return { allowed: false, reason: 'concurrency', retryAfterSeconds: 1 };
    }

    window.count += 1;
    this.requestWindows.set(userKey, window);
    this.activeGlobal += 1;
    this.activeByUser.set(userKey, activeForUser + 1);

    let released = false;
    return {
      allowed: true,
      lease: {
        release: () => {
          if (released) return;
          released = true;
          this.activeGlobal = Math.max(0, this.activeGlobal - 1);
          const nextForUser = Math.max(0, (this.activeByUser.get(userKey) ?? 1) - 1);
          if (nextForUser === 0) {
            this.activeByUser.delete(userKey);
          } else {
            this.activeByUser.set(userKey, nextForUser);
          }
        },
      },
    };
  }

  private sweepExpiredWindows(now: number): void {
    if (now - this.lastSweepAt < this.config.windowMs) return;
    this.lastSweepAt = now;
    for (const [key, window] of this.requestWindows) {
      if (
        now - window.startedAt >= this.config.windowMs &&
        !this.activeByUser.has(key)
      ) {
        this.requestWindows.delete(key);
      }
    }
  }
}

const defaultGate = new CardScanAdmissionGate({
  windowMs: positiveInteger(process.env.CARD_SCAN_RATE_WINDOW_MS, 60_000),
  maxRequestsPerWindow: positiveInteger(process.env.CARD_SCAN_RATE_LIMIT, 20),
  maxConcurrentGlobal: positiveInteger(process.env.CARD_SCAN_MAX_CONCURRENT, 4),
  maxConcurrentPerUser: positiveInteger(process.env.CARD_SCAN_MAX_CONCURRENT_PER_USER, 1),
});

export function admitCardScan(req: AuthRequest, res: Response, next: NextFunction): void {
  const userKey = req.user?.id ? `user:${req.user.id}` : `ip:${req.ip}`;
  const admission = defaultGate.enter(userKey);
  if (!admission.allowed) {
    res.setHeader('Retry-After', String(admission.retryAfterSeconds));
    res.status(429).json({
      error: admission.reason === 'rate-limit' ? 'RATE_LIMITED' : 'SCAN_BUSY',
      message:
        admission.reason === 'rate-limit'
          ? 'Too many card scans. Please wait before trying again.'
          : 'A card scan is already in progress. Please try again shortly.',
    });
    return;
  }

  const release = () => admission.lease.release();
  res.once('finish', release);
  res.once('close', release);
  next();
}

export class CardScanImageValidationError extends Error {
  constructor(
    message: string,
    readonly statusCode: 400 | 413,
  ) {
    super(message);
    this.name = 'CardScanImageValidationError';
  }
}

const SUPPORTED_SCAN_FORMATS = new Set(['jpeg', 'png', 'webp']);
const DEFAULT_MAX_SCAN_PIXELS = 25_000_000;

export async function validateCardScanImage(
  imageBuffer: Buffer,
  maxPixels = positiveInteger(process.env.CARD_SCAN_MAX_PIXELS, DEFAULT_MAX_SCAN_PIXELS),
): Promise<void> {
  let metadata: sharp.Metadata;
  try {
    metadata = await sharp(imageBuffer, { limitInputPixels: maxPixels }).metadata();
  } catch {
    throw new CardScanImageValidationError(
      'The uploaded image is invalid or exceeds the scanner pixel limit.',
      413,
    );
  }

  if (!metadata.format || !SUPPORTED_SCAN_FORMATS.has(metadata.format)) {
    throw new CardScanImageValidationError('The scanner supports JPEG, PNG, and WebP images.', 400);
  }
  if (!metadata.width || !metadata.height) {
    throw new CardScanImageValidationError('The uploaded image has no readable dimensions.', 400);
  }
  if (metadata.width * metadata.height > maxPixels) {
    throw new CardScanImageValidationError(
      `The uploaded image exceeds the ${maxPixels.toLocaleString()} pixel scanner limit.`,
      413,
    );
  }
}
