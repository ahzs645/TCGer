---
title: Getting Started
description: Run TCGer quickly with Docker Compose.
---

## Prerequisites

- Docker Desktop (or Docker Engine + Compose plugin)

## Start the stack

From the repository root:

```bash
cp .env.docker.example .env.docker
cp frontend/.env.local.example frontend/.env.local
npm run docker:dev:legacy:bulk
```

In a second terminal:

```bash
npm run dev:frontend
```

Open:

- App: `http://localhost:3003`
- API base: `http://localhost:3004`

## First-run setup

On a fresh database, open `http://localhost:3003/setup` and create the initial admin account.

## Optional cache services

To start optional bulk/cache services:

```bash
npm run docker:dev:legacy:bulk
```

Notes:

- `pokemon-cache` is deprecated in favor of `tcgdex-cache`.
