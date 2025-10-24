FROM node:20-slim

WORKDIR /app
COPY services/tcgdex-cache/package.json ./package.json
COPY services/tcgdex-cache/src ./src

ENV NODE_ENV=production
ENV TCGDEX_CACHE_DATA_DIR=/data
VOLUME ["/data"]

CMD ["node", "src/index.js"]
