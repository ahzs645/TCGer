# API Documentation

TCGer API docs are now exposed directly by the backend service using OpenAPI + Swagger UI.

## OpenAPI source

- Spec file: `docs/openapi.yaml`
- Raw spec endpoint: `GET /openapi.yaml`
- Interactive Swagger UI: `GET /docs`

## Where to open Swagger UI

- Local backend (direct): `http://localhost:3001/docs` (or your backend port)
- Docker gateway path: `http://localhost:3000/api/docs`

## Authorizing secured endpoints

1. Login via `POST /auth/login` (or create admin via `POST /auth/setup` on first run).
2. Copy the `token` from the response.
3. In Swagger UI, click **Authorize** and enter:
   `Bearer <your-jwt-token>`

## Server selection in Swagger

The spec includes multiple server options:

- `/api` for nginx/gateway path routing.
- `/` for direct backend routing.
- `http://localhost:3001` as a local example.

If requests fail due to path prefix, switch the selected server in Swagger UI.
