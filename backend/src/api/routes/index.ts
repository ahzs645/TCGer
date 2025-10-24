import type { Express } from 'express';

import { authRouter } from './auth.router';
import { cardsRouter } from './cards.router';
import { collectionsRouter } from './collections.router';
import { healthRouter } from './health.router';
import { settingsRouter } from './settings.router';
import { usersRouter } from './users.router';

export function registerRoutes(app: Express): void {
  app.use('/health', healthRouter);
  app.use('/auth', authRouter);
  app.use('/settings', settingsRouter);
  app.use('/cards', cardsRouter);
  app.use('/collections', collectionsRouter);
  app.use('/users', usersRouter);
}
