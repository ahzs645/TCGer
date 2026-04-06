import compression from 'compression';
import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import pinoHttp from 'pino-http';

import { env } from './config/env';
import { errorHandler } from './api/middleware/error-handler';
import { notFoundHandler } from './api/middleware/not-found';
import { registerRoutes } from './api/routes';
import { getUploadsRootDir } from './utils/upload';

export async function createApp() {
  const app = express();

  app.use(
    pinoHttp({
      autoLogging: env.NODE_ENV !== 'test'
    })
  );
  app.use(helmet());
  app.use(
    cors({
      origin: env.APP_ORIGIN || true,
      credentials: true
    })
  );
  app.use(compression());

  app.use(express.json());

  // Serve uploaded images
  app.use('/uploads', express.static(getUploadsRootDir()));

  await registerRoutes(app);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
