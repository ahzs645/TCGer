# Docker Setup

## Development — Frontend on Host (Recommended)

Best for active frontend development with fast hot reload:

```bash
cd ..
cp .env.docker.example .env.docker
cp frontend/.env.local.example frontend/.env.local

# Replace BETTER_AUTH_SECRET and TCGER_BRIDGE_SECRET in .env.docker.
# Use different random values of at least 32 characters.

# Start backend, Postgres, and cache services in Docker
npm run docker:dev:legacy:bulk

# In a separate terminal, run the frontend on your host
npm run dev:frontend
```

This starts:
- `convex-backend` serving Convex functions and Better Auth
- `backend` running `npm run dev` with hot reload (code mounted from your host), exposed on `localhost:3004`
- `postgres` on `localhost:5432`
- `scryfall-bulk`, `ygo-cache`, and `tcgdex-cache`

The frontend runs natively on your machine with full Next.js hot reload speed at `http://localhost:3003`. It connects to the backend directly at `http://localhost:3004` (no `/api` prefix — that path is only used when you run the nginx gateway in full Docker mode). Collection bridge requests always go through this authenticated Express API; browser code must not call Convex HTTP actions or send `X-TCGER-*` identity headers directly.

If the default ports are already in use, override `APP_PORT`, `BACKEND_PORT`, `CONVEX_PORT`, or `CONVEX_SITE_PORT` in `.env.docker` before starting the stack.

## Development — Full Docker Stack

Run everything in Docker (frontend hot reload is slightly slower due to container file watching):

```bash
cd ..
cp .env.docker.example .env.docker
npm run docker:dev:full
```

This additionally starts:
- `frontend` running Next.js dev server in a container
- `gateway` (nginx) exposing the stack on `http://localhost:${APP_PORT:-3003}` and proxying `/api` traffic to the backend
- `gateway` also proxies `/api/auth` to the Next.js app, which forwards auth traffic to Convex

## Legacy Prisma Mode

The default Compose setup is now Convex-first and does not start Postgres unless you opt into the `legacy` profile.

Use this only for still-unmigrated Prisma routes:

```bash
npm run docker:dev:legacy
```

This adds:
- `postgres` for legacy Prisma-backed routes
- hybrid backend startup with `prisma db push`

## Optional Services

Enable card data cache services with the `bulk` profile:

```bash
# Backend-only + bulk caches
npm run docker:dev:bulk

# Full stack + bulk caches
npm run docker:dev:full:bulk
```

- `scryfall-bulk` — Magic card cache. Set `SCRYFALL_API_BASE_URL=http://scryfall-bulk:4010`.
- `ygo-cache` — Yu-Gi-Oh! dataset mirror. Set `YGO_API_BASE_URL=http://ygo-cache:4020`.
- `tcgdex-cache` — Pokémon card database (21,632+ cards). Used by default (`POKEMON_API_BASE_URL=http://tcgdex-cache:4040`).
- `pokemon-cache` — (deprecated) Use tcgdex-cache instead.

## Dedicated Card Hash Builds

Use the separate card-scan compose file when you want to build a standalone local Pokemon library plus hash map without starting the app stack:

```bash
cd ..
cp .env.docker.example .env.docker
CARD_HASH_BUILD_FORCE=true npm run docker:hash:pokemon
```

This starts only:
- `tcgdex-cache` for the cached Pokemon dataset and image proxy
- `card-hash-builder` for the one-shot pHash build

Useful overrides:
- `CARD_HASH_BUILD_LIMIT=250` — smoke test on a smaller subset
- `CARD_HASH_BUILD_SET_CODE=sv7` — build a single Pokemon set
- `CARD_HASH_BUILD_CONCURRENCY=8` — raise hashing concurrency
- `CARD_SCAN_NODE_MAX_OLD_SPACE_SIZE=6144` — give the builder more heap for very large runs

The resulting artifacts are stored in the named volume `tcger_card_scan_data`:
- `/data/card-scan/hashes.json` — app-compatible hash store
- `/data/card-library/pokemon/index.json` — standalone metadata + hash index
- `/data/card-library/pokemon/images/...` — local card-image corpus

## Production Build

Production uses Convex's official self-hosted backend image. Unlike the development stack, it does not run `convex dev`, and ports 3210/3211 are exposed only to `tcg-net` rather than published on the host.

### First boot

```bash
cp .env.docker.example .env.docker

# Put the output in INSTANCE_SECRET in .env.docker. It must remain stable.
openssl rand -hex 32

# Start only the database service; no admin key exists yet.
docker compose -f docker/docker-compose.prod.yml --env-file .env.docker up -d convex-backend

# Put the printed key in CONVEX_SELF_HOSTED_ADMIN_KEY in .env.docker.
docker compose -f docker/docker-compose.prod.yml --env-file .env.docker \
  exec convex-backend ./generate_admin_key.sh

# Set the Convex deployment environment and deploy the functions once.
docker compose -f docker/docker-compose.prod.yml --env-file .env.docker \
  --profile deploy run --rm convex-deploy

# Start the application. The deploy profile is not part of normal startup.
docker compose -f docker/docker-compose.prod.yml --env-file .env.docker up --build -d
```

Uses compiled TypeScript/Next.js output with no development volumes. Add `--profile bulk` for cache services in production.

Run the `convex-deploy` command again after changing Convex functions or any deployment environment value. It sets the environment before deploying, which is required because non-local TCGer deployments fail closed when either application secret is absent. `BETTER_AUTH_SECRET` and `TCGER_BRIDGE_SECRET` are passed to the deploy runner; they are not process environment variables on the official backend container. The CLI stores them as Convex deployment environment variables. The bridge secret is also passed to Express so both sides authenticate internal compatibility-route traffic with the same value.

For externally reachable production, route one HTTPS origin to `convex-backend:3210` and a second HTTPS origin to `convex-backend:3211` from a reverse proxy attached to `tcg-net`. Set `CONVEX_CLOUD_ORIGIN`/`NEXT_PUBLIC_CONVEX_URL` to the first origin and `CONVEX_SITE_ORIGIN`/`NEXT_PUBLIC_CONVEX_SITE_URL` to the second. Do not publish 3210/3211 directly. The Compose defaults are safe internal bootstrap/server-proxy origins; the browser app requires the externally routed values.

The optional official dashboard was deliberately not added: it needs a separate browser-reachable routed origin, while this production file keeps Convex management endpoints internal. Use the CLI deploy runner for administration.

### Production variables

| Name | Purpose | Where it is set/used |
| --- | --- | --- |
| `INSTANCE_NAME` | Stable self-hosted deployment name. | `.env.docker` → official backend `INSTANCE_NAME`; defaults to `tcger-production`. |
| `INSTANCE_SECRET` | 64-character hex root secret used to sign admin keys and sessions. | Required in `.env.docker` → official backend `INSTANCE_SECRET`; generate with `openssl rand -hex 32`. |
| `CONVEX_SELF_HOSTED_ADMIN_KEY` | CLI administrator credential printed by `generate_admin_key.sh`. | Added to `.env.docker` after first boot → `convex-deploy` only. |
| `CONVEX_BACKEND_TAG` | Official backend image tag. | `.env.docker`/Compose image selector; `latest` follows the official example, but an immutable qualified tag or digest is safer for upgrades. |
| `CONVEX_CLOUD_ORIGIN` | Browser-reachable Convex client/API origin for port 3210. | Official backend process env; defaults to the internal service URL. |
| `CONVEX_SITE_ORIGIN` | Browser-reachable HTTP Actions origin for port 3211. | Official backend process env; defaults to the internal service URL. |
| `CONVEX_SELF_HOSTED_URL` | CLI target for deployment operations. | Fixed to `http://convex-backend:3210` inside `convex-deploy`. |
| `BETTER_AUTH_SECRET` | Better Auth signing secret, at least 32 random characters. | `.env.docker` → Convex deployment env via `convex-deploy`. |
| `TCGER_BRIDGE_SECRET` | Shared Express-to-Convex bridge credential, at least 32 random characters. | `.env.docker` → Express process env and Convex deployment env via `convex-deploy`. |
| `SITE_URL` | Canonical public application origin used by Better Auth. | `.env.docker` → Convex deployment env via `convex-deploy`. |
| `BETTER_AUTH_URL` | Canonical public Better Auth endpoint (`SITE_URL/api/auth`); retained for auth integration compatibility. | `.env.docker` → Convex deployment env via `convex-deploy`. |
| `BETTER_AUTH_DISABLE_ORIGIN_CHECK` | Origin/CSRF bypass; must remain `false` in production. | `.env.docker` → Convex deployment env via `convex-deploy`. |
| `BETTER_AUTH_TRUSTED_ORIGINS` | Optional comma-separated additional trusted origins. | `.env.docker` → Convex deployment env via `convex-deploy`. |
| `BETTER_AUTH_USE_SECURE_COOKIES` | Optional explicit secure-cookie switch; normally inferred from HTTPS `SITE_URL`. | `.env.docker` → Convex deployment env via `convex-deploy`. |
| `NEXT_PUBLIC_CONVEX_URL` | Browser's Convex WebSocket/API origin. | Frontend runtime/build environment; use the externally routed 3210 origin. |
| `NEXT_PUBLIC_CONVEX_SITE_URL` | Browser-visible Convex HTTP Actions origin. | Frontend runtime environment; use the externally routed 3211 origin. |
| `CONVEX_HTTP_ORIGIN` | Express auth/HTTP bridge target. | Backend process env; defaults to internal `http://convex-backend:3211`. |
| `CONVEX_URL_INTERNAL` / `CONVEX_SITE_URL_INTERNAL` | Next.js server-side Convex and auth-proxy targets. | Frontend process env; default to internal ports 3210/3211. |

For legacy Prisma-backed production routes, also add `--profile legacy BACKEND_MODE=hybrid`.

### Back up and restore Convex

The `convex_data` volume is mounted at `/convex/data`. With the default SQLite configuration, the database is `/convex/data/db.sqlite3`; local files, modules, search indexes, exports, and snapshot imports are under `/convex/data/storage/`. Back up the complete volume, not only the SQLite file, and stop application writes first so the database and storage tree are consistent.

One filesystem-level backup sequence is:

```bash
compose="docker compose -f docker/docker-compose.prod.yml --env-file .env.docker"
$compose stop
container_id="$($compose ps -a -q convex-backend)"
volume_name="$(docker inspect --format '{{range .Mounts}}{{if eq .Destination "/convex/data"}}{{.Name}}{{end}}{{end}}' "$container_id")"
test -n "$volume_name"
mkdir -p backups
docker run --rm --mount "type=volume,src=$volume_name,dst=/source,readonly" \
  --mount "type=bind,src=$PWD/backups,dst=/backup" alpine:3.20 \
  tar -C /source -czf /backup/convex-data.tar.gz .
$compose start
```

To restore, first save the current volume separately, then stop the entire stack. Restore only a trusted archive and verify `volume_name` before the destructive clearing step:

```bash
compose="docker compose -f docker/docker-compose.prod.yml --env-file .env.docker"
$compose stop
container_id="$($compose ps -a -q convex-backend)"
volume_name="$(docker inspect --format '{{range .Mounts}}{{if eq .Destination "/convex/data"}}{{.Name}}{{end}}{{end}}' "$container_id")"
backup_file="$PWD/backups/convex-data.tar.gz"
test -n "$volume_name" && test -f "$backup_file"
docker run --rm --mount "type=volume,src=$volume_name,dst=/target" alpine:3.20 \
  sh -euc 'find /target -mindepth 1 -maxdepth 1 -exec rm -rf -- {} +'
docker run --rm --mount "type=volume,src=$volume_name,dst=/target" \
  --mount "type=bind,src=$PWD/backups,dst=/backup,readonly" alpine:3.20 \
  tar -C /target -xzf /backup/convex-data.tar.gz
$compose start
```

Keep `INSTANCE_NAME` and `INSTANCE_SECRET` with the backup. Changing the root secret invalidates existing admin keys and sessions. For version-to-version migration, also take a logical `npx convex export`, save `npx convex env list`, and use `npx convex import --replace-all` as described by Convex's upgrade guide.

## Notes
- Node modules live inside the container; each start runs `npm install` to sync dependencies.
- Development Convex state is persisted at `/app/convex-backend/.convex`; production self-hosted state uses the same named volume at the official image path `/convex/data`.
- In full Docker mode, access the frontend at `http://localhost:${APP_PORT:-3003}`. API requests are served at `http://localhost:${APP_PORT:-3003}/api`.
- In host frontend mode, the backend is exposed on `localhost:${BACKEND_PORT:-3004}`.
- Postgres is only started when the `legacy` profile is enabled. When active, the database is accessible on `localhost:5432` with credentials from `.env.docker`.

## Common Commands
- `npm run docker:down` — stop and remove containers.
- `npm run docker:down:volumes` — stop containers and delete volumes.
- `docker compose -f docker/docker-compose.yml --env-file .env.docker logs -f backend` — tail backend logs.
