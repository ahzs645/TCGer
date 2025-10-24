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
- `frontend` running Next.js dev server (ports map to `${FRONTEND_PORT}`)
- Optional: `scryfall-bulk` lightweight cache for Magic queries. Enable with `docker compose --profile bulk up` and set `SCRYFALL_API_BASE_URL=http://scryfall-bulk:4010`.
- Optional: `ygo-cache` local Yu-Gi-Oh! dataset mirror. Enable with the same `bulk` profile and set `YGO_API_BASE_URL=http://ygo-cache:4020`.

### Notes
- Node modules live inside the container; each start runs `npm install` to sync dependencies.
- Backend listens on `http://localhost:${BACKEND_PORT:-3000}` (set `BACKEND_PORT` in `.env.docker`). Health check at `/health`.
- Frontend listens on `http://localhost:${FRONTEND_PORT:-3001}`. Update `NEXT_PUBLIC_API_BASE_URL` if you expose the API elsewhere.
- Set `SCRYFALL_API_BASE_URL` to `http://scryfall-bulk:4010` to have the backend use the local bulk data cache; otherwise it defaults to the public Scryfall API.
- Set `YGO_API_BASE_URL` to `http://ygo-cache:4020` when the Yu-Gi-Oh! cache is running; otherwise the backend uses the public YGOPRODeck API directly.
- Database accessible on `localhost:5432` with credentials from `.env.docker`.

## Production Build
```bash
docker compose -f docker-compose.prod.yml --env-file ../.env.docker up --build -d
```

This uses the `production` stages of the backend and frontend images, runs compiled TypeScript/Next.js output, and omits development volumes.
Add `--profile bulk` to the command if you want the cache services in production and point `SCRYFALL_API_BASE_URL`/`YGO_API_BASE_URL` at `http://scryfall-bulk:4010` and `http://ygo-cache:4020` respectively.

## Common Commands
- `docker compose down` — stop and remove containers.
- `docker compose down -v` — also delete the Postgres volume.
- `docker compose logs -f backend` — tail backend logs.

## Next Steps
- Add frontend service once the Next.js app is scaffolded.
- Wire Prisma migrations into an entrypoint script (e.g., `npx prisma migrate deploy`) before the backend starts.
