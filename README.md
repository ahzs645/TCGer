# TCGer (TCG Collection Manager)

TCGer is a multi-game trading card collection manager with a Node/Express API, a Next.js web client, and optional local cache services for card data. It supports Yu-Gi-Oh!, Magic: The Gathering, and Pokemon.

## Highlights
- Unified card search across Yu-Gi-Oh!, Magic, and Pokemon via an adapter layer.
- Auth flow with initial admin setup and JWT sessions.
- Binders and per-copy inventory tracking (condition, language, notes, price, acquisition price, serial number, tags).
- Card prints lookup for Magic and Pokemon (Pokemon returns functional print group metadata).
- User preferences for enabled games and display options (card numbers, pricing).
- Web dashboard, card explorer, and collection sandbox UI.
- Optional local caches for Scryfall, YGO, and TCGdex to reduce external API calls.

## Repo layout
- `backend/` - Express + Prisma API service.
- `frontend/` - Next.js 14 web app (app router).
- `services/` - Optional cache services (scryfall-bulk, ygo-cache, tcgdex-cache, pokemon-cache).
- `docker/` - Compose files, nginx gateway, cache backup scripts.
- `mobile-apps/` - iOS SwiftUI client (in progress) and Android placeholder.
- `docs/` - Starlight documentation site source + OpenAPI spec.

## Quick start (Docker)
```bash
cp .env.docker.example .env.docker
docker compose -f docker/docker-compose.yml --env-file .env.docker up --build
```

Open the app at `http://localhost:3000` (or `APP_PORT`). The API is exposed at `http://localhost:3000/api`.

Optional cache services:
```bash
docker compose -f docker/docker-compose.yml --env-file .env.docker --profile bulk up --build
```

Notes:
- `pokemon-cache` is deprecated in favor of `tcgdex-cache` due to upstream instability.
- The first run should go to `/setup` to create the initial admin account.

## Local development (without Docker)
Prereqs: Node 18+, Postgres, and a `DATABASE_URL`.

```bash
npm install
```

Backend:
```bash
cd backend
npx prisma migrate dev
PORT=3001 JWT_SECRET=changeme-super-secret npm run dev
```

Frontend (point to the backend port):
```bash
cd frontend
NEXT_PUBLIC_API_BASE_URL=http://localhost:3001 npm run dev
```

## Environment variables
Backend (see `backend/src/config/env.ts`):
- `DATABASE_URL` (required for Prisma).
- `JWT_SECRET` (min 16 chars).
- `SCRYFALL_API_BASE_URL` (default `https://api.scryfall.com`).
- `YGO_API_BASE_URL` (default `https://db.ygoprodeck.com/api/v7`).
- `POKEMON_API_BASE_URL` (default `https://api.pokemontcg.io/v2` or point to `tcgdex-cache`).
- `TCGDEX_API_BASE_URL` (default `https://api.tcgdex.net/v2/en`).
- `POKEMON_TCG_API_KEY` (optional for official Pokemon API).

Frontend:
- `NEXT_PUBLIC_API_BASE_URL` (public API base; typically `http://localhost:3000/api` with nginx).
- `BACKEND_API_ORIGIN` (internal API origin for server-side Next.js fetches).

## API overview
OpenAPI + Swagger:
- OpenAPI source: `docs/openapi.yaml`
- Raw spec endpoint: `GET /openapi.yaml` (gateway: `GET /api/openapi.yaml`)
- Swagger UI: `GET /docs` (gateway: `GET /api/docs`)

Key routes (see `backend/src/api/routes`):
- `GET /health` - Liveness and readiness probes.
- `POST /auth/signup`, `POST /auth/login`, `GET /auth/me`, `POST /auth/logout`
- `GET /auth/setup-required`, `POST /auth/setup`
- `GET /cards/search?query=...&tcg=...`
- `GET /cards/:tcg/:cardId`
- `GET /cards/:tcg/:cardId/prints`
- `GET /collections` (binders + unsorted), `POST /collections`, `PATCH /collections/:binderId`, `DELETE /collections/:binderId`
- `POST /collections/:binderId/cards`, `PATCH /collections/:binderId/cards/:collectionId`, `DELETE /collections/:binderId/cards/:collectionId`
- `POST /collections/cards` (add to library)
- `GET /collections/tags`, `POST /collections/tags`
- `GET /users/me`, `PATCH /users/me`, `POST /users/me/change-password`
- `GET /users/me/preferences`, `PATCH /users/me/preferences`
- `GET /settings`, `PATCH /settings` (admin hook; auth check TODO)

## Cache services (optional)
- `services/scryfall-bulk` (port 4010): local Scryfall bulk mirror for Magic.
- `services/ygo-cache` (port 4020): cached YGOPRODeck cardinfo mirror.
- `services/tcgdex-cache` (port 4040): cached TCGdex data for Pokemon (default).
- `services/pokemon-cache` (port 4030): cached official Pokemon TCG API (deprecated).

## Mobile apps
- iOS SwiftUI client with dashboard, collections, scanner, and API service layers lives in `mobile-apps/ios/TCGer` (in progress).
- Android scaffold is in `mobile-apps/android`.

## Docs and scripts
- Starlight docs source: `docs/src/content/docs/`
- OpenAPI spec: `docs/openapi.yaml`
- Run docs locally:
  - `npm --prefix docs install`
  - `npm run docs:dev`
- Build docs:
  - `npm run docs:build`
- Marketing site source (React + Vite): `marketing-site/`
- Docker setup: `docker/README.md`
- Cache backup/restore: `docker/CACHE_BACKUP_GUIDE.md`, `docker/backup-caches.sh`, `docker/restore-caches.sh`
- Roadmap: `plan.md`

## GitHub Pages (product page)
The product page source lives in `marketing-site/` and is deployed by GitHub Actions.

Local development:

```bash
npm --prefix marketing-site install
npm --prefix marketing-site run dev
```

Build locally:

```bash
npm run build:marketing
```

Automated deployment workflow:

- Workflow file: `.github/workflows/pages.yml`
- Trigger: push to `main` (or manual `workflow_dispatch`)
- Build output uploaded to Pages: `marketing-site/dist`
- Starlight docs are published under `/docs` (for example `https://<your-domain>/docs/`)

Setup steps:

1. Go to repository **Settings -> Pages**.
2. Under **Build and deployment**, set **Source** to **GitHub Actions**.
3. Add custom domain: `tcger.ahmadjalil.com` and save.
4. In DNS, create `CNAME` record: `tcger` -> `ahzs645.github.io`.
5. After first successful deploy, enable **Enforce HTTPS** in Pages settings.
