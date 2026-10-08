# syntax=docker/dockerfile:1
FROM node:24-bookworm-slim AS base
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

# Copy monorepo root + workspace package files for dependency resolution
COPY package*.json ./
COPY packages/api-types/package*.json ./packages/api-types/
COPY packages/pack-core/package*.json ./packages/pack-core/
COPY frontend/package*.json ./frontend/
COPY backend/package.json ./backend/
COPY convex-backend/package.json ./convex-backend/
COPY cloudflare/pricing/package.json ./cloudflare/pricing/

# Install workspace dependencies
# The browser scanner uses onnxruntime-web; its Node/CUDA download is unused.
RUN --mount=type=secret,id=proxy_ca \
    if [ -f /run/secrets/proxy_ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/proxy_ca; fi; \
    export GLOBAL_AGENT_HTTP_PROXY="$HTTP_PROXY" GLOBAL_AGENT_HTTPS_PROXY="$HTTPS_PROXY"; \
    npm install --global npm@11.19.0 --no-audit --no-fund \
    && ONNXRUNTIME_NODE_INSTALL=skip npm ci --workspace=@tcg/frontend --workspace=@tcg/api-types --include-workspace-root=false --no-audit --no-fund

# --- Development target ---
FROM base AS dev
# Keep source copies in the stages that need them. The production build uses
# one install/build layer and a cache of downloaded npm packages.
COPY packages ./packages
COPY frontend ./frontend
COPY tsconfig.base.json ./
# The development command checks the shared source contract before starting.
COPY .github ./.github
COPY backend ./backend
COPY convex-backend ./convex-backend
COPY docs ./docs
COPY marketing-site ./marketing-site
COPY mobile-apps ./mobile-apps
COPY mobile-parity ./mobile-parity
COPY tools ./tools
RUN npm run --workspace=packages/api-types build
WORKDIR /app/frontend
CMD ["npm", "run", "dev", "--", "--hostname", "0.0.0.0", "--port", "3000"]

# --- Build target ---
FROM node:24-bookworm-slim AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY . .
ARG NEXT_PUBLIC_SITE_URL=http://localhost:3000
ENV NEXT_PUBLIC_SITE_URL=${NEXT_PUBLIC_SITE_URL}
ARG NEXT_PUBLIC_API_BASE_URL=http://localhost:3000/api
ENV NEXT_PUBLIC_API_BASE_URL=${NEXT_PUBLIC_API_BASE_URL}
ARG NEXT_PUBLIC_CONVEX_URL=http://localhost:3210
ENV NEXT_PUBLIC_CONVEX_URL=${NEXT_PUBLIC_CONVEX_URL}
ARG NEXT_PUBLIC_CONVEX_SITE_URL=http://localhost:3211
ENV NEXT_PUBLIC_CONVEX_SITE_URL=${NEXT_PUBLIC_CONVEX_SITE_URL}
ARG BACKEND_API_ORIGIN=http://backend:3000
ENV BACKEND_API_ORIGIN=${BACKEND_API_ORIGIN}
ARG NEXT_PUBLIC_CATALOG_BASE_URL=https://assets.tcger.ahmadjalil.com/catalogs
ENV NEXT_PUBLIC_CATALOG_BASE_URL=${NEXT_PUBLIC_CATALOG_BASE_URL}
ARG NEXT_PUBLIC_SCAN_INDEX_BASE_URL=https://assets.tcger.ahmadjalil.com/scan-index
ENV NEXT_PUBLIC_SCAN_INDEX_BASE_URL=${NEXT_PUBLIC_SCAN_INDEX_BASE_URL}
# Build and assemble only traced runtime files. Cache npm downloads between
# source changes; the optional session CA applies only to build-time requests.
RUN --mount=type=secret,id=proxy_ca --mount=type=cache,target=/root/.npm \
    if [ -f /run/secrets/proxy_ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/proxy_ca; fi; \
    export GLOBAL_AGENT_HTTP_PROXY="$HTTP_PROXY" GLOBAL_AGENT_HTTPS_PROXY="$HTTPS_PROXY"; \
    npm install --global npm@11.19.0 --no-audit --no-fund \
    && ONNXRUNTIME_NODE_INSTALL=skip npm ci --workspace=@tcg/frontend --workspace=@tcg/api-types --include-workspace-root=false --no-audit --no-fund \
    && npm run --workspace=packages/api-types build \
    && cd frontend \
    && npx next build \
    && cp -r public .next/standalone/frontend/public \
    && cp -r .next/static .next/standalone/frontend/.next/static \
    && mv .next/standalone /app/standalone \
    && cd /app \
    && rm -rf node_modules frontend/node_modules frontend/.next packages/api-types/node_modules packages/pack-core/node_modules

# --- Production target ---
FROM node:24-bookworm-slim AS production
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV HOSTNAME=0.0.0.0
ENV PORT=3000

COPY --from=build --chown=node:node /app/standalone ./
USER node
EXPOSE 3000
CMD ["node", "frontend/server.js"]
