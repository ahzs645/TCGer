# syntax=docker/dockerfile:1
FROM node:24-bookworm-slim AS base
WORKDIR /app

COPY package*.json ./
COPY convex-backend/package*.json ./convex-backend/
COPY frontend/package.json ./frontend/
COPY backend/package.json ./backend/
COPY cloudflare/pricing/package.json ./cloudflare/pricing/
COPY packages/api-types/package.json ./packages/api-types/
COPY packages/pack-core/package.json ./packages/pack-core/

RUN --mount=type=secret,id=proxy_ca \
    if [ -f /run/secrets/proxy_ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/proxy_ca; fi; \
    npm install --global npm@11.19.0 --no-audit --no-fund \
    && npm ci --workspace=@tcg/convex-backend --workspace=@tcg/api-types --include-workspace-root=false --no-audit --no-fund

COPY convex-backend ./convex-backend
COPY packages/api-types ./packages/api-types
COPY tsconfig.base.json ./
RUN npm run --workspace=packages/api-types build

FROM base AS dev
WORKDIR /app/convex-backend
CMD ["npm", "run", "dev", "--", "--typecheck", "disable", "--tail-logs", "disable"]

FROM base AS deploy
WORKDIR /app/convex-backend
CMD ["npx", "--no-install", "convex", "deploy"]
