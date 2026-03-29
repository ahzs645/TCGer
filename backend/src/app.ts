import path from 'node:path';
import compression from 'compression';
import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import pinoHttp from 'pino-http';
import { toNodeHandler } from 'better-auth/node';

import { auth } from './lib/auth';
import { env } from './config/env';
import { errorHandler } from './api/middleware/error-handler';
import { notFoundHandler } from './api/middleware/not-found';
import { registerRoutes } from './api/routes';

const app = express();

app.use(
  pinoHttp({
    autoLogging: env.NODE_ENV !== 'test'
  })
);
app.use(helmet());
app.use(
  cors({
    origin: env.BETTER_AUTH_URL || true,
    credentials: true
  })
);
app.use(compression());

// Better Auth handler MUST be mounted before express.json()
// Express v4 uses wildcard pattern /auth/*
app.all('/auth/*', toNodeHandler(auth));

app.use(express.json());

// Serve uploaded images
app.use('/uploads', express.static(path.resolve(process.cwd(), 'uploads')));

registerRoutes(app);

app.use(notFoundHandler);
app.use(errorHandler);

export { app };
