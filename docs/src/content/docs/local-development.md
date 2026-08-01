---
title: Local Development
description: Run the Convex backend, Express API, and frontend locally without Docker.
---

## Prerequisites

- Node.js 18+
- npm 9+

Install dependencies from repo root:

```bash
npm install
```

## 1. Convex backend

```bash
cd convex-backend
BETTER_AUTH_SECRET=tcger-local-convex-auth-secret-2026 \
TCGER_BRIDGE_SECRET=tcger-local-convex-bridge-secret-2026 \
npx convex dev
```

Leave the process running. Its local HTTP/site origin is normally `http://127.0.0.1:3211`.

## 2. Express backend

In a second terminal:

```bash
cd backend
BACKEND_MODE=convex \
CONVEX_HTTP_ORIGIN=http://127.0.0.1:3211 \
TCGER_BRIDGE_SECRET=tcger-local-convex-bridge-secret-2026 \
APP_ORIGIN=http://localhost:3003 \
PORT=3004 npm run dev
```

## 3. Frontend

In a third terminal:

```bash
cd frontend
NEXT_PUBLIC_SITE_URL=http://localhost:3003 \
NEXT_PUBLIC_API_BASE_URL=http://localhost:3004 \
BACKEND_API_ORIGIN=http://localhost:3004 \
CONVEX_URL_INTERNAL=http://127.0.0.1:3210 \
CONVEX_SITE_URL_INTERNAL=http://127.0.0.1:3211 \
npm run dev -- --port 3003
```

Open `http://localhost:3003`. Browser-facing REST requests use Express. Never call Convex HTTP routes from browser code or expose `X-TCGER-*` bridge identity headers.

## Environment variables

### Backend

- `BACKEND_MODE`: `convex` or `hybrid`. Compose defaults to `convex`; `backend/src/config/env.ts` currently defaults a direct process to `hybrid`, so set this explicitly. `DATABASE_URL` is required only outside test when the mode is not `convex`.
- `CONVEX_HTTP_ORIGIN`: required outside test; points Express to the Convex HTTP/site origin.
- `TCGER_BRIDGE_SECRET`: shared only between Express and Convex; required in production and at least 32 characters when set.
- `SCRYFALL_API_BASE_URL` (default `https://api.scryfall.com`)
- `YGO_API_BASE_URL` (default `https://db.ygoprodeck.com/api/v7`)
- `POKEMON_API_BASE_URL` (default `https://api.scrydex.com`)
- `TCGDEX_API_BASE_URL` (default `https://api.tcgdex.net/v2/en`)

### Convex

- `BETTER_AUTH_SECRET`: signs Better Auth sessions and is required for non-local Convex deployments.
- `TCGER_BRIDGE_SECRET`: must match the Express value.

Local fallback values live in `backend/src/config/env.ts` and `convex-backend/convex/betterAuth/auth.ts`. Compose supplies development defaults in `docker/docker-compose.yml`; `docker/docker-compose.prod.yml` requires both secrets.

### Frontend

- `NEXT_PUBLIC_API_BASE_URL` (for browser requests)
- `BACKEND_API_ORIGIN` (for server-side Next.js requests)

## Backend modes and capabilities

`convex` mode uses Convex-native collections, wishlists, decks, finance, sealed inventory, analytics, trades, and public routes. Prices, notifications, alerts, shops, automations, and shipments return `501 Not Implemented` in that mode. `hybrid` mode loads the legacy feature routers; collections and wishlists can separately select Prisma or Convex.

`GET /health` returns `{ status, env, mode, features }`. Use `features` to hide or disable unsupported client functionality.
