import type { Router as ExpressRouter, Express } from 'express';

import { authRouter, setupRouter } from './auth.router';
import { cardsRouter } from './cards.router';
import { env } from '../../config/env';
import { convexAnalyticsRouter } from './analytics.convex.router';
import { convexCollectionsRouter } from './collections.convex.router';
import { convexFinanceRouter } from './finance.convex.router';
import { docsRouter } from './docs.router';
import { healthRouter } from './health.router';
import { newsRouter } from './news.router';
import { createNotImplementedRouter } from './not-implemented.router';
import { pricesRouter } from './prices.router';
import { convexPublicRouter } from './public.convex.router';
import { settingsRouter } from './settings.router';
import { convexSealedRouter } from './sealed.convex.router';
import { convexTradesRouter } from './trades.convex.router';
import { usersRouter } from './users.router';
import { convexWishlistsRouter } from './wishlists.convex.router';
import { convexDecksRouter } from './decks.convex.router';
import { convexGuidesRouter } from './guides.convex.router';
import { convexOnlineCodesRouter } from './online-codes.convex.router';
import { convexScanSessionsRouter } from './scan-sessions.convex.router';
import { gradingRouter } from './grading.router';
import { convexCatalogCorrectionsRouter } from './catalog-corrections.convex.router';
import { convexAlertsRouter } from './alerts.convex.router';
import { convexAutomationsRouter } from './automations.convex.router';
import { convexBanlistsRouter } from './banlists.convex.router';
import { convexNotificationsRouter } from './notifications.convex.router';

async function loadCollectionsRouter(): Promise<ExpressRouter> {
  if (env.BACKEND_MODE === 'convex' || env.COLLECTIONS_BACKEND === 'convex') {
    return convexCollectionsRouter;
  }

  const { collectionsRouter } = await import('./collections.router');
  return collectionsRouter;
}

async function loadWishlistsRouter(): Promise<ExpressRouter> {
  if (env.BACKEND_MODE === 'convex' || env.WISHLISTS_BACKEND === 'convex') {
    return convexWishlistsRouter;
  }

  const { wishlistsRouter } = await import('./wishlists.router');
  return wishlistsRouter;
}

async function registerLegacyRoutes(app: Express) {
  const [
    { notificationsRouter },
    { decksRouter },
    { alertsRouter },
    { financeRouter },
    { shopsRouter },
    { sealedRouter },
    { tradingRouter },
    { analyticsRouter },
    { automationsRouter },
    { shipmentsRouter },
    { publicRouter }
  ] = await Promise.all([
    import('./notifications.router'),
    import('./decks.router'),
    import('./alerts.router'),
    import('./finance.router'),
    import('./shops.router'),
    import('./sealed.router'),
    import('./trading.router'),
    import('./analytics.router'),
    import('./automations.router'),
    import('./shipments.router'),
    import('./public.router')
  ]);

  app.use('/notifications', notificationsRouter);
  app.use('/decks', decksRouter);
  app.use('/alerts', alertsRouter);
  app.use('/finance', financeRouter);
  app.use('/shops', shopsRouter);
  app.use('/sealed', sealedRouter);
  app.use('/trades', tradingRouter);
  app.use('/analytics', analyticsRouter);
  app.use('/automations', automationsRouter);
  app.use('/shipments', shipmentsRouter);
  app.use('/public', publicRouter);
}

export async function registerRoutes(app: Express): Promise<void> {
  const [{ scanRouter }, collectionsRouter, wishlistsRouter] = await Promise.all([
    import('./scan.router'),
    loadCollectionsRouter(),
    loadWishlistsRouter()
  ]);

  app.use('/', docsRouter);
  app.use('/health', healthRouter);
  app.use('/auth', authRouter);
  app.use('/setup', setupRouter);
  app.use('/settings', settingsRouter);
  app.use('/cards/scan', scanRouter);
  app.use('/cards', cardsRouter);
  app.use('/collections', collectionsRouter);
  app.use('/users', usersRouter);
  app.use('/wishlists', wishlistsRouter);
  app.use('/guides', convexGuidesRouter);
  app.use('/news', newsRouter);
  app.use('/prices', pricesRouter);
  app.use('/grading', gradingRouter);
  app.use('/catalog-corrections', convexCatalogCorrectionsRouter);
  app.use('/banlists', convexBanlistsRouter);
  app.use('/online-codes', convexOnlineCodesRouter);
  app.use('/scan-sessions', convexScanSessionsRouter);

  // Convex-native feature routers and explicit legacy-feature availability
  // signals, mounted only in full Convex mode.
  if (env.BACKEND_MODE === 'convex') {
    app.use('/decks', convexDecksRouter);
    app.use('/finance', convexFinanceRouter);
    app.use('/sealed', convexSealedRouter);
    app.use('/analytics', convexAnalyticsRouter);
    app.use('/trades', convexTradesRouter);
    app.use('/notifications', convexNotificationsRouter);
    app.use('/alerts', convexAlertsRouter);
    app.use('/shops', createNotImplementedRouter('shops'));
    app.use('/automations', convexAutomationsRouter);
    app.use('/shipments', createNotImplementedRouter('shipments'));
    app.use('/public', convexPublicRouter);
  }

  if (env.BACKEND_MODE !== 'convex') {
    await registerLegacyRoutes(app);
  }
}
