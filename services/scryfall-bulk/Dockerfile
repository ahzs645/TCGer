FROM node:20-slim

WORKDIR /app
COPY services/scryfall-bulk/package.json ./package.json
COPY services/scryfall-bulk/src ./src

ENV NODE_ENV=production
ENV SCRYFALL_BULK_DATA_DIR=/data
VOLUME ["/data"]

CMD ["node", "src/index.js"]
