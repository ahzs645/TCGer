# API Documentation

TCGer API docs are now exposed directly by the backend service using OpenAPI + Swagger UI.

## OpenAPI source

- Spec file: `docs/openapi.yaml`
- Raw spec endpoint: `GET /openapi.yaml`
- Interactive Swagger UI: `GET /docs`

## Where to open Swagger UI

- Local backend (direct): `http://localhost:3004/docs` (or your backend port)
- Docker gateway path: `http://localhost:3003/api/docs`

## Authorizing secured endpoints

TCGer uses Better Auth sessions. The legacy token-secret flow is no longer part of authentication.

1. Sign in with `POST /auth/sign-in/username`. On first run, create an account with `POST /auth/sign-up/email`, then call authenticated `POST /setup/setup` to promote that account to admin.
2. If Swagger UI is served from the same backend/gateway origin, the Better Auth session cookie is sent automatically after sign-in.
3. Alternatively, copy the opaque `token` returned by Better Auth, click **Authorize**, and enter the token value. Swagger UI adds the `Bearer` scheme, so do not prefix the value with `Bearer`.

The backend forwards either the session cookie or `Authorization: Bearer <opaque-session-token>` to Better Auth's `get-session` endpoint in Convex.

## Server selection in Swagger

The spec includes multiple server options:

- `/api` for nginx/gateway path routing.
- `/` for direct backend routing.
- `http://localhost:3004` as a local example.

If requests fail due to path prefix, switch the selected server in Swagger UI.
