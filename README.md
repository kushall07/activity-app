# Activity App

Activity-based social app for Bengaluru: post a plan (badminton, a comedy show,
a pottery workshop, dinner), say who you'd like to go with, match, book and go.

This repository is a TypeScript monorepo:

| Path              | What                                                                          |
| ----------------- | ----------------------------------------------------------------------------- |
| `apps/mobile`     | Expo (React Native) app for iOS and Android, Expo Router                      |
| `apps/api`        | NestJS HTTP API (Postgres + PostGIS via Drizzle, Redis)                       |
| `apps/workers`    | NestJS background workers consuming Amazon SQS                                |
| `packages/shared` | Contracts (zod schemas + types) shared by API, workers and mobile             |
| `infra/terraform` | AWS infrastructure (VPC, RDS, ElastiCache, ECS Fargate, SQS, S3 + CloudFront) |
| `docs/`           | Architecture notes                                                            |

## Prerequisites

- Node 22 (`nvm use`), pnpm 10 (`corepack enable`)
- Docker (for local Postgres/PostGIS, Redis and SQS)
- For the mobile app: Expo Go on a phone, or an iOS simulator / Android emulator

## Run it locally

```bash
pnpm install
cp .env.example .env
pnpm infra:up            # Postgres+PostGIS, Redis, ElasticMQ (SQS) via docker compose
pnpm build
pnpm db:migrate          # applies SQL migrations in apps/api/src/database/migrations

pnpm dev:api             # http://localhost:3000/health and /health/ready
pnpm dev:workers         # consumes the local jobs queue
pnpm dev:mobile          # scan the QR code with Expo Go
```

The mobile home screen calls `GET /health/ready` and shows whether the API,
Postgres (with PostGIS version) and Redis are reachable. On a physical phone set
`EXPO_PUBLIC_API_URL` in `apps/mobile/.env` to your laptop's LAN IP (see
`apps/mobile/.env.example`).

## Everyday commands

```bash
pnpm lint && pnpm typecheck && pnpm test   # what CI runs on every PR
pnpm test:e2e                              # API against real Postgres/Redis (needs infra:up)
pnpm db:generate                           # after editing apps/api/src/database/schema.ts
pnpm format                                # prettier
```

## Database migrations

Edit `apps/api/src/database/schema.ts`, run `pnpm db:generate`, review the SQL
and commit it. CI fails if the schema and migrations drift. In AWS, migrations
run as a one-off ECS task from the API image (`node dist/database/migrate.js`)
before a new version rolls out, so every migration must be backwards compatible
with the running version (expand, then contract).

## CI

`.github/workflows/ci.yml` runs on every pull request: format, lint, typecheck,
unit tests, API e2e tests against PostGIS + Redis service containers, a
migration drift check, an Android JS bundle, arm64 Docker builds for the API and
workers, and Terraform fmt/validate plus offline plan tests.

## Infrastructure

See [infra/terraform/README.md](infra/terraform/README.md). Nothing has been
applied yet; that needs an AWS account (see "What is needed to deploy").
