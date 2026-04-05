import { randomUUID } from 'node:crypto';
import { mkdir, rename, unlink } from 'node:fs/promises';
import path from 'node:path';

import { Prisma, type CardScanDebugCapture } from '@prisma/client';
import sharp from 'sharp';

import { prisma } from '../../lib/prisma';
import { getCardScanDebugPublicPath, getCardScanDebugUploadDir } from '../../utils/upload';
import type { ScanResult } from './scan.service';

export const CARD_SCAN_DEBUG_FEEDBACK_STATUSES = [
  'unreviewed',
  'correct',
  'incorrect',
  'needs_review',
] as const;

export type CardScanDebugFeedbackStatus = (typeof CARD_SCAN_DEBUG_FEEDBACK_STATUSES)[number];

interface CreateCardScanDebugCaptureInput {
  userId: string;
  file: Express.Multer.File;
  imageBuffer: Buffer;
  result: ScanResult;
  requestedTcg?: string;
  captureSource?: string;
  notes?: string;
  userAgent?: string | null;
}

interface ListCardScanDebugCapturesInput {
  userId: string;
  isAdmin: boolean;
  scope?: 'all' | 'mine';
  limit?: number;
}

interface UpdateCardScanDebugCaptureInput {
  captureId: string;
  userId: string;
  isAdmin: boolean;
  feedbackStatus?: CardScanDebugFeedbackStatus;
  notes?: string;
  expectedExternalId?: string;
  expectedName?: string;
  expectedTcg?: string;
}

function trimOptionalString(value?: string | null): string | null | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (value === null) {
    return null;
  }

  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function resolveImageExtension(file: Express.Multer.File): string {
  const originalExt = path.extname(file.originalname ?? '').toLowerCase();
  if (['.jpg', '.jpeg', '.png', '.webp'].includes(originalExt)) {
    return originalExt === '.jpeg' ? '.jpg' : originalExt;
  }

  switch (file.mimetype) {
    case 'image/png':
      return '.png';
    case 'image/webp':
      return '.webp';
    default:
      return '.jpg';
  }
}

function buildDebugPayload(
  result: ScanResult,
  requestedTcg?: string,
  captureSource?: string,
): Prisma.InputJsonValue {
  return JSON.parse(
    JSON.stringify({
      requestedTcg: requestedTcg ?? null,
      captureSource: captureSource ?? null,
      match: result.bestMatch,
      candidates: result.candidates,
      hash: result.hashGenerated,
      meta: result.meta,
    }),
  ) as Prisma.InputJsonValue;
}

export async function createCardScanDebugCapture(
  input: CreateCardScanDebugCaptureInput,
): Promise<CardScanDebugCapture> {
  const debugDir = getCardScanDebugUploadDir();
  await mkdir(debugDir, { recursive: true });

  const extension = resolveImageExtension(input.file);
  const filename = `${randomUUID()}${extension}`;
  const destinationPath = path.join(debugDir, filename);
  const publicPath = getCardScanDebugPublicPath(filename);
  const metadata = await sharp(input.imageBuffer)
    .metadata()
    .catch(() => null);

  await rename(input.file.path, destinationPath);

  try {
    return await prisma.cardScanDebugCapture.create({
      data: {
        userId: input.userId,
        requestedTcg: trimOptionalString(input.requestedTcg) ?? null,
        captureSource: trimOptionalString(input.captureSource) ?? null,
        sourceImagePath: publicPath,
        sourceFilename: trimOptionalString(input.file.originalname) ?? null,
        sourceMimeType: trimOptionalString(input.file.mimetype) ?? null,
        sourceImageWidth: metadata?.width ?? null,
        sourceImageHeight: metadata?.height ?? null,
        bestMatchExternalId: input.result.bestMatch?.externalId ?? null,
        bestMatchName: input.result.bestMatch?.name ?? null,
        bestMatchTcg: input.result.bestMatch?.tcg ?? null,
        bestMatchConfidence: input.result.bestMatch?.confidence ?? null,
        bestMatchDistance: input.result.bestMatch?.distance ?? null,
        notes: trimOptionalString(input.notes) ?? null,
        userAgent: trimOptionalString(input.userAgent) ?? null,
        debugPayload: buildDebugPayload(input.result, input.requestedTcg, input.captureSource),
      },
    });
  } catch (error) {
    await unlink(destinationPath).catch(() => undefined);
    throw error;
  }
}

export async function listCardScanDebugCaptures(input: ListCardScanDebugCapturesInput) {
  const limit = Math.min(50, Math.max(1, input.limit ?? 12));
  const scope = input.isAdmin && input.scope === 'all' ? 'all' : 'mine';

  return prisma.cardScanDebugCapture.findMany({
    where: scope === 'all' ? undefined : { userId: input.userId },
    orderBy: { createdAt: 'desc' },
    take: limit,
  });
}

export async function updateCardScanDebugCapture(input: UpdateCardScanDebugCaptureInput) {
  const existing = await prisma.cardScanDebugCapture.findUnique({
    where: { id: input.captureId },
    select: { id: true, userId: true },
  });

  if (!existing) {
    throw new Error('NOT_FOUND');
  }

  if (!input.isAdmin && existing.userId !== input.userId) {
    throw new Error('FORBIDDEN');
  }

  const data: Record<string, unknown> = {};

  if (input.feedbackStatus !== undefined) {
    data.feedbackStatus = input.feedbackStatus;
    data.reviewedAt = input.feedbackStatus === 'unreviewed' ? null : new Date();
  }

  if (input.notes !== undefined) {
    data.notes = trimOptionalString(input.notes) ?? null;
  }

  if (input.expectedExternalId !== undefined) {
    data.expectedExternalId = trimOptionalString(input.expectedExternalId) ?? null;
  }

  if (input.expectedName !== undefined) {
    data.expectedName = trimOptionalString(input.expectedName) ?? null;
  }

  if (input.expectedTcg !== undefined) {
    data.expectedTcg = trimOptionalString(input.expectedTcg) ?? null;
  }

  return prisma.cardScanDebugCapture.update({
    where: { id: input.captureId },
    data,
  });
}
