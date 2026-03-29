import type { Router as ExpressRouter, Express } from 'express';

import { authRouter, setupRouter } from './auth.router';
import { cardsRouter } from './cards.router';
import { env } from '../../config/env';
import { convexCollectionsRouter } from './collections.convex.router';
import { docsRouter } from './docs.router';
import { healthRouter } from './health.router';
import { newsRouter } from './news.router';
import { settingsRouter } from './settings.router';
import { usersRouter } from './users.router';
import { convexWishlistsRouter } from './wishlists.convex.router';

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
    { scanRouter },
    { notificationsRouter },
    { decksRouter },
    { alertsRouter },
    { financeRouter },
    { pricesRouter },
    { shopsRouter },
    { sealedRouter },
    { tradingRouter },
    { analyticsRouter },
    { automationsRouter },
    { shipmentsRouter },
    { publicRouter }
  ] = await Promise.all([
    import('./scan.router'),
    import('./notifications.router'),
    import('./decks.router'),
    import('./alerts.router'),
    import('./finance.router'),
    import('./prices.router'),
    import('./shops.router'),
    import('./sealed.router'),
    import('./trading.router'),
    import('./analytics.router'),
    import('./automations.router'),
    import('./shipments.router'),
    import('./public.router')
  ]);

  app.use('/cards/scan', scanRouter);
  app.use('/notifications', notificationsRouter);
  app.use('/decks', decksRouter);
  app.use('/alerts', alertsRouter);
  app.use('/finance', financeRouter);
  app.use('/prices', pricesRouter);
  app.use('/shops', shopsRouter);
  app.use('/sealed', sealedRouter);
  app.use('/trades', tradingRouter);
  app.use('/analytics', analyticsRouter);
  app.use('/automations', automationsRouter);
  app.use('/shipments', shipmentsRouter);
  app.use('/public', publicRouter);
}

export async function registerRoutes(app: Express): Promise<void> {
  const [collectionsRouter, wishlistsRouter] = await Promise.all([
    loadCollectionsRouter(),
    loadWishlistsRouter()
  ]);

  app.use('/', docsRouter);
  app.use('/health', healthRouter);
  app.use('/auth', authRouter);
  app.use('/setup', setupRouter);
  app.use('/settings', settingsRouter);
  app.use('/cards', cardsRouter);
  app.use('/collections', collectionsRouter);
  app.use('/users', usersRouter);
  app.use('/wishlists', wishlistsRouter);
  app.use('/news', newsRouter);

  if (env.BACKEND_MODE !== 'convex') {
    await registerLegacyRoutes(app);
  }
}
