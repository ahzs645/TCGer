FROM node:20-slim

WORKDIR /app
COPY package.json ./package.json
COPY src ./src

ENV NODE_ENV=production
ENV YGO_CACHE_DATA_DIR=/data
VOLUME ["/data"]

CMD ["node", "src/index.js"]
