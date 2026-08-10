import type { BinderPage, BinderPagePlacement, UpsertBinderPageInput } from '@tcg/api-types';
import type { Prisma } from '@prisma/client';

import { prisma } from '../../lib/prisma';

async function requireOwnedBinder(userId: string, binderId: string) {
  const binder = await prisma.binder.findFirst({
    where: { id: binderId, userId },
    select: { id: true }
  });
  if (!binder) {
    throw new Error('Binder not found');
  }
  return binder;
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
  await requireOwnedBinder(userId, binderId);
  const capturedAt = input.capturedAt ? new Date(input.capturedAt) : new Date();
  const placements = input.placements as unknown as Prisma.InputJsonValue;
  const page = await prisma.binderPage.upsert({
    where: {
      binderId_pageNumber: { binderId, pageNumber: input.pageNumber }
    },
    create: {
      binderId,
      pageNumber: input.pageNumber,
      capturedAt,
      placements
    },
    update: {
      capturedAt,
      placements,
      revision: { increment: 1 }
    }
  });
  return mapPage(page);
}

export async function replaceBinderPageImage(
  userId: string,
  binderId: string,
  pageNumber: number,
  imageUrl: string
): Promise<{ page: BinderPage; replacedImageUrl?: string }> {
  await requireOwnedBinder(userId, binderId);
  const existing = await prisma.binderPage.findUnique({
    where: { binderId_pageNumber: { binderId, pageNumber } }
  });
  if (!existing) {
    throw new Error('Binder page not found');
  }
  const page = await prisma.binderPage.update({
    where: { id: existing.id },
    data: { imageUrl }
  });
  return { page: mapPage(page), replacedImageUrl: existing.imageUrl ?? undefined };
}

export async function removeBinderPageImage(
  userId: string,
  binderId: string,
  pageNumber: number
): Promise<string | undefined> {
  await requireOwnedBinder(userId, binderId);
  const existing = await prisma.binderPage.findUnique({
    where: { binderId_pageNumber: { binderId, pageNumber } }
  });
  if (!existing) {
    throw new Error('Binder page not found');
  }
  await prisma.binderPage.update({
    where: { id: existing.id },
    data: { imageUrl: null }
  });
  return existing.imageUrl ?? undefined;
}
