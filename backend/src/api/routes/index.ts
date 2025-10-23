import type { Express } from 'express';

import { cardsRouter } from './cards.router';
import { healthRouter } from './health.router';

export function registerRoutes(app: Express): void {
  app.use('/health', healthRouter);
  app.use('/cards', cardsRouter);
}
