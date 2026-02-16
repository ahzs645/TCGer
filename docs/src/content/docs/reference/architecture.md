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

## Frontend design

- Next.js App Router structure with dashboard, cards, setup flow, and collections sandbox.
- Shared UI components under `frontend/src/components`.
- API hooks and client helpers under `frontend/src/lib`.

## Optional cache workers

Cache services reduce calls to upstream APIs and improve local reliability:

- `services/scryfall-bulk` (Magic)
- `services/ygo-cache` (Yu-Gi-Oh!)
- `services/tcgdex-cache` (Pokemon)

`services/pokemon-cache` remains available but is deprecated.
