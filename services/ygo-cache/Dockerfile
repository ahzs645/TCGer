FROM node:20-slim

WORKDIR /app
COPY services/ygo-cache/package.json ./package.json
COPY services/ygo-cache/src ./src

ENV NODE_ENV=production
ENV YGO_CACHE_DATA_DIR=/data
VOLUME ["/data"]

CMD ["node", "src/index.js"]
