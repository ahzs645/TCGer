FROM node:18-alpine AS base
WORKDIR /app/backend

# Install OpenSSL for Prisma
RUN apk add --no-cache openssl

COPY backend/package*.json ./
RUN npm install

COPY backend .
COPY docs /app/docs
COPY tsconfig.base.json /app/tsconfig.base.json

FROM base AS dev
CMD ["npm", "run", "dev"]

FROM base AS build
RUN npm run build

FROM node:18-alpine AS production
WORKDIR /app/backend
ENV NODE_ENV=production

COPY --from=build /app/backend/dist ./dist
COPY backend/package*.json ./
RUN npm install --omit=dev
COPY backend/prisma ./prisma
COPY docs /app/docs

EXPOSE 3000
CMD ["node", "dist/server.js"]
