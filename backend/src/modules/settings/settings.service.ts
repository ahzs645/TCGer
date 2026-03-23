import { prisma } from '../../lib/prisma';

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

/** Strip sensitive fields for non-admin responses */
export function stripApiKeys(settings: Record<string, unknown>) {
  const { scrydexApiKey, scrydexTeamId, scryfallApiBaseUrl, ygoApiBaseUrl, scrydexApiBaseUrl, tcgdexApiBaseUrl, ...public_ } = settings as Record<string, unknown>;
  return public_;
}

export async function updateAppSettings(data: {
  publicDashboard?: boolean;
  publicCollections?: boolean;
  requireAuth?: boolean;
  appName?: string;
  scrydexApiKey?: string | null;
  scrydexTeamId?: string | null;
  scryfallApiBaseUrl?: string | null;
  ygoApiBaseUrl?: string | null;
  scrydexApiBaseUrl?: string | null;
  tcgdexApiBaseUrl?: string | null;
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
