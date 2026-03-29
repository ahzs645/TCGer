import type { Express } from 'express';

import { setupRouter } from './auth.router';
import { cardsRouter } from './cards.router';
import { collectionsRouter } from './collections.router';
import { docsRouter } from './docs.router';
import { healthRouter } from './health.router';
import { scanRouter } from './scan.router';
import { settingsRouter } from './settings.router';
import { usersRouter } from './users.router';
import { wishlistsRouter } from './wishlists.router';
import { notificationsRouter } from './notifications.router';
import { decksRouter } from './decks.router';
import { alertsRouter } from './alerts.router';
import { financeRouter } from './finance.router';
import { pricesRouter } from './prices.router';
import { shopsRouter } from './shops.router';
import { sealedRouter } from './sealed.router';
import { tradingRouter } from './trading.router';
import { analyticsRouter } from './analytics.router';
import { automationsRouter } from './automations.router';
import { shipmentsRouter } from './shipments.router';
import { newsRouter } from './news.router';
import { publicRouter } from './public.router';

export function registerRoutes(app: Express): void {
  app.use('/', docsRouter);
  app.use('/health', healthRouter);
  // Better Auth handles /auth/* (sign-up, sign-in, session, etc.) via app.ts
  app.use('/setup', setupRouter);
  app.use('/settings', settingsRouter);
  app.use('/cards', cardsRouter);
  app.use('/cards/scan', scanRouter);
  app.use('/collections', collectionsRouter);
  app.use('/users', usersRouter);
  app.use('/wishlists', wishlistsRouter);
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
  app.use('/news', newsRouter);
  app.use('/public', publicRouter);
}
