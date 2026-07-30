# Sinkronis Backend

Multitenant Express, TypeScript, MySQL, and Prisma API for administration, HRIS, accounting, and payroll.

## Vercel deployment

Vercel detects the root `index.ts` as the single Express Serverless Function.
It exports the application implemented in `src/http-app.ts`. `src/local-server.ts`
remains the local and long-running worker entry point and is not imported by the
Vercel function.

Configure these production environment variables in Vercel:

```text
NODE_ENV=production
DATABASE_URL=<TiDB connection URL with sslaccept=strict>
JWT_ACCESS_SECRET=<random secret of at least 24 characters>
JWT_REFRESH_SECRET=<different random secret of at least 24 characters>
CORS_ORIGIN=https://<frontend-domain>
STORAGE_PROVIDER=vercel-blob
BLOB_READ_WRITE_TOKEN=<Vercel Blob read/write token>
RATE_LIMIT_STORE=redis
REDIS_URL=<TLS Redis URL>
BACKGROUND_JOBS_MODE=inline
CRON_SECRET=<random secret of at least 16 characters>
EMAIL_FROM=no-reply@<verified-domain>
```

`BACKGROUND_JOBS_MODE=inline` keeps payslip generation operational without a
permanent BullMQ worker. The secured Vercel cron route processes subscription
lifecycle transitions and renewal notifications once per day. For higher-volume
payroll processing, deploy `src/local-server.ts` separately as a persistent worker and
switch the API to `BACKGROUND_JOBS_MODE=queue`.

Before the first production deployment, apply committed migrations to TiDB from
a controlled environment:

```bash
npm run prisma:deploy
```

Do not run `prisma migrate dev` against production. Prisma Client generation is
handled by both `postinstall` and the production build.

## Modules

- Admin: organization profile, departments, teams, roles and permissions, staff management, system config.
- HRIS: employee directory, clock in/out, leave management, appraisal cycles, conduct logs.
- Accounting: clients, invoices, payment requests, VAT/tax reports, wallets, disbursements, agent invitations.
- Payroll: payroll runs, salary structures, statutory PAYE/pension reporting, payslips, loans and advances.

## Setup

1. Install dependencies:

```bash
npm install
```

2. Copy `.env.example` to `.env` and set `DATABASE_URL` plus JWT secrets.

3. Create and migrate the MySQL database:

```bash
npm run prisma:migrate
```

4. Seed permissions and a default tenant/admin:

```bash
npm run db:seed
```

5. Sync newly introduced permission keys into system roles (recommended after permission catalog updates):

```bash
npm run permissions:sync
```

6. Migrate legacy non-system role permissions (for example `:manage` and `:read`) to action-based keys:

```bash
npm run permissions:migrate-legacy
```

7. Start the API with nodemon:

```bash
npm run dev
```

## Tenant Model

Every tenant-owned resource includes `organizationId`. Protected routes use JWT authentication, derive the tenant from the authenticated user, and apply that tenant scope in all CRUD routes.

## Auth

- `POST /api/auth/register` creates an organization, owner role, owner user, permissions, and JWT tokens.
- `POST /api/auth/login` authenticates by `organizationSlug`, email, and password.

Use the returned access token as:

```text
Authorization: Bearer <token>
```

## Main Route Prefixes

- `/api/v1/admin`
- `/api/v1/hris`
- `/api/v1/accounting`
- `/api/v1/payroll`
- `/api/v1/bull`
- `/api/v1/docs` (Swagger UI)
- `/api/v1/docs.json` (OpenAPI JSON)

## Redis And Bull Dashboard

Redis is configured through `REDIS_HOST`, `REDIS_PORT`, `REDIS_PASSWORD`, and `REDIS_DB`.
The Bull dashboard is mounted at `/api/v1/bull`.

The service is intentionally API-first. A frontend can consume the route groups directly, while RBAC and tenant isolation remain server-side.
