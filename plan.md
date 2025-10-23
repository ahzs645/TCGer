# General TCG Card Collection Manager — Backend & Web Frontend Plan

## Vision
- Unified platform that ingests, normalizes, and serves trading card data for Yu-Gi-Oh!, Magic: The Gathering, and Pokémon.
- First-class REST API powering a responsive web client; future mobile apps can reuse the same surface.
- Modular foundation so additional TCGs plug in without touching core business logic.

## Phase 1 Scope
- Ship a containerized stack with PostgreSQL, Redis (for caching/session), backend (Node + TypeScript), and web frontend (Next.js + TypeScript).
- Implement authentication, card search/browse, user collections, and baseline price tracking.
- Provide adapter implementations for Yu-Gi-Oh!, Magic, and Pokémon using their public APIs and normalize data into shared schemas.
- Deliver developer tooling (tests, linting, migrations) and CI-ready Docker workflows.

## Guiding Principles
- Schema-first: relational structure for shared data, JSONB for game-specific attributes.
- Adapter-driven: every TCG implements the same interface; add-ons require configuration only.
- API-first: backend exposes comprehensive REST endpoints and typed SDK for clients.
- Infrastructure-as-code: Docker Compose defines local/dev environments; easy path to ECS/Kubernetes later.
- Secure-by-default: secrets handled via environment variables; authentication enforced on write operations.

## Tech Stack Decisions
- Backend: Node 18, TypeScript, Express + Zod (validation), Prisma (ORM), Winston (logging), Jest (tests).
- Database: PostgreSQL 15 with Prisma migrations; Redis 7 for caching and rate limiting.
- External APIs: YGOPRODeck, Scryfall, and Pokémon TCG API v2. Wrap access in adapters with rate limiting and retries.
- Frontend: Next.js 14 (app router), React 18, TailwindCSS, React Query, Zustand (lightweight state), Playwright for e2e smoke tests.
- Containerization: Docker, docker-compose for local; GitHub Actions ready to run tests/build images.
- Observability: pino-http logging to console, OpenTelemetry hooks (stubbed) for future tracing.

## Repository Layout (Phase 1)
```
tcg-collection-manager/
├── docker/
│   ├── docker-compose.yml
│   ├── backend.Dockerfile
│   └── frontend.Dockerfile
├── backend/
│   ├── src/
│   │   ├── app.ts
│   │   ├── config/
│   │   ├── api/
│   │   │   ├── routes/
│   │   │   │   ├── cards.router.ts
│   │   │   │   ├── collections.router.ts
│   │   │   │   ├── users.router.ts
│   │   │   │   └── health.router.ts
│   │   │   └── middleware/
│   │   ├── modules/
│   │   │   ├── cards/
│   │   │   ├── collections/
│   │   │   ├── users/
│   │   │   └── adapters/
│   │   ├── services/
│   │   │   ├── tcg/
│   │   │   └── pricing/
│   │   ├── jobs/
│   │   └── utils/
│   ├── prisma/
│   │   ├── schema.prisma
│   │   └── migrations/
│   ├── tests/
│   └── package.json
├── frontend/
│   ├── app/
│   │   ├── layout.tsx
│   │   ├── page.tsx
│   │   ├── cards/
│   │   ├── collections/
│   │   └── auth/
│   ├── components/
│   ├── lib/
│   ├── public/
│   └── package.json
└── docs/
    ├── api.md
    └── architecture.md
```

## Backend Service Strategy

### Bootstrap & Configuration
- Initialize TypeScript + ts-node-dev; enforce ESLint + Prettier, commit hooks (lint-staged + Husky).
- Config module loads environment variables with Zod parsing; support `.env`, `.env.local`, and Docker secrets.
- Shared error handling middleware returning structured error payloads.

### Domain Modules
- `cards`: manages normalized card entities, references to tcg-specific tables, search caching.
- `collections`: user-owned card entries with quantity, condition, language.
- `users`: authentication, profile management, JWT issuance, password hashing (Argon2).
- `pricing`: price history ingestion and retrieval.

### Persistence & ORM
- Prisma schema modeling shared tables and per-TCG extension tables (via `@@map` + `Json` fields where helpful).
- Migration pipeline: `prisma migrate dev` for local, `prisma migrate deploy` in CI/CD.
- Repository layer wraps Prisma to isolate SQL from business logic and ease future engine swap.

### API Surface (initial endpoints)
- `GET /health` (liveness/readiness checks).
- `POST /auth/register`, `POST /auth/login`, `POST /auth/refresh`.
- `GET /cards/search` (global or filtered by `tcg`), `GET /cards/:tcg/:externalId`.
- `GET /collections/me`, `POST /collections`, `PATCH /collections/:id`, `DELETE /collections/:id`.
- `GET /cards/:id/prices` (historical), `POST /cards/:id/prices` (admin/import job hook).
- Admin scaffolding for enabling/disabling TCGs via `PATCH /tcg/:game`.

### Adapter Layer
- Base interface ensures parity across TCGs:
```ts
export interface TcgAdapter {
  readonly game: TcgCode;
  searchCards(query: string, filters?: AdapterFilters): Promise<CardDTO[]>;
  fetchCardById(externalId: string): Promise<CardDTO>;
  fetchSetByCode(code: string): Promise<SetDTO>;
  fetchPrices(externalId: string): Promise<PricePoint[]>;
  transformToSpecific(card: CardDTO): SpecificPayload;
}
```
- Concrete adapters (Yu-Gi-Oh!, Magic, Pokémon) encapsulate API clients, response normalization, rate limiting (Bottleneck), caching (Redis).
- Adapter registry maps `tcg_game.name` to implementation; fallback returns 503 if disabled.

### Background Jobs
- Scheduled sync (BullMQ + Redis) populates new sets/cards nightly per adapter.
- Price tracker jobs poll APIs (when allowed) and append to `price_history`.
- Manual re-sync endpoint triggers job with pagination & progress logging.

### Validation, Security, and Observability
- Zod schemas validate request payloads; express-rate-limit + Redis to prevent abuse.
- JWT access/refresh tokens with rotation; optional OAuth provider support stored for future.
- Pino logger integrations; request/response metadata with trace IDs.

### Testing Strategy
- Unit tests for adapters (mock API responses) and services (Jest).
- Integration tests using `supertest` against Express app + test Postgres container via docker-compose override.
- Contract tests for REST API using Prism (mock server) to guarantee schema compatibility with frontend/mobile.

## Database Plan

### Core Tables
```sql
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email VARCHAR(255) UNIQUE NOT NULL,
  username VARCHAR(100),
  password_hash TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE tcg_games (
  id SERIAL PRIMARY KEY,
  code VARCHAR(50) UNIQUE NOT NULL,
  display_name VARCHAR(100) NOT NULL,
  api_endpoint TEXT,
  schema_version VARCHAR(20),
  enabled BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE cards (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tcg_game_id INT REFERENCES tcg_games(id),
  external_id VARCHAR(100) NOT NULL,
  name VARCHAR(255) NOT NULL,
  set_code VARCHAR(50),
  set_name VARCHAR(255),
  rarity VARCHAR(50),
  image_url TEXT,
  image_url_small TEXT,
  tcg_specific JSONB,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  UNIQUE (tcg_game_id, external_id)
);

CREATE TABLE collections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  card_id UUID REFERENCES cards(id) ON DELETE CASCADE,
  quantity INT DEFAULT 1,
  condition VARCHAR(50),
  language VARCHAR(50),
  notes TEXT,
  custom_attributes JSONB,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  UNIQUE (user_id, card_id, condition, language)
);

CREATE TABLE price_history (
  id BIGSERIAL PRIMARY KEY,
  card_id UUID REFERENCES cards(id) ON DELETE CASCADE,
  price DECIMAL(10,2),
  currency VARCHAR(10) DEFAULT 'USD',
  source VARCHAR(100),
  recorded_at TIMESTAMP DEFAULT NOW()
);
```

### TCG-Specific Extensions
- `yugioh_cards`, `magic_cards`, `pokemon_cards` tables reference `cards.id` 1-1 with fields unique to each game.
- Use Prisma `@map` + `@@unique` to keep naming consistent between DB and TypeScript types.
- `tcg_specific` JSONB remains for flexible fields; long-term, views combine base + specific data for analytics.

### Seed & Sync
- Seed script inserts base `tcg_games` rows and minimal admin user.
- Sync jobs populate `cards` + extension tables via adapters; store pagination cursors in `sync_state` table for resumable jobs.

## Web Frontend Strategy
- Next.js app router with server actions. Uses NextAuth.js for auth (credentials provider hitting backend `/auth/login`).
- Layout:
  - Dashboard (user stats, recent price changes).
  - Card Explorer (search, filters by TCG, rarity, sets).
  - Collection Manager (CRUD, bulk import via CSV).
  - Card Detail (images, pricing chart, game-specific attributes).
- UI components built with Tailwind + Headless UI; charts via Recharts or Tremor.
- Data fetching with React Query; optimistic updates for collection mutations.
- Shared `@tcg/api-client` package (generated via OpenAPI + Orval) for typed API calls.
- Feature flags (toggled via backend `/config`) allow hiding incomplete modules.
- Accessibility + responsiveness prioritized; add skeleton loaders to smooth remote fetches.

## Shared Contracts & Tooling
- Generate OpenAPI spec from Express routes using `zod-to-openapi`; publish spec at `/docs`.
- Generate TypeScript clients for frontend/mobile; optional Kotlin/Swift via openapi-generator for later phases.
- Monorepo-style `package.json` with workspaces (`backend`, `frontend`, `packages/sdk`).

## Docker & DevOps Plan
- `docker/docker-compose.yml` orchestrates:
  - `postgres`: persistent volume `postgres_data`, healthcheck waiting on readiness.
  - `redis`: ephemeral cache.
  - `backend`: built from `backend.Dockerfile`; mounts source in dev mode; runs `npm run dev`.
  - `frontend`: built from `frontend.Dockerfile`; hot reload via `npm run dev`.
- Environment variable strategy:
  - `.env` (defaults), `.env.local` (developer overrides), `.env.docker` (compose).
  - Secrets (API keys) injected via Docker Compose overrides or CI secrets.
- CI outline (GitHub Actions):
  - Lint + test backend, lint frontend, run Prisma migrate, build Docker images, push to registry (optional).
- Production deployment targets: ECS Fargate or Kubernetes; Compose file doubles as template for Helm chart.

## Observability & Operations
- Central request logging with correlation IDs; log adapters’ upstream latency.
- Prometheus metrics endpoint (`/metrics`) using prom-client for Node.
- Health checks: `/health/live`, `/health/ready` hitting DB + Redis.
- Alerting guidance (not implemented): budget integration for rate limit breaches, API errors.

## Implementation Roadmap
1. **Project scaffolding**: initialize monorepo, configure lint/test tooling, add base Dockerfiles and compose stack.
2. **Database foundations**: author Prisma schema for core tables, run migrations, seed `tcg_games`.
3. **Backend MVP**: implement auth, health, cards search using stubbed adapters, integration tests.
4. **Adapter integrations**: build Yu-Gi-Oh!, Magic, Pokémon adapters with caching and rate limiting; add price sync jobs.
5. **Collections module**: CRUD endpoints with validation, permissions, and tests.
6. **OpenAPI + SDK generation**: expose spec, generate TypeScript client in shared package.
7. **Frontend MVP**: scaffold Next.js app, integrate auth, card search UI, collection views.
8. **Observability & hardening**: logging, metrics, error handling, add smoke tests (Playwright + CI).
9. **Release packaging**: finalize Docker images, document setup/run, create release notes.

## Risks & Open Questions
- Third-party API limits: need per-adapter throttling and caching strategy; consider storing data snapshots to avoid rate exhaustion.
- Image hosting: decide between hot-linking provider images vs caching locally (S3/minio).
- Pricing data availability: confirm APIs expose historical pricing; may require partnerships.
- Auth flows for mobile apps: plan for OAuth or session bridging later.
- Future expansions: additional TCGs, trading features, marketplace integrations—design adapters to accommodate new endpoints easily.

## Next Steps
- Confirm tech stack choices (Express vs Nest, Prisma vs TypeORM) and adjust plan if preferences differ.
- Approve roadmap ordering; once agreed, begin scaffolding repository and Docker stack.
- Gather API credentials (Pokémon TCG API key, optional proxies) before adapter implementation.

