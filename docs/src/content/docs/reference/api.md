---
title: API Guide
description: OpenAPI and endpoint overview for TCGer.
---

TCGer exposes OpenAPI and Swagger UI directly from the backend.

## OpenAPI + Swagger

- OpenAPI source file in repo: `docs/openapi.yaml`
- Raw spec endpoint: `GET /openapi.yaml`
- Interactive docs endpoint: `GET /docs`

Common URLs:

- Backend direct: `http://localhost:3001/docs`
- Docker gateway: `http://localhost:3000/api/docs`

## Authorizing secured routes

1. Obtain a JWT via `POST /auth/login` (or `POST /auth/setup` on first run).
2. In Swagger UI, click **Authorize**.
3. Provide `Bearer <jwt-token>`.

## Key endpoints

- `GET /health`
- `POST /auth/signup`
- `POST /auth/login`
- `GET /auth/me`
- `POST /auth/logout`
- `GET /auth/setup-required`
- `POST /auth/setup`
- `GET /cards/search?query=...&tcg=...`
- `GET /cards/:tcg/:cardId`
- `GET /cards/:tcg/:cardId/prints`
- `GET /collections`
- `POST /collections`
- `PATCH /collections/:binderId`
- `DELETE /collections/:binderId`
- `POST /collections/:binderId/cards`
- `PATCH /collections/:binderId/cards/:collectionId`
- `DELETE /collections/:binderId/cards/:collectionId`
- `POST /collections/cards`
- `GET /collections/tags`
- `POST /collections/tags`
- `GET /wishlists`
- `POST /wishlists`
- `GET /wishlists/:wishlistId`
- `PATCH /wishlists/:wishlistId`
- `DELETE /wishlists/:wishlistId`
- `POST /wishlists/:wishlistId/cards`
- `DELETE /wishlists/:wishlistId/cards/:cardId`
- `GET /users/me`
- `PATCH /users/me`
- `POST /users/me/change-password`
- `GET /users/me/preferences`
- `PATCH /users/me/preferences`
- `GET /settings`
- `PATCH /settings`
