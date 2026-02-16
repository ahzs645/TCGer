---
title: Local Development
description: Run backend and frontend locally without Docker.
---

## Prerequisites

- Node.js 18+
- npm 9+
- PostgreSQL
- `DATABASE_URL` for backend Prisma

Install dependencies from repo root:

```bash
npm install
```

## Backend

```bash
cd backend
npx prisma migrate dev
PORT=3001 JWT_SECRET=changeme-super-secret npm run dev
```

## Frontend

In a second terminal:

```bash
cd frontend
NEXT_PUBLIC_API_BASE_URL=http://localhost:3001 npm run dev
```

## Environment variables

### Backend

- `DATABASE_URL` (required)
- `JWT_SECRET` (minimum 16 characters)
- `SCRYFALL_API_BASE_URL` (default `https://api.scryfall.com`)
- `YGO_API_BASE_URL` (default `https://db.ygoprodeck.com/api/v7`)
- `POKEMON_API_BASE_URL` (default `https://api.pokemontcg.io/v2`)
- `TCGDEX_API_BASE_URL` (default `https://api.tcgdex.net/v2/en`)
- `POKEMON_TCG_API_KEY` (optional)

### Frontend

- `NEXT_PUBLIC_API_BASE_URL` (for browser requests)
- `BACKEND_API_ORIGIN` (for server-side Next.js requests)
