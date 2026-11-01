import type { BinderPage, BinderPagePlacement, UpsertBinderPageInput } from '@tcg/api-types';
import type { Prisma } from '@prisma/client';

import { prisma } from '../../lib/prisma';

async function requireOwnedBinder(userId: string, binderId: string, client: Prisma.TransactionClient = prisma) {
  const binder = await client.binder.findFirst({
    where: { id: binderId, userId },
    select: { id: true }
  });
  if (!binder) {
    throw new Error('Binder not found');
  }
  return binder;
}

function revisionConflict() {
  return Object.assign(new Error('Binder page changed. Review the current page before saving again.'), {
    status: 409, code: 'PAGE_REVISION_CONFLICT'
  });
}

function requireRevision(expected: number | undefined, actual: number) {
  if (expected !== undefined && (!Number.isSafeInteger(expected) || expected < 0 || expected !== actual)) {
    throw revisionConflict();
  }
}

async function pageTransaction<T>(action: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  try {
    return await prisma.$transaction(action, { isolationLevel: 'Serializable' });
  } catch (error) {
    // Concurrent create/update/delete is a reviewable conflict, never a silent
    // overwrite or an opaque server error. No retry may use an obsolete revision.
    if (error && typeof error === 'object' && 'code' in error && ['P2002', 'P2034'].includes(String(error.code))) {
      throw revisionConflict();
    }
    throw error;
  }
}

function mapPage(page: {
  id: string;
  binderId: string;
  pageNumber: number;
  revision: number;
  capturedAt: Date;
  imageUrl: string | null;
  placements: Prisma.JsonValue;
  createdAt: Date;
  updatedAt: Date;
}): BinderPage {
  return {
    id: page.id,
    binderId: page.binderId,
    pageNumber: page.pageNumber,
    revision: page.revision,
    capturedAt: page.capturedAt.toISOString(),
    imageUrl: page.imageUrl ?? undefined,
    placements: page.placements as BinderPagePlacement[],
    createdAt: page.createdAt.toISOString(),
    updatedAt: page.updatedAt.toISOString()
  };
}

export async function listBinderPages(userId: string, binderId: string): Promise<BinderPage[]> {
  await requireOwnedBinder(userId, binderId);
  const pages = await prisma.binderPage.findMany({
    where: { binderId },
    orderBy: { pageNumber: 'asc' }
  });
  return pages.map(mapPage);
}

export async function upsertBinderPage(
  userId: string,
  binderId: string,
  input: UpsertBinderPageInput
): Promise<BinderPage> {
  const capturedAt = input.capturedAt ? new Date(input.capturedAt) : new Date();
  const placements = input.placements as unknown as Prisma.InputJsonValue;
  const page = await pageTransaction(async tx => {
    await requireOwnedBinder(userId, binderId, tx);
    const where = { binderId_pageNumber: { binderId, pageNumber: input.pageNumber } };
    const existing = await tx.binderPage.findUnique({ where });
    requireRevision(input.expectedRevision, existing?.revision ?? 0);
    return tx.binderPage.upsert({
      where,
      create: { binderId, pageNumber: input.pageNumber, capturedAt, placements },
      update: { capturedAt, placements, revision: { increment: 1 } }
    });
  });
  return mapPage(page);
}

export async function replaceBinderPageImage(
  userId: string,
  binderId: string,
  pageNumber: number,
  imageUrl: string,
  expectedRevision?: number
): Promise<{ page: BinderPage; replacedImageUrl?: string }> {
  return pageTransaction(async tx => {
    await requireOwnedBinder(userId, binderId, tx);
    const existing = await tx.binderPage.findUnique({ where: { binderId_pageNumber: { binderId, pageNumber } } });
    if (!existing) throw new Error('Binder page not found');
    requireRevision(expectedRevision, existing.revision);
    const page = await tx.binderPage.update({
      where: { id: existing.id }, data: { imageUrl, revision: { increment: 1 } }
    });
    return { page: mapPage(page), replacedImageUrl: existing.imageUrl ?? undefined };
  });
}

export async function removeBinderPageImage(
  userId: string,
  binderId: string,
  pageNumber: number
): Promise<string | undefined> {
  return pageTransaction(async tx => {
    await requireOwnedBinder(userId, binderId, tx);
    const existing = await tx.binderPage.findUnique({ where: { binderId_pageNumber: { binderId, pageNumber } } });
    if (!existing) throw new Error('Binder page not found');
    await tx.binderPage.update({
      where: { id: existing.id }, data: { imageUrl: null, revision: { increment: 1 } }
    });
    return existing.imageUrl ?? undefined;
  });
}
