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
docker compose -f docker/docker-compose.yml --env-file .env.docker up --build
```

Open:

- App: `http://localhost:3000`
- API base: `http://localhost:3000/api`

## First-run setup

On a fresh database, open `http://localhost:3000/setup` and create the initial admin account.

## Optional cache services

To start optional bulk/cache services:

```bash
docker compose -f docker/docker-compose.yml --env-file .env.docker --profile bulk up --build
```

Notes:

- `pokemon-cache` is deprecated in favor of `tcgdex-cache`.
- You can run without cache services if you want a simpler setup first.
