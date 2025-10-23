import compression from 'compression';
import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import pinoHttp from 'pino-http';

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
app.use(cors());
app.use(compression());
app.use(express.json());

registerRoutes(app);

app.use(notFoundHandler);
app.use(errorHandler);

export { app };
