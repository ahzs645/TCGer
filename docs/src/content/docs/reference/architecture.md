---
title: Architecture
description: High-level structure of TCGer services and applications.
---

## Repository layout

- `backend/`: Express API gateway and compatibility service
- `convex-backend/`: Convex data, Better Auth, and native feature implementation
- `frontend/`: Next.js 15 web app
- `services/`: optional cache services (`scryfall-bulk`, `ygo-cache`, `tcgdex-cache`, `pokemon-cache`)
- `docker/`: compose files, nginx gateway, backup/restore scripts
- `mobile-apps/`: iOS app (in progress) and Android placeholder
- `docs/`: OpenAPI source and Starlight docs site

## Backend design

- Adapter layer for cross-game card search and card details.
- Better Auth runs in Convex. Express proxies `/auth/*`, validates Better Auth session cookies or opaque bearer session tokens through Convex, and exposes `GET /setup/setup-required` plus authenticated `POST /setup/setup` for first-run admin promotion.
- `TCGER_BRIDGE_SECRET` authenticates internal Express-to-Convex HTTP traffic. Express derives bridge identity from the validated session; browsers must never send bridge headers or call Convex HTTP routes directly.
- Convex-native and Prisma-backed data paths coexist during migration.
- Wishlist system with per-user wishlists and collection-vs-wishlist ownership comparison.

### Backend modes

The recommended Docker stack defaults `BACKEND_MODE` to `convex`. A directly started Express process currently defaults to `hybrid` in `backend/src/config/env.ts`, so local commands should set the mode explicitly.

- `convex`: collections, wishlists, decks, finance, sealed inventory, analytics, trades, and public routes use Convex-native handlers. Prices, notifications, alerts, shops, automations, and shipments are explicit `501 Not Implemented` groups.
- `hybrid`: legacy routers remain active. Collections and wishlists can independently use Prisma or Convex through `COLLECTIONS_BACKEND` and `WISHLISTS_BACKEND`.
- Express remains the browser-facing API in either mode. It also owns provider-backed card search/details, scanning, news, API documentation, and capability reporting.

`GET /health` returns `{ status, env, mode, features }`. Clients should gate feature UI from this response because route availability changes by mode.

### Expansion symbols

Each TCG adapter populates set symbol and logo URLs where available:

- **Pokemon**: `setSymbolUrl` (expansion icon from pokemontcg.io / TCGdex) and `setLogoUrl` (set branding logo).
- **MTG**: Scryfall SVG symbols (`https://svgs.scryfall.io/sets/{code}.svg`) used for both symbol and logo.
- **Dragon Ball Fusion World**: provider set logos when API TCG supplies them.
- **Yu-Gi-Oh!, One Piece, and Lorcana**: a TCG-colored set-code badge because
  the configured providers do not expose canonical expansion artwork.

The frontend `SetSymbol` component renders the image when available and falls back to a TCG-colored letter label when the image is missing or fails to load.

## Frontend design

- Next.js App Router structure with dashboard, cards, setup flow, collections sandbox, and wishlists.
- Shared UI components under `frontend/src/components`.
- API hooks and client helpers under `frontend/src/lib`.
- Zustand stores for collections, wishlists, auth, and preferences.
- Browser data access targets Express (directly in local development or through the `/api` gateway path); Convex and its bridge credentials remain server-side.

## Optional cache workers

Cache services reduce calls to upstream APIs and improve local reliability:

- `services/scryfall-bulk` (Magic)
- `services/ygo-cache` (Yu-Gi-Oh!)
- `services/tcgdex-cache` (Pokemon)

`services/pokemon-cache` remains available but is deprecated.
