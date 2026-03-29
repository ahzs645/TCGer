# Docker Setup

## Development — Frontend on Host (Recommended)

Best for active frontend development with fast hot reload:

```bash
cp ../.env.docker.example ../.env.docker

# Start backend stack (convex-backend, backend)
docker compose -f docker-compose.yml --env-file ../.env.docker up --build

# In a separate terminal, run the frontend on your host
cd ../frontend
NEXT_PUBLIC_API_BASE_URL=http://localhost:3001 npm run dev
```

This starts:
- `convex-backend` serving Convex functions and Better Auth
- `backend` running `npm run dev` with hot reload (code mounted from your host), exposed on `localhost:3001`

The frontend runs natively on your machine with full Next.js hot reload speed. It connects to the backend directly at `http://localhost:3001` (no `/api` prefix — that's only used with the nginx gateway).

## Development — Full Docker Stack

Run everything in Docker (frontend hot reload is slightly slower due to container file watching):

```bash
cp ../.env.docker.example ../.env.docker
docker compose -f docker-compose.yml --env-file ../.env.docker --profile frontend up --build
```

This additionally starts:
- `frontend` running Next.js dev server in a container
- `gateway` (nginx) exposing the stack on `http://localhost:${APP_PORT:-3000}` and proxying `/api` traffic to the backend
- `gateway` also proxies `/api/auth` to the Next.js app, which forwards auth traffic to Convex

## Legacy Prisma Mode

The default Compose setup is now Convex-first and does not start Postgres unless you opt into the `legacy` profile.

Use this only for still-unmigrated Prisma routes:

```bash
BACKEND_MODE=hybrid docker compose -f docker-compose.yml --env-file ../.env.docker --profile legacy up --build
```

This adds:
- `postgres` for legacy Prisma-backed routes
- hybrid backend startup with `prisma db push`

## Optional Services

Enable card data cache services with the `bulk` profile:

```bash
# Backend-only + bulk caches
docker compose --env-file ../.env.docker --profile bulk up --build

# Full stack + bulk caches
docker compose --env-file ../.env.docker --profile frontend --profile bulk up --build
```

- `scryfall-bulk` — Magic card cache. Set `SCRYFALL_API_BASE_URL=http://scryfall-bulk:4010`.
- `ygo-cache` — Yu-Gi-Oh! dataset mirror. Set `YGO_API_BASE_URL=http://ygo-cache:4020`.
- `tcgdex-cache` — Pokémon card database (21,632+ cards). Used by default (`POKEMON_API_BASE_URL=http://tcgdex-cache:4040`).
- `pokemon-cache` — (deprecated) Use tcgdex-cache instead.

## Production Build
```bash
docker compose -f docker-compose.prod.yml --env-file ../.env.docker up --build -d
```

Uses compiled TypeScript/Next.js output with no development volumes. Add `--profile bulk` for cache services in production.

For legacy Prisma-backed production routes, also add `--profile legacy BACKEND_MODE=hybrid`.

## Notes
- Node modules live inside the container; each start runs `npm install` to sync dependencies.
- In full Docker mode, access the frontend at `http://localhost:${APP_PORT:-3000}`. API requests are served at `http://localhost:${APP_PORT:-3000}/api`.
- In host frontend mode, the backend is exposed on `localhost:${BACKEND_PORT:-3001}`.
- Postgres is only started when the `legacy` profile is enabled. When active, the database is accessible on `localhost:5432` with credentials from `.env.docker`.

## Common Commands
- `docker compose down` — stop and remove containers.
- `docker compose --profile legacy down -v` — also delete the Postgres volume when the legacy profile is active.
- `docker compose logs -f backend` — tail backend logs.
