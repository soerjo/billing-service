# Billing Service

Centralized billing API for invoice management, Midtrans payments, payment webhooks, reporting, and event delivery. The service is built with NestJS, TypeScript, Prisma, PostgreSQL, and Bun.

## Capabilities

- Invoice creation and retrieval
- Midtrans Snap checkout and QRIS generation
- Public Midtrans webhook handling with SHA-512 signature validation
- Idempotent payment settlement processing
- Transactional outbox events with Kafka publication and fallback relay
- Sales and revenue reporting
- JWT-protected API endpoints
- Health checks, structured request logging, Prometheus metrics, and Swagger/OpenAPI documentation

## Runtime and package manager

Bun is required for installation, scripts, tests, and application runtime.

```bash
bun install
```

Do not use npm, Yarn, pnpm, `node`, or Node-based test runners. The committed lockfile is `bun.lock`.

## Quick start

1. Copy `.env.example` to `.env` and provide the required values.
2. Start PostgreSQL and the application dependencies, or use the local Compose stack:

```bash
docker compose up -d
```

3. Apply the database schema:

```bash
bunx prisma migrate dev
```

4. Start the development server:

```bash
bun run start:dev
```

The default local application port is `3000` when running directly. The development Compose stack exposes the container on port `5000` by default.

## Development commands

| Command | Purpose |
| --- | --- |
| `bun install` | Install dependencies from `bun.lock` |
| `bun run start` | Start the Nest application |
| `bun run start:dev` | Start in watch mode |
| `bun run start:debug` | Start in debug/watch mode |
| `bun run build` | Build to `dist/` |
| `bun run start:prod` | Run the built application with Bun |
| `bun run lint` | Run ESLint with repository formatting rules |
| `bun run format` | Format TypeScript source and tests |
| `bunx prisma generate` | Generate the Prisma client |
| `bunx prisma migrate dev` | Create/apply development migrations |
| `bunx prisma migrate deploy` | Apply committed migrations in deployment environments |
| `bun run docs:openapi` | Generate `contracts/openapi.json` |

## API

The application sets the global `/api` prefix. Swagger UI is available at `/docs`.

### Public endpoints

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/health` | Check database health |
| `POST` | `/api/v1/webhooks/midtrans` | Receive Midtrans payment notifications |

### Authenticated endpoints

These endpoints require a Bearer JWT.

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/api/v1/invoices` | Create an invoice |
| `GET` | `/api/v1/invoices/:id` | Retrieve invoice details and transactions |
| `POST` | `/api/v1/invoices/:id/checkout` | Create a Midtrans Snap checkout transaction |
| `POST` | `/api/v1/invoices/:id/qr` | Generate a QRIS payment response |
| `GET` | `/api/v1/reports/sales` | Retrieve the sales and revenue report |

### Operational endpoints

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/metrics` | Expose raw Prometheus metrics |
| `GET` | `/docs` | Open Swagger UI |

`/metrics` intentionally stays outside the `/api` prefix and response envelope so Prometheus can scrape the raw exposition format.

## Configuration

Create `.env` from `.env.example`. `DATABASE_URL` and the JWT configuration are required for normal operation. Payment and integration settings control Midtrans, Kafka, CORS, and frontend integration.

| Variable | Required | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | Yes | PostgreSQL connection string |
| `NODE_ENV` | No | `development`, `test`, or `production` |
| `PORT` | No | HTTP port; defaults to `3000` |
| `JWT_ACCESS_SECRET` | Yes | Access-token signing secret |
| `JWT_REFRESH_SECRET` | Yes | Refresh-token signing secret |
| `JWT_ACCESS_EXPIRATION` | No | Access-token lifetime; defaults to `15m` |
| `JWT_REFRESH_EXPIRATION` | No | Refresh-token lifetime; defaults to `7d` |
| `MIDTRANS_SERVER_KEY` | Yes for real payments | Midtrans server credential |
| `MIDTRANS_CLIENT_KEY` | Yes for real payments | Midtrans client credential |
| `MIDTRANS_IS_PRODUCTION` | No | Select Midtrans production or sandbox URLs |
| `KAFKA_BROKERS` | No | Comma-separated Kafka brokers |
| `KAFKA_CLIENT_ID` | No | Kafka client identifier |
| `CORS_ORIGINS` | No | Comma-separated allowed origins |
| `FRONTEND_URL` | No | Frontend/OAuth redirect base URL |

Do not commit `.env` or production credentials. Compose defaults such as `postgres/postgres` and `admin/admin` are for local development only.

## Architecture

The code is organized as a NestJS modular monolith:

```text
src/
  main.ts                 HTTP bootstrap, global prefix, Swagger, metrics
  app.module.ts           Application module composition
  config/                 Environment validation and logging
  common/                 Guards, decorators, filters, interceptors, middleware
  prisma/                 Global Prisma service/module
  modules/
    invoices/             Invoice controller, service, repository, DTOs
    midtrans/             Midtrans integration
    webhooks/             Webhook validation and settlement handling
    outbox/               Durable event storage and relay
    reports/              Sales reporting
    health/               Database health endpoint
    metrics/              Prometheus metrics
```

Feature modules follow the pattern:

```text
Controller → Service → Repository → Prisma
```

Controllers own HTTP concerns and DTO binding. Services coordinate business workflows and integrations. Repositories are the Prisma query boundary. Expected client errors use Nest HTTP exceptions. Responses are transformed globally, and exceptions are normalized globally.

The billing data model is defined in `prisma/schema.prisma` and includes `BillingAccount`, `Invoice`, `PaymentTransaction`, `WebhookEvent`, and `OutboxEvent`.

## Local infrastructure

`docker-compose.yml` starts:

- Application container
- PostgreSQL 15
- Redis 7
- Prometheus
- Grafana

Useful commands:

```bash
docker compose up -d
docker compose logs -f app
docker compose down
```

The optional `docker-compose.override.yml` changes host ports for local setups. Prometheus scrapes `/metrics`; Grafana loads the provisioned dashboard and Prometheus datasource.

## Testing and quality gates

Tests use Bun's built-in test runner. The repository enforces 100% line coverage for instrumented source files.

```bash
bun test
bun run test:watch
bun run test:cov
bun run test:e2e
```

`bun run test:e2e` boots the complete Nest application and requires a reachable PostgreSQL database. Unit tests mock Prisma and external payment/event dependencies.

Before opening a pull request, run:

```bash
bunx tsc --noEmit
bun run lint
bun run test:cov
bun run build
```

CI runs Bun installation, Prisma client generation, lint, type checking, the coverage-gated test suite, and the production build.

## Generated API contract

Swagger generates the OpenAPI document from Nest decorators. To update the checked-in contract:

```bash
bun run docs:openapi
```

The generated file is `contracts/openapi.json`; update it when routes, DTOs, authentication, or response schemas change.

## Repository conventions

- Use Bun commands and keep `bun.lock` synchronized.
- Use `.js` extensions in TypeScript imports because the project uses NodeNext module resolution.
- Keep database access in repositories.
- Add DTO validation and Swagger decorators for new request bodies and query parameters.
- Preserve webhook idempotency and transactional outbox behavior.
- Add behavioral tests for payment signatures, invoice state transitions, webhook processing, outbox relay behavior, and metrics.
