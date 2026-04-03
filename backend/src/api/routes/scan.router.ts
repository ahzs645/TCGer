import { Router } from 'express';

import {
  scanCardImage,
  getCardHashes,
  buildHashDatabase,
  getHashDatabaseStats,
} from '../../modules/card-scan';
import { uploadImages } from '../../utils/upload';
import { asyncHandler } from '../../utils/async-handler';
import { requireAuth, type AuthRequest } from '../middleware/auth';

export const scanRouter = Router();
scanRouter.use(requireAuth);

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
    const file = req.file;
    if (!file) {
      return res.status(400).json({
        error: 'BAD_REQUEST',
        message: 'An image file is required. Send as multipart/form-data with field name "image".',
      });
    }

    const tcg = typeof req.query.tcg === 'string' ? req.query.tcg : undefined;

    // Read the uploaded file into a buffer for processing
    const fs = await import('node:fs');
    const imageBuffer = fs.readFileSync(file.path);

    // Clean up the uploaded temp file (we only needed the buffer)
    try {
      fs.unlinkSync(file.path);
    } catch {
      // ignore cleanup errors
    }

    const result = await scanCardImage(imageBuffer, tcg);

    res.json({
      match: result.bestMatch,
      candidates: result.candidates,
      hash: result.hashGenerated,
    });
  })
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
  })
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
  })
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
    const buildPromise = buildHashDatabase(tcg as 'magic' | 'pokemon' | 'yugioh', { setCode, limit, force });

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
  })
);
