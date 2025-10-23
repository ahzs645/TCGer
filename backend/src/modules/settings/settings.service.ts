import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export async function getAppSettings() {
  let settings = await prisma.appSettings.findUnique({ where: { id: 1 } });

  if (!settings) {
    // Create default settings if they don't exist
    settings = await prisma.appSettings.create({
      data: {
        id: 1,
        publicDashboard: false,
        publicCollections: false,
        requireAuth: true,
        appName: 'TCG Manager'
      }
    });
  }

  return settings;
}

export async function updateAppSettings(data: {
  publicDashboard?: boolean;
  publicCollections?: boolean;
  requireAuth?: boolean;
  appName?: string;
}) {
  return prisma.appSettings.upsert({
    where: { id: 1 },
    update: data,
    create: {
      id: 1,
      publicDashboard: data.publicDashboard ?? false,
      publicCollections: data.publicCollections ?? false,
      requireAuth: data.requireAuth ?? true,
      appName: data.appName ?? 'TCG Manager'
    }
  });
}

export async function isPublicDashboardEnabled() {
  const settings = await getAppSettings();
  return settings.publicDashboard;
}

export async function isPublicCollectionsEnabled() {
  const settings = await getAppSettings();
  return settings.publicCollections;
}
