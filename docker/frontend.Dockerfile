FROM node:20-bookworm-slim AS base
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

# Copy monorepo root + workspace package files for dependency resolution
COPY package*.json ./
COPY packages/api-types/package*.json ./packages/api-types/
COPY frontend/package*.json ./frontend/

# Install workspace dependencies
RUN npm install

# Copy workspace sources
COPY packages/api-types ./packages/api-types
COPY frontend ./frontend
COPY tsconfig.base.json ./

# --- Development target ---
FROM base AS dev
WORKDIR /app/frontend
CMD ["npm", "run", "dev", "--", "--hostname", "0.0.0.0", "--port", "3000"]

# --- Build target ---
FROM base AS build
# Build shared types first
RUN cd packages/api-types && npx tsc -p tsconfig.build.json --skipLibCheck || true
# Build frontend
WORKDIR /app/frontend
RUN npx next build

# --- Production target ---
FROM node:20-bookworm-slim AS production
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# Copy monorepo structure for workspace resolution
COPY --from=build /app/package*.json ./
COPY --from=build /app/packages/api-types ./packages/api-types
COPY --from=build /app/frontend/.next ./frontend/.next
COPY --from=build /app/frontend/public ./frontend/public
COPY --from=build /app/frontend/package*.json ./frontend/
COPY --from=build /app/frontend/next.config.mjs ./frontend/next.config.mjs
COPY --from=build /app/node_modules ./node_modules
COPY tsconfig.base.json ./

WORKDIR /app/frontend
EXPOSE 3000
CMD ["npx", "next", "start"]
