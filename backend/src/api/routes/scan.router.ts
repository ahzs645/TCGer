import { Router } from 'express';

import {
  scanCardImage,
  getCardHashes,
  buildHashDatabase,
  getHashDatabaseStats,
} from '../../modules/card-scan';
import {
  CARD_SCAN_DEBUG_FEEDBACK_STATUSES,
  CARD_SCAN_DEBUG_REVIEW_TAGS,
  createCardScanDebugCapture,
  listCardScanDebugCaptures,
  updateCardScanDebugCapture,
  type CardScanDebugFeedbackStatus,
  type CardScanDebugReviewTag,
} from '../../modules/card-scan/debug-captures.service';
import { uploadImages } from '../../utils/upload';
import { asyncHandler } from '../../utils/async-handler';
import { requireAuth, type AuthRequest } from '../middleware/auth';

export const scanRouter = Router();
scanRouter.use(requireAuth);

function parseBooleanLike(value: unknown): boolean {
  if (typeof value !== 'string') {
    return false;
  }

  return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase());
}

function resolveRequestOrigin(req: AuthRequest): string | null {
  const originHeader = req.get('origin');
  if (originHeader) {
    try {
      const originUrl = new URL(originHeader);
      return originUrl.origin;
    } catch {
      // ignore malformed origin headers
    }
  }

  const refererHeader = req.get('referer');
  if (refererHeader) {
    try {
      const refererUrl = new URL(refererHeader);
      return refererUrl.origin;
    } catch {
      // ignore malformed referer headers
    }
  }

  const forwardedProto = req.headers['x-forwarded-proto'];
  const forwardedHost = req.headers['x-forwarded-host'];
  const protoHeader = Array.isArray(forwardedProto) ? forwardedProto[0] : forwardedProto;
  const hostHeader = Array.isArray(forwardedHost) ? forwardedHost[0] : forwardedHost;
  const protocol = protoHeader?.split(',')[0]?.trim() || req.protocol;
  const host = hostHeader?.split(',')[0]?.trim() || req.get('host');

  if (!host) {
    return null;
  }

  return `${protocol}://${host}`;
}

function serializeDebugCapture(
  capture: {
    id: string;
    requestedTcg: string | null;
    captureSource: string | null;
    sourceImagePath: string;
    correctedImagePath: string | null;
    artworkImagePath: string | null;
    titleImagePath: string | null;
    footerImagePath: string | null;
    bestMatchExternalId: string | null;
    bestMatchName: string | null;
    bestMatchTcg: string | null;
    bestMatchConfidence: number | null;
    bestMatchDistance: number | null;
    feedbackStatus: string;
    reviewTags: string[];
    notes: string | null;
    expectedExternalId: string | null;
    expectedName: string | null;
    expectedTcg: string | null;
    reviewedAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
    debugPayload?: unknown;
  },
  req: AuthRequest,
) {
  const origin = resolveRequestOrigin(req);
  const resolvePublicUrl = (publicPath: string | null) =>
    publicPath
      ? origin
        ? new URL(publicPath, `${origin}/`).toString()
        : publicPath
      : null;
  const sourceImageUrl = origin
    ? new URL(capture.sourceImagePath, `${origin}/`).toString()
    : capture.sourceImagePath;
  const debugPayload =
    capture.debugPayload && typeof capture.debugPayload === 'object'
      ? (capture.debugPayload as Record<string, unknown>)
      : null;
  const payloadMeta =
    debugPayload?.meta && typeof debugPayload.meta === 'object'
      ? (debugPayload.meta as Record<string, unknown>)
      : null;
  const payloadDiagnostics =
    debugPayload?.diagnostics && typeof debugPayload.diagnostics === 'object'
      ? (debugPayload.diagnostics as Record<string, unknown>)
      : null;
  const payloadPipeline =
    debugPayload?.pipeline && typeof debugPayload.pipeline === 'object'
      ? (debugPayload.pipeline as Record<string, unknown>)
      : null;

  return {
    id: capture.id,
    requestedTcg: capture.requestedTcg,
    captureSource: capture.captureSource,
    sourceImagePath: capture.sourceImagePath,
    sourceImageUrl,
    artifactImages: {
      correctedImagePath: capture.correctedImagePath,
      correctedImageUrl: resolvePublicUrl(capture.correctedImagePath),
      artworkImagePath: capture.artworkImagePath,
      artworkImageUrl: resolvePublicUrl(capture.artworkImagePath),
      titleImagePath: capture.titleImagePath,
      titleImageUrl: resolvePublicUrl(capture.titleImagePath),
      footerImagePath: capture.footerImagePath,
      footerImageUrl: resolvePublicUrl(capture.footerImagePath),
    },
    feedbackStatus: capture.feedbackStatus,
    reviewTags: capture.reviewTags,
    notes: capture.notes,
    expectedExternalId: capture.expectedExternalId,
    expectedName: capture.expectedName,
    expectedTcg: capture.expectedTcg,
    reviewedAt: capture.reviewedAt?.toISOString() ?? null,
    createdAt: capture.createdAt.toISOString(),
    updatedAt: capture.updatedAt.toISOString(),
    pipeline: payloadPipeline,
    diagnostics: {
      timings: payloadDiagnostics?.timings ?? null,
      attempts: Array.isArray(payloadDiagnostics?.attempts)
        ? payloadDiagnostics?.attempts
        : [],
      rejectedNearMisses: Array.isArray(payloadDiagnostics?.rejectedNearMisses)
        ? payloadDiagnostics?.rejectedNearMisses
        : [],
      artwork:
        payloadDiagnostics?.artwork && typeof payloadDiagnostics.artwork === 'object'
          ? payloadDiagnostics.artwork
          : null,
      ocr:
        payloadDiagnostics?.ocr && typeof payloadDiagnostics.ocr === 'object'
          ? payloadDiagnostics.ocr
          : null,
      geometry: payloadMeta
        ? {
            perspectiveCorrected: payloadMeta.perspectiveCorrected ?? null,
            contourAreaRatio: payloadMeta.contourAreaRatio ?? null,
            contourConfidence: payloadMeta.contourConfidence ?? null,
            rotationAngle: payloadMeta.rotationAngle ?? null,
            cropAspectRatio: payloadMeta.cropAspectRatio ?? null,
            cropWidth: payloadMeta.cropWidth ?? null,
            cropHeight: payloadMeta.cropHeight ?? null,
            cropCandidateScore: payloadMeta.cropCandidateScore ?? null,
            contourPoints: Array.isArray(payloadMeta.contourPoints)
              ? payloadMeta.contourPoints
              : [],
            maskVariant: payloadMeta.maskVariant ?? null,
          }
        : null,
    },
    bestMatch: capture.bestMatchExternalId
      ? {
          externalId: capture.bestMatchExternalId,
          name: capture.bestMatchName,
          tcg: capture.bestMatchTcg,
          confidence: capture.bestMatchConfidence,
          distance: capture.bestMatchDistance,
        }
      : null,
  };
}

/**
 * POST /cards/scan
 *
 * Upload a card image and identify it via pHash matching.
 * Accepts multipart/form-data with a single image field.
 * Optional query param: ?tcg=magic|pokemon|yugioh
 */
scanRouter.post(
  '/',
  uploadImages.single('image'),
  asyncHandler(async (req, res) => {
    const authReq = req as AuthRequest;
    const body = (req.body ?? {}) as Record<string, unknown>;
    const file = req.file;
    if (!file) {
      return res.status(400).json({
        error: 'BAD_REQUEST',
        message: 'An image file is required. Send as multipart/form-data with field name "image".',
      });
    }

    const tcg = typeof req.query.tcg === 'string' ? req.query.tcg : undefined;
    const saveDebugCapture = parseBooleanLike(body.saveDebugCapture);
    const captureSource = typeof body.captureSource === 'string' ? body.captureSource : undefined;
    const captureNotes = typeof body.captureNotes === 'string' ? body.captureNotes : undefined;

    // Read the uploaded file into a buffer for processing
    const fs = await import('node:fs');
    const imageBuffer = fs.readFileSync(file.path);

    const result = await scanCardImage(imageBuffer, tcg);
    let debugCapture = null;
    let debugCaptureError: string | null = null;

    if (saveDebugCapture) {
      try {
        const savedCapture = await createCardScanDebugCapture({
          viewerId: authReq.user!.id,
          file,
          imageBuffer,
          result,
          requestedTcg: tcg,
          captureSource,
          notes: captureNotes,
          userAgent: req.get('user-agent') ?? null,
        });
        debugCapture = serializeDebugCapture(savedCapture, authReq);
      } catch (error) {
        debugCaptureError =
          error instanceof Error ? error.message : 'Unable to save the debug capture.';
      }
    }

    // Clean up the uploaded temp file when it was not retained as a debug capture.
    try {
      fs.unlinkSync(file.path);
    } catch {
      // ignore cleanup errors
    }

    res.json({
      match: result.bestMatch,
      candidates: result.candidates,
      hash: result.hashGenerated,
      meta: result.meta,
      debugCapture,
      debugCaptureError,
    });
  }),
);

/**
 * GET /cards/scan/hashes
 *
 * Download the hash database for client-side matching (iOS, etc.).
 * Supports pagination and TCG filtering.
 *
 * Query params:
 *   - tcg: 'magic' | 'pokemon' | 'yugioh' (optional)
 *   - page: page number (default 1)
 *   - pageSize: entries per page (default 500, max 2000)
 */
scanRouter.get(
  '/hashes',
  asyncHandler(async (req, res) => {
    const query = req.query as Record<string, string | undefined>;
    const tcg = typeof query.tcg === 'string' ? query.tcg : undefined;
    const page = Math.max(1, Number(query.page) || 1);
    const pageSize = Math.min(2000, Math.max(1, Number(query.pageSize) || 500));

    const result = await getCardHashes(tcg, page, pageSize);
    res.json(result);
  }),
);

/**
 * GET /cards/scan/stats
 *
 * Get hash database statistics (counts per TCG).
 */
scanRouter.get(
  '/stats',
  asyncHandler(async (_req, res) => {
    const stats = await getHashDatabaseStats();
    res.json(stats);
  }),
);

scanRouter.get(
  '/debug-captures',
  asyncHandler(async (req, res) => {
    const authReq = req as AuthRequest;
    const query = (req.query ?? {}) as Record<string, string | undefined>;
    const scope = authReq.user?.isAdmin && query.scope === 'all' ? 'all' : 'mine';
    const limit = Math.max(1, Number(query.limit) || 8);

    const captures = await listCardScanDebugCaptures({
      viewerId: authReq.user!.id,
      isAdmin: authReq.user?.isAdmin ?? false,
      scope,
      limit,
    });

    res.json({
      captures: captures.map((capture) => serializeDebugCapture(capture, authReq)),
    });
  }),
);

scanRouter.patch(
  '/debug-captures/:captureId',
  asyncHandler(async (req, res) => {
    const authReq = req as AuthRequest;
    const params = (req.params ?? {}) as Record<string, string | undefined>;
    const body = (req.body ?? {}) as Record<string, unknown>;
    const captureId = typeof params.captureId === 'string' ? params.captureId : '';
    const rawStatus = typeof body.feedbackStatus === 'string' ? body.feedbackStatus : undefined;
    const rawReviewTags = Array.isArray(body.reviewTags)
      ? body.reviewTags.filter((value): value is string => typeof value === 'string')
      : undefined;

    if (
      rawStatus &&
      !CARD_SCAN_DEBUG_FEEDBACK_STATUSES.includes(rawStatus as CardScanDebugFeedbackStatus)
    ) {
      return res.status(400).json({
        error: 'BAD_REQUEST',
        message: `feedbackStatus must be one of: ${CARD_SCAN_DEBUG_FEEDBACK_STATUSES.join(', ')}`,
      });
    }

    if (
      rawReviewTags &&
      rawReviewTags.some(
        (tag) => !CARD_SCAN_DEBUG_REVIEW_TAGS.includes(tag as CardScanDebugReviewTag),
      )
    ) {
      return res.status(400).json({
        error: 'BAD_REQUEST',
        message: `reviewTags must be a subset of: ${CARD_SCAN_DEBUG_REVIEW_TAGS.join(', ')}`,
      });
    }

    try {
      const capture = await updateCardScanDebugCapture({
        captureId,
        viewerId: authReq.user!.id,
        isAdmin: authReq.user?.isAdmin ?? false,
        feedbackStatus: rawStatus as CardScanDebugFeedbackStatus | undefined,
        reviewTags: rawReviewTags as CardScanDebugReviewTag[] | undefined,
        notes: typeof body.notes === 'string' ? body.notes : undefined,
        expectedExternalId:
          typeof body.expectedExternalId === 'string' ? body.expectedExternalId : undefined,
        expectedName: typeof body.expectedName === 'string' ? body.expectedName : undefined,
        expectedTcg: typeof body.expectedTcg === 'string' ? body.expectedTcg : undefined,
      });

      res.json({
        capture: serializeDebugCapture(capture, authReq),
      });
    } catch (error) {
      if (error instanceof Error && error.message === 'NOT_FOUND') {
        return res.status(404).json({
          error: 'NOT_FOUND',
          message: 'Debug capture not found.',
        });
      }

      if (error instanceof Error && error.message === 'FORBIDDEN') {
        return res.status(403).json({
          error: 'FORBIDDEN',
          message: 'You do not have access to update this debug capture.',
        });
      }

      throw error;
    }
  }),
);

/**
 * POST /cards/scan/build
 *
 * Trigger hash database build for a TCG.
 * Admin only — downloads card images and computes hashes.
 *
 * Body:
 *   - tcg: 'magic' | 'pokemon' | 'yugioh' (required)
 *   - setCode: specific set to build (optional)
 *   - limit: max cards to process (optional)
 *   - force: rebuild existing hashes (default false)
 */
scanRouter.post(
  '/build',
  asyncHandler(async (req, res) => {
    const authReq = req as AuthRequest;

    if (!authReq.user?.isAdmin) {
      return res.status(403).json({
        error: 'FORBIDDEN',
        message: 'Admin access is required to build the card scan hash index',
      });
    }

    const { tcg, setCode, limit, force } = req.body as {
      tcg?: string;
      setCode?: string;
      limit?: number;
      force?: boolean;
    };

    if (!tcg || !['magic', 'pokemon', 'yugioh'].includes(tcg)) {
      return res.status(400).json({
        error: 'BAD_REQUEST',
        message: 'tcg must be one of: magic, pokemon, yugioh',
      });
    }

    // Run build in background — respond immediately
    const buildPromise = buildHashDatabase(tcg as 'magic' | 'pokemon' | 'yugioh', {
      setCode,
      limit,
      force,
    });

    // Don't await — let it run in the background
    buildPromise.catch((err) => {
      console.error('Hash build failed:', err);
    });

    res.status(202).json({
      message: `Hash database build started for ${tcg}`,
      tcg,
      setCode: setCode ?? null,
      limit: limit ?? null,
      force: force ?? false,
    });
  }),
);
