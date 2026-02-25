---
title: Architecture
description: High-level structure of TCGer services and applications.
---

## Repository layout

- `backend/`: Express + Prisma API service
- `frontend/`: Next.js 14 web app
- `services/`: optional cache services (`scryfall-bulk`, `ygo-cache`, `tcgdex-cache`, `pokemon-cache`)
- `docker/`: compose files, nginx gateway, backup/restore scripts
- `mobile-apps/`: iOS app (in progress) and Android placeholder
- `docs/`: OpenAPI source and Starlight docs site

## Backend design

- Adapter layer for cross-game card search and card details.
- Auth includes first-run setup, login/signup, and JWT session handling.
- Prisma-backed data model for binders and copy-level inventory.
- Wishlist system with per-user wishlists and collection-vs-wishlist ownership comparison.

### Expansion symbols

Each TCG adapter populates set symbol and logo URLs where available:

- **Pokemon**: `setSymbolUrl` (expansion icon from pokemontcg.io / TCGdex) and `setLogoUrl` (set branding logo).
- **MTG**: Scryfall SVG symbols (`https://svgs.scryfall.io/sets/{code}.svg`) used for both symbol and logo.
- **Yu-Gi-Oh**: No standard set symbol images exist; the frontend displays a styled letter label derived from the TCG set prefix (e.g., `LOB`, `MRD`).

The frontend `SetSymbol` component renders the image when available and falls back to a TCG-colored letter label when the image is missing or fails to load.

## Frontend design

- Next.js App Router structure with dashboard, cards, setup flow, collections sandbox, and wishlists.
- Shared UI components under `frontend/src/components`.
- API hooks and client helpers under `frontend/src/lib`.
- Zustand stores for collections, wishlists, auth, and preferences.

## Optional cache workers

Cache services reduce calls to upstream APIs and improve local reliability:

- `services/scryfall-bulk` (Magic)
- `services/ygo-cache` (Yu-Gi-Oh!)
- `services/tcgdex-cache` (Pokemon)

`services/pokemon-cache` remains available but is deprecated.
