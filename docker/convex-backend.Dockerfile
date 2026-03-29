FROM node:20-bookworm-slim AS base
WORKDIR /app

COPY package*.json ./
COPY convex-backend/package*.json ./convex-backend/

RUN npm install

COPY convex-backend ./convex-backend
COPY tsconfig.base.json ./

FROM base AS dev
WORKDIR /app/convex-backend
CMD ["npm", "run", "dev", "--", "--typecheck", "disable", "--tail-logs", "disable"]

FROM base AS production
WORKDIR /app/convex-backend
CMD ["npm", "run", "dev", "--", "--typecheck", "disable", "--tail-logs", "disable"]
