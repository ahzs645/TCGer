FROM node:18-alpine AS base
WORKDIR /app/frontend
ENV NEXT_TELEMETRY_DISABLED=1

COPY frontend/package*.json ./
RUN npm install

COPY frontend .
COPY tsconfig.base.json /app/tsconfig.base.json

FROM base AS dev
CMD ["npm", "run", "dev", "--", "--hostname", "0.0.0.0", "--port", "3000"]

FROM base AS build
RUN npm run build

FROM node:18-alpine AS production
WORKDIR /app/frontend
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

COPY --from=build /app/frontend/.next ./.next
COPY --from=build /app/frontend/public ./public
COPY frontend/package*.json ./
RUN npm install --omit=dev
COPY frontend/next.config.mjs ./next.config.mjs
COPY tsconfig.base.json /app/tsconfig.base.json

EXPOSE 3000
CMD ["npm", "run", "start"]
