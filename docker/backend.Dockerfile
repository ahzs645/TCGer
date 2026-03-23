FROM node:18-alpine AS base
WORKDIR /app

# Install OpenSSL for Prisma
RUN apk add --no-cache openssl

# Copy monorepo root + workspace package files for dependency resolution
COPY package*.json ./
COPY packages/api-types/package*.json ./packages/api-types/
COPY backend/package*.json ./backend/

# Install workspace dependencies
RUN npm install

# Copy workspace sources
COPY packages/api-types ./packages/api-types
COPY backend ./backend
COPY docs ./docs
COPY tsconfig.base.json ./

# --- Development target ---
FROM base AS dev
WORKDIR /app/backend
CMD ["npm", "run", "dev"]

# --- Build target ---
FROM base AS build
# Build shared types first, then backend
RUN npm run --workspace=packages/api-types build
WORKDIR /app/backend
RUN npx prisma generate && (npx tsc -p tsconfig.build.json --skipLibCheck || true) && test -f dist/server.js

# --- Production target ---
FROM node:18-alpine AS production
WORKDIR /app
ENV NODE_ENV=production

RUN apk add --no-cache openssl

# Copy monorepo structure for workspace resolution
COPY --from=build /app/package*.json ./
COPY --from=build /app/packages/api-types ./packages/api-types
COPY --from=build /app/backend/dist ./backend/dist
COPY --from=build /app/backend/package*.json ./backend/
COPY --from=build /app/backend/prisma ./backend/prisma
COPY --from=build /app/node_modules ./node_modules
COPY docs ./docs

WORKDIR /app/backend
EXPOSE 3000
CMD ["sh", "-c", "npx prisma migrate deploy 2>/dev/null; node dist/server.js"]
