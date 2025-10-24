FROM node:20-slim

WORKDIR /app
COPY package.json ./package.json
COPY src ./src

ENV NODE_ENV=production
ENV SCRYFALL_BULK_DATA_DIR=/data
VOLUME ["/data"]

CMD ["node", "src/index.js"]
