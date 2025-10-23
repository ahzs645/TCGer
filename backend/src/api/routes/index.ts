import type { Express } from 'express';

import { authRouter } from './auth.router';
import { cardsRouter } from './cards.router';
import { healthRouter } from './health.router';
import { settingsRouter } from './settings.router';

export function registerRoutes(app: Express): void {
  app.use('/health', healthRouter);
  app.use('/auth', authRouter);
  app.use('/settings', settingsRouter);
  app.use('/cards', cardsRouter);
}
