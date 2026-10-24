# Repository Guidelines

## Project Overview

Payment integration service built with NestJS. It initiates and tracks payment flows through PostgreSQL/Prisma, integrates with Midtrans checkout, QRIS, and Virtual Accounts, processes payment webhooks, publishes events through a Kafka-oriented transactional outbox, and exposes service-to-service protected APIs, Swagger, health checks, and Prometheus metrics.

## Architecture & Data Flow

- `src/main.ts` bootstraps the HTTP app: `/api` prefix, Helmet, CORS, validation, exception handling, response transformation, request logging, `/metrics`, and Swagger at `/docs`.
- `src/app.module.ts` composes global infrastructure and feature modules.
- Feature flow is generally **Controller → Service → Repository**:
  - Controllers define routes, decorators, and DTO binding.
  - Services implement business workflows and coordinate integrations.
  - Repositories are the Prisma query boundary and raise `NotFoundException` for missing records.
- `src/prisma/prisma.module.ts` is global; `PrismaService` is shared across modules.
- Payment initiation (`POST /api/v1/payments/{snap,qr,virtual-account}`) creates Midtrans transactions, tracks `PaymentTransaction` attempts per external `orderId`, and returns checkout tokens/VA details.
- Webhook processing (`POST /api/v1/webhooks/midtrans`) is idempotent, updates payment transaction status, and writes outbox events (`PAYMENT_COMPLETED`, `PAYMENT_FAILED`) for downstream publication.
- Successful responses use `ResponseTransformInterceptor`; exceptions use `AllExceptionsFilter`. Expected client failures should use Nest HTTP exceptions.
- `/metrics` is intentionally raw Prometheus output and is outside the `/api` prefix and normal response envelope.

## Key Directories

- `src/config/` — environment validation and logger configuration.
- `src/common/` — guards, decorators, filters, interceptors, middleware, and shared utilities.
- `src/prisma/` — Prisma module/service.
- `src/modules/payments/` — payment controller, service, repository, DTOs.
- `src/modules/payment-methods/` — virtual account bank catalog.
- `src/modules/midtrans/` — payment provider integration.
- `src/modules/webhooks/` — provider webhook validation and settlement handling.
- `src/modules/outbox/` — durable event storage and publication/fallback processing.
- `src/modules/metrics/` and `src/modules/health/` — observability endpoints/services.
- `prisma/` — PostgreSQL schema and migrations.
- `test/` — e2e configuration and setup.
- `contracts/openapi.json` — generated OpenAPI contract.
- `scripts/` — repository automation, including OpenAPI generation.

## Development Commands

```bash
bun install
bun run start:dev
bun run build
bun run lint
bunx tsc --noEmit
bunx prisma generate
bunx prisma migrate dev
bunx prisma migrate deploy
bun run docs:openapi
```

Use `bun run start:prod` after building. `docker-compose.yml` provides local app, PostgreSQL, Redis, Prometheus, and Grafana services; `docker-compose.override.yml` changes host ports for alternate local setups.

## Code Conventions & Common Patterns

- TypeScript uses NodeNext resolution; **all imports include `.js` extensions**.
- Use Nest decorators and dependency injection. Register controllers/providers/imports in each feature module, and inject repositories/services rather than constructing them directly.
- Keep Prisma access in repositories. Keep HTTP concerns in controllers and business orchestration in services.
- Use DTOs with `class-validator` for input validation and Swagger decorators for API documentation.
- Use single quotes and trailing commas; Prettier violations are lint errors.
- Name files by role (`*.controller.ts`, `*.service.ts`, `*.repository.ts`, `*.dto.ts`, `*.guard.ts`, `*.spec.ts`). Prefer explicit feature folders under `src/modules/<domain>/`.
- Prefer async/await for I/O. Preserve idempotency for webhook/event handlers and use durable outbox records rather than publishing directly as the only persistence step.
- Keep environment variables declared in `src/config/env.validation.ts`; use `.env.example`, not the legacy `.example.env`.

## Important Files

- `src/main.ts` — application bootstrap and global HTTP pipeline.
- `src/app.module.ts` — module composition and global infrastructure.
- `src/modules/payments/payments.controller.ts` / `payments.service.ts` / `payments.repository.ts` — representative feature layering.
- `src/modules/webhooks/` — payment settlement and idempotency behavior.
- `src/common/filters/all-exceptions.filter.ts` — normalized error envelope.
- `src/common/interceptors/response-transform.interceptor.ts` — success envelope.
- `src/modules/metrics/metrics.service.ts` — Prometheus counters/histograms.
- `prisma/schema.prisma` — billing data model and enums.
- `package.json`, `tsconfig.json`, `eslint.config.mjs`, `nest-cli.json` — primary tooling configuration.
- `.github/workflows/ci.yml` — CI quality, targeted tests, and build jobs.

## Runtime/Tooling Preferences

- Use **Bun only** for dependency installation and scripts; commit only `bun.lock`. Do not use npm, Yarn, or pnpm.
- TypeScript targets ES2023 with `module`/`moduleResolution: nodenext`.
- Production builds use `nest build`; production runs `bun run dist/main.js`.
- Active lint configuration is `eslint.config.mjs` with type-aware `projectService: true`; `.eslintrc.js` is legacy configuration and should not introduce a third convention.
- `bun run lint` uses ESLint `--fix`; CI runs check-only ESLint. Avoid relying on automatic fixes when validating a change.

## Testing & QA

- Unit tests use Bun's built-in test runner with `.spec.ts` naming. They isolate services with mocked Prisma and external providers.
- Run tests with:

```bash
bun test
bun run test:watch
bun run test:cov
bun run test:e2e
```

- E2E tests use `test/app.e2e-spec.ts` and `supertest`; they boot the full Nest app and require reachable PostgreSQL because Prisma connects during module initialization.
- CI runs the Bun test suite with the 100% line-coverage gate, plus Prisma generation, lint, typecheck, and build.
- No Jest or Node-based test runner is required.
- Before a PR, run:

```bash
bunx tsc --noEmit
bun run lint
bun run test:cov
bun run build
```

- Add tests for consumer-visible behavior, especially payment signatures, webhook idempotency, payment state transitions, validation, and metrics labels.
