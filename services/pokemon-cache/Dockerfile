FROM node:20-slim

WORKDIR /app
COPY services/pokemon-cache/package.json ./package.json
COPY services/pokemon-cache/src ./src

ENV NODE_ENV=production
ENV POKEMON_CACHE_DATA_DIR=/data
VOLUME ["/data"]

CMD ["node", "src/index.js"]
