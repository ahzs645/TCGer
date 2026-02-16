import fs from 'fs';
import { promises as fsPromises } from 'fs';
import path from 'path';
import { Router } from 'express';
import swaggerUi from 'swagger-ui-express';

import { asyncHandler } from '../../utils/async-handler';

const openApiPathCandidates = [
  path.resolve(process.cwd(), '../docs/openapi.yaml'),
  path.resolve(process.cwd(), 'docs/openapi.yaml'),
  path.resolve(__dirname, '../../../../docs/openapi.yaml'),
  '/app/docs/openapi.yaml'
];

function resolveOpenApiPath() {
  for (const candidate of openApiPathCandidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  throw new Error(`OpenAPI spec not found. Checked: ${openApiPathCandidates.join(', ')}`);
}

const openApiPath = resolveOpenApiPath();
const swaggerUiOptions = {
  explorer: true,
  swaggerOptions: {
    url: '../openapi.yaml'
  }
};

export const docsRouter = Router();

docsRouter.get(
  '/openapi.yaml',
  asyncHandler(async (_req, res) => {
    const fileContents = await fsPromises.readFile(openApiPath, 'utf8');
    res.type('application/yaml').send(fileContents);
  })
);

docsRouter.use('/docs', swaggerUi.serve);
docsRouter.get('/docs', swaggerUi.setup(undefined, swaggerUiOptions));
docsRouter.get('/docs/', swaggerUi.setup(undefined, swaggerUiOptions));
