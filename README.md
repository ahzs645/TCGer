# TCGer (TCG Collection Manager)

TCGer is a multi-game trading card collection manager with a Node/Express API, a Next.js web client, SwiftUI and Android clients, and optional local cache services. Built-in adapters cover Pokémon, Magic: The Gathering, Yu-Gi-Oh!, Disney Lorcana, One Piece, and Dragon Ball Super; community game packages extend the catalogs. Some providers, including Dragon Ball search, require configured API credentials.

The public browser demo uses sample/browser-local data. iOS phone-only data stays on the device. Connected clients share account data only when they use the same authenticated server. See [supported modes and upgrades](docs/backend-modes.md) for the capability boundaries and [audit remediation](docs/audit-remediation-2026-10-31.md) for implementation and verification evidence.

## Highlights
- Unified card search through game adapters and installed community packages.
- Better Auth sessions backed by Convex, including a first-run admin promotion flow.
- Binders and per-copy inventory tracking (condition, language, notes, price, acquisition price, serial number, tags).
- Card prints lookup for Magic and Pokemon (Pokemon returns functional print group metadata).
- User preferences for enabled games and display options (card numbers, pricing).
- Web dashboard, card explorer, and collection sandbox UI.
- Optional local caches for Scryfall, YGO, and TCGdex to reduce external API calls.
- Installable offline card catalogs for the PWA and the iOS local mode - full per-game search and set browsing without a server (see `docs/offline-catalogs.md`).

## Repo layout
- `backend/` - Express + Prisma API service.
- `frontend/` - Next.js 16.4 web app (app router).
- `services/` - Optional cache services (scryfall-bulk, ygo-cache, tcgdex-cache, pokemon-cache).
- `docker/` - Compose files, nginx gateway, cache backup scripts.
- `mobile-apps/` - iOS SwiftUI and Android Jetpack Compose clients.
- `docs/` - Starlight documentation site source + OpenAPI spec.

## Adding games

Start with the [future-game authoring guide](docs/src/content/docs/adding-games/index.md). The documentation site's **Adding Games** section has separate pages for catalogs, search and collections, decks, printings and finishes, legality, symbols, pricing, packs, scanning, sealed-product limits, and publishing. The [Star Garden example](docs/scanner-system/examples/star-garden/README.md) supplies a complete v2 package.

Run `npm --prefix docs run dev` to browse the linked guides locally. Specialized Pokédex collection views remain deferred.

## Quick start (recommended: frontend on host, services in Docker)
```bash
git clone --recurse-submodules https://github.com/ahzs645/TCGer.git
cd TCGer
npm install --global npm@11.19.0
npm ci
cp .env.docker.example .env.docker
cp frontend/.env.local.example frontend/.env.local
# Set different random BETTER_AUTH_SECRET and TCGER_BRIDGE_SECRET values (32+ characters).
npm run docker:dev
```

In a second terminal:

```bash
npm run dev:frontend
```

Open the app at `http://localhost:3003`.

This starts:
- the frontend locally with normal Next.js hot reload
- the Dockerized backend on `http://localhost:3004`
- Convex for account data, authentication, and atomic inventory operations

Postgres is needed only for the explicit legacy hybrid mode. Optional bulk cache
workers require the `bulk` profile and matching provider URLs; the example file
uses public provider APIs so the default stack works without those workers.

If the default ports are already in use on your machine, change `APP_PORT`, `BACKEND_PORT`, `CONVEX_PORT`, or `CONVEX_SITE_PORT` in `.env.docker`.

## Full Docker stack
```bash
cp .env.docker.example .env.docker
docker compose -f docker/docker-compose.yml --env-file .env.docker --profile frontend up --build
```

Open the app at `http://localhost:3003` (or `APP_PORT`). The API is exposed at `http://localhost:3003/api`.

Optional cache services:
```bash
npm run docker:dev:full:bulk
```

Notes:
- `pokemon-cache` is deprecated in favor of `tcgdex-cache` due to upstream instability.
- The first run should go to `/setup` to create the initial admin account.

## Local development (without Docker)
Prereqs: Node 24 LTS recommended (Node 22.12 or newer supported), and npm 11.19.0 or newer. The default Convex development path does not require Postgres. npm 11.19.0 is the verified installer; older npm versions can ignore workspace overrides and reject the patched lockfile.

```bash
npm install --global npm@11.19.0
npm ci
```

See the [dependency security review](docs/dependency-security-review-2026-10-08.md)
for the override rationale, verification and remaining upstream advisories.

In `convex-backend/.env.local`, add the following settings. Generate two different
secrets with `openssl rand -hex 32` and replace the placeholders. Preserve any
existing `CONVEX_DEPLOYMENT`, `CONVEX_URL`, and `CONVEX_SITE_URL` lines.

```dotenv
TCGER_CONVEX_DEV_TARGET=anonymous
BETTER_AUTH_SECRET=<your-first-random-secret>
TCGER_BRIDGE_SECRET=<your-second-random-secret>
SITE_URL=http://localhost:3003
BETTER_AUTH_URL=http://localhost:3003/api/auth
BETTER_AUTH_TRUSTED_ORIGINS=http://localhost:3003,http://localhost:3004
BETTER_AUTH_DISABLE_ORIGIN_CHECK=false
BETTER_AUTH_USE_SECURE_COOKIES=false
```

Start the local Convex backend first and leave it running:
```bash
cd convex-backend
npm run dev:local
```

The bootstrap writes these settings into the selected local deployment, starts
the watcher, and checks the authenticated bridge before reporting readiness.
Passing secrets only to a plain `convex dev` process does not configure the
function environment. Anonymous mode creates or reuses an anonymous local
deployment. To reuse an already linked local deployment, set
`TCGER_CONVEX_DEV_TARGET=local`. Cloud, production, self-hosted, and conflicting
selections are rejected without changing them; use a separate checkout when
developing against a different deployment.

In a second terminal, start Express in Convex mode. Use the same bridge secret
you put in `convex-backend/.env.local`. `CONVEX_HTTP_ORIGIN` is the local
`CONVEX_SITE_URL` written there by the CLI (normally port `3211`):
```bash
cd backend
BACKEND_MODE=convex \
CONVEX_HTTP_ORIGIN=http://127.0.0.1:3211 \
TCGER_BRIDGE_SECRET='<your-second-random-secret>' \
APP_ORIGIN=http://localhost:3003 \
PORT=3004 npm run dev
```

In a third terminal, point the Next.js frontend at Express:
```bash
cd frontend
NEXT_PUBLIC_SITE_URL=http://localhost:3003 \
NEXT_PUBLIC_API_BASE_URL=http://localhost:3004 \
BACKEND_API_ORIGIN=http://localhost:3004 \
CONVEX_URL_INTERNAL=http://127.0.0.1:3210 \
CONVEX_SITE_URL_INTERNAL=http://127.0.0.1:3211 \
npm run dev -- --port 3003
```

Open `http://localhost:3003`. Browser-facing REST requests must go through Express; do not call Convex HTTP routes directly or send `X-TCGER-*` bridge headers from browser code.

Native authentication sends the origin of the configured API URL. When the API
and website use different hosts or ports, include both client-facing origins in
`BETTER_AUTH_TRUSTED_ORIGINS`. For a phone on your network, use the reachable
hostname/IP in that list and in the app configuration. Keep origin checks enabled.

Docker-backed local development shortcuts from the repo root:
- `npm run docker:dev:legacy` - backend stack + Postgres for hybrid/legacy routes.
- `npm run docker:dev:legacy:bulk` - backend stack + Postgres + cache services.
- `npm run docker:dev:full` - full Docker stack including the frontend and nginx gateway.
- `npm run docker:hash:pokemon` - one-shot Pokemon card hash-map build into `tcger_card_scan_data`.
- `npm run docker:down` - stop the Docker development stack.

## Environment variables
Express backend (see `backend/src/config/env.ts`):
- `BACKEND_MODE` selects `convex` or `hybrid`. Docker Compose defaults to `convex`; a directly launched backend currently defaults to `hybrid`, so set it explicitly for Convex-only local development. `DATABASE_URL` is required outside test only in `hybrid` mode.
- `CONVEX_HTTP_ORIGIN` is required outside test and points Express at the Convex HTTP/site origin (`http://convex-backend:3211` in Compose, normally `http://127.0.0.1:3211` locally).
- `TCGER_BRIDGE_SECRET` authenticates internal Express-to-Convex bridge traffic. It must be at least 32 characters when set and is required in production.
- `SCRYFALL_API_BASE_URL` (default `https://api.scryfall.com`).
- `YGO_API_BASE_URL` (default `https://db.ygoprodeck.com/api/v7`).
- `POKEMON_API_BASE_URL` (default `https://api.scrydex.com`).
- `TCGDEX_API_BASE_URL` (default `https://api.tcgdex.net/v2/en`).
- `JUSTTCG_API_BASE_URL` (default `https://api.justtcg.com/v1`) and
  `JUSTTCG_API_KEY` (paid commercial pricing; server-side only).
- `POKEWALLET_API_BASE_URL` plus either `POKEWALLET_API_KEY` or
  `POKEWALLET_PROXY_SECRET` enables server-only Pokémon Cardmarket and TCGPlayer
  references. Blending is enabled only when `PRICE_USD_TO_EUR`, `PRICE_FX_SOURCE`,
  and the ISO timestamp `PRICE_FX_AS_OF` are all configured; native quotes and the
  dated conversion provenance are retained.
- `TCGCSV_API_BASE_URL` enables the no-key Pokémon singles fallback. Matching is
  language-scoped and refuses ambiguous set or collector-number results.
- `PSA_API_TOKEN` enables certification-number intake through PSA's public API.
  Only normalized certificate fields and a response hash are cached.
- `POKEMON_PRICE_TRACKER_API_KEY` remains disabled until
  `POKEMON_PRICE_TRACKER_LICENSE_ACK=true` explicitly records that the deployment's
  commercial-use and redistribution obligations have been reviewed.
- `EBAY_CLIENT_ID` and `EBAY_CLIENT_SECRET` enable the server-only eBay Browse
  active-listing median; `EBAY_MARKETPLACE_ID` selects its marketplace.
- `PRICE_REFRESH_INTERVAL_MS` controls the tracked-card quote cache and client refresh guidance (default 12 hours).
- `PRICE_FORCE_REFRESH_COOLDOWN_MS` limits repeated manual refreshes (default 5 minutes).

Convex backend:
- `BETTER_AUTH_SECRET` signs Better Auth sessions. Non-local Convex deployments require it; use a random value of at least 32 characters.
- `TCGER_BRIDGE_SECRET` must exactly match the Express value.

Development fallbacks are defined in `backend/src/config/env.ts` and `convex-backend/convex/betterAuth/auth.ts`. The development Compose defaults are in `docker/docker-compose.yml`; production Compose requires both secrets and supplies its Convex origin in `docker/docker-compose.prod.yml`. Replace development defaults for any shared or deployed environment.

Frontend:
- `NEXT_PUBLIC_API_BASE_URL` (public API base; typically `http://localhost:3003/api` with nginx).
- `BACKEND_API_ORIGIN` (internal API origin for server-side Next.js fetches).
- `NEXT_PUBLIC_CATALOG_BASE_URL` (production R2 catalog root; local development defaults to `/catalog`).
- `NEXT_PUBLIC_PACK_ASSET_BASE_URL` (production R2 origin for projected pack-opening wrappers; local development uses bundled assets).
- Collection requests use the authenticated Express API exclusively. Do not configure browser-to-Convex collection HTTP calls or send `X-TCGER-*` identity headers from browser code.

Convex bridge:
- `TCGER_BRIDGE_SECRET` is shared only by Express and Convex and must be a distinct random value of at least 32 characters in production.
- Docker persists local Convex users, collections, and file storage in the `convex_data` named volume. Production does not publish the Convex backend or site ports to the host.

In `convex` mode, collections, wishlists, decks, finance, sealed inventory, analytics, trades, and public routes use Convex-native implementations. Notifications, alerts, and automations also have Convex-native routes; prices use the pricing gateway. Shops and shipments return `501 Not Implemented`. In `hybrid` mode the legacy routers remain available, and collections/wishlists can be selected independently with `COLLECTIONS_BACKEND` and `WISHLISTS_BACKEND`. Hybrid is a compatibility path: atomic sales, atomic intake, linked acquisitions and trade settlement are disabled because they cannot commit across the separate stores. Read `GET /health` and its operation-specific flags instead of inferring settlement support from `trades: true`. Email delivery is not configured in either path and is explicitly unavailable.

## API overview
OpenAPI + Swagger:
- OpenAPI source: `docs/openapi.yaml`
- Raw spec endpoint: `GET /openapi.yaml` (gateway: `GET /api/openapi.yaml`)
- Swagger UI: `GET /docs` (gateway: `GET /api/docs`)

Key routes (see `backend/src/api/routes`):
- `GET /health` - Liveness and readiness probes.
- `/auth/*` proxies Better Auth; common entry points are `POST /auth/sign-up/email` and `POST /auth/sign-in/username`.
- `GET /setup/setup-required`, `POST /setup/setup`
- `GET /cards/search?query=...&tcg=...`
- `GET /cards/:tcg/:cardId`
- `GET /cards/:tcg/:cardId/prints`
- `GET /collections` (binders + unsorted), `POST /collections`, `PATCH /collections/:binderId`, `DELETE /collections/:binderId`
- `POST /collections/:binderId/cards`, `PATCH /collections/:binderId/cards/:collectionId`, `DELETE /collections/:binderId/cards/:collectionId`
- `DELETE /collections/:binderId/copies/:copyId` removes one physical copy; the existing card DELETE removes the printing group.
- `POST /collections/:binderId/intake` and `POST /finance/sales` commit replayable inventory operations in full Convex mode.
- `POST /collections/normalize-copies` previews or commits bounded legacy quantity normalization for the current account.
- `POST /collections/cards` (add to library)
- `GET /collections/tags`, `POST /collections/tags`
- `GET /users/me`, `PATCH /users/me`, `POST /users/me/change-password`
- `GET /users/me/preferences`, `PATCH /users/me/preferences`
- `GET /settings` (public app config), `PATCH /settings` (admin only)

## Cache services (optional)
- `services/scryfall-bulk` (port 4010): local Scryfall bulk mirror for Magic.
- `services/ygo-cache` (port 4020): cached YGOPRODeck cardinfo mirror.
- `services/tcgdex-cache` (port 4040): cached TCGdex data for Pokemon (default).
- `services/pokemon-cache` (port 4030): cached official Pokemon TCG API (deprecated).

## Hash map builds

Use the dedicated card-scan stack when you want to build a large standalone Pokemon artifact set without starting the full app:

```bash
cp .env.docker.example .env.docker
CARD_HASH_BUILD_FORCE=true npm run docker:hash:pokemon
```

This produces:
- `/data/card-scan/hashes.json` in the `tcger_card_scan_data` volume for scan matching.
- `/data/card-library/pokemon/index.json` for standalone metadata + hash records.
- `/data/card-library/pokemon/images/...` for a local Pokemon image library.

Useful overrides:
- `CARD_HASH_BUILD_LIMIT=500` to test on a subset first.
- `CARD_HASH_BUILD_CONCURRENCY=8` to push harder on local CPU/network.
- `CARD_HASH_BUILD_SET_CODE=sv7` to build a single Pokemon set.

The generated artifacts are written to the named Docker volume `tcger_card_scan_data`.

## Mobile apps
- iOS SwiftUI client with dashboard, collections, scanner, and API service layers lives in `mobile-apps/ios/TCGer` (in progress).
- Android client is in `mobile-apps/android`, with local Room storage and server-backed collections, scanner, account, and backup workflows.

## Cross-platform feature tracking

Feature support is declared beside each web, Swift, and Kotlin implementation.
The product registry in `mobile-parity/features.definitions.json` binds those
source declarations to feature policies and tests. Generate the joined matrix
and typed app metadata with `npm run parity:generate`; check them with
`npm run parity:check`. Use `npm run parity:impact -- --base origin/main` to
review affected features and application paths without direct coverage.
See [the parity workflow](mobile-parity/README.md) for limitations, supported
modes, source registration syntax, and execution evidence.

Shared [API contracts](mobile-parity/api-contracts/README.md) exercise the real
web, iOS, and Android clients against reviewed REST interactions, with matching
Express/Convex provider checks. Run `npm run api-contracts:test` for web/provider
coverage, the native API commands for client coverage, and
`npm run api-contracts:report -- --require-pass` for the separate API matrix.

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
