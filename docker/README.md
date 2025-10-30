# Docker Setup

## Development Stack
```bash
cp ../.env.docker.example ../.env.docker
docker compose -f docker-compose.yml --env-file ../.env.docker up --build
```

This starts:
- `postgres` (15-alpine) with automatic health checks
- `redis` (7-alpine)
- `backend` running `npm run dev` with hot reload (code mounted from your host)
- `frontend` running Next.js dev server
- `gateway` (nginx) exposing the stack on `http://localhost:${APP_PORT:-3000}` and proxying `/api` traffic to the backend
- Optional: `scryfall-bulk` lightweight cache for Magic queries. Enable with `docker compose --profile bulk up` and set `SCRYFALL_API_BASE_URL=http://scryfall-bulk:4010`.
- Optional: `ygo-cache` local Yu-Gi-Oh! dataset mirror. Enable with the same `bulk` profile and set `YGO_API_BASE_URL=http://ygo-cache:4020`.
- Optional: `tcgdex-cache` comprehensive Pokémon card database (21,632+ cards). Enable via the `bulk` profile. Used by default for Pokemon searches (`POKEMON_API_BASE_URL=http://tcgdex-cache:4040`).
- Optional: `pokemon-cache` (deprecated due to upstream API instability) - use tcgdex-cache instead.

### Notes
- Node modules live inside the container; each start runs `npm install` to sync dependencies.
- Access the frontend at `http://localhost:${APP_PORT:-3000}`. API requests are served from the same origin at `http://localhost:${APP_PORT:-3000}/api`.
- Update `NEXT_PUBLIC_API_BASE_URL` to the public origin you deploy behind the gateway (include the `/api` suffix). Update `APP_PORT` if you need to expose a different host port locally.
- Set `SCRYFALL_API_BASE_URL` to `http://scryfall-bulk:4010` to have the backend use the local bulk data cache; otherwise it defaults to the public Scryfall API.
- Set `YGO_API_BASE_URL` to `http://ygo-cache:4020` when the Yu-Gi-Oh! cache is running; otherwise the backend uses the public YGOPRODeck API directly.
- Set `POKEMON_API_BASE_URL` to `http://tcgdex-cache:4040` (default) for fast Pokemon card searches using TCGdex's comprehensive database. The pokemon-cache service is deprecated due to upstream Pokemon TCG API instability.
- Both `POKEMON_API_BASE_URL` and `TCGDEX_API_BASE_URL` point to the same tcgdex-cache service, which provides Pokemon card data and variant enrichment.
- Database accessible on `localhost:5432` with credentials from `.env.docker`.

## Production Build
```bash
docker compose -f docker-compose.prod.yml --env-file ../.env.docker up --build -d
```

This uses the `production` stages of the backend and frontend images, runs compiled TypeScript/Next.js output, and omits development volumes.
Add `--profile bulk` to the command if you want the cache services in production. The default configuration points `POKEMON_API_BASE_URL` and `TCGDEX_API_BASE_URL` to `http://tcgdex-cache:4040` for Pokemon card data and variant enrichment.

## Common Commands
- `docker compose down` — stop and remove containers.
- `docker compose down -v` — also delete the Postgres volume.
- `docker compose logs -f backend` — tail backend logs.

## Next Steps
- Add frontend service once the Next.js app is scaffolded.
- Wire Prisma migrations into an entrypoint script (e.g., `npx prisma migrate deploy`) before the backend starts.
