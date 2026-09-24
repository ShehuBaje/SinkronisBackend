# Financial release runbook

This repository separates application liveness, infrastructure readiness, and financial operational health. A release must preserve all three.

## Production sequence

1. Build and run the bounded financial regression suites in CI. Run `npm run release:verify` with the production database URL supplied through the protected release environment. The migration gate is read-only and fails if any directory under `prisma/migrations` is not recorded as successfully applied.
2. If migrations are pending, stop application deployment. In one controlled release job run `npm run release:migrate` (`prisma migrate deploy`). Never run `prisma migrate dev` against production. The migration job must be serialized by the deployment platform so two releases cannot apply migrations concurrently; Prisma's migration table remains the database-level source of truth.
3. Rerun `npm run prisma:migrations:check`. A non-zero result blocks the release. Do not make application startup mutate schema and do not report readiness until the release gate passes.
4. Deploy the exact certified commit to Vercel. Configure `DEPLOYMENT_RUNTIME=serverless` and `BACKGROUND_JOBS_MODE=inline`. Vercel must invoke the authenticated GET Cron routes in `vercel.json`; correctness-critical recovery does not depend on BullMQ workers.
5. Verify `/health` (process liveness) and `/ready` (database plus configured Redis/queue dependencies). Then inspect the Platform Admin financial-operations health endpoint for recovery/scanner freshness and open integrity conditions. Financial findings do not by themselves change `/ready`.
6. Verify recent successful runs for financial recovery, financial integrity scanning, subscription maintenance, and Payroll processing. Missing or invalid Cron authorization must fail closed.

## Persistent workers

BullMQ email, export, privacy, and optional low-latency Payroll delivery require a separately hosted persistent process started with `npm run start:worker`, `DEPLOYMENT_RUNTIME=persistent-worker`, and `BACKGROUND_JOBS_MODE=queue`. Vercel does not host this process. SIGINT/SIGTERM stop intake, close workers (allowing BullMQ lock handling), close queues/Redis, and disconnect Prisma.

## Job ownership

| Job | Production ownership | Classification |
| --- | --- | --- |
| Financial recovery, inbound payment recovery | Authenticated Vercel GET Cron every five minutes; durable leases | Required on serverless production |
| Financial integrity scanner | Authenticated Vercel GET Cron hourly; durable scan runs/findings | Required on serverless production |
| Payroll run initialization/batches/recovery | Authenticated Vercel GET Cron every five minutes over durable run/batch rows; BullMQ is optional acceleration | Required on serverless production |
| Subscription lifecycle/renewal maintenance | Authenticated daily Vercel GET Cron with rotating bounded windows and idempotent durable changes | Required on serverless production |
| Notification email | Inline delivery in serverless mode or BullMQ on a separately hosted worker | Optional async with safe recorded failure |
| Accounting/organization exports and privacy expiry | Subscription maintenance provides bounded organization-export fallback; BullMQ persistent worker provides accounting export/low-latency processing | Persistent worker recommended; not a Vercel worker |
| BullMQ scheduler registrations | Dedicated persistent worker process only | Must not run in Vercel request processes |

## Rollback

Application rollback is safe only when the prior code is compatible with already-applied additive migrations. Never roll back a database by deleting financial evidence. If migration application fails, do not deploy the application. If post-deploy checks fail, restore the last compatible application deployment and keep financial Cron/operator actions paused until readiness is understood.

## Financial retry rule

A retry may only rerun certified recovery against the original durable operation and original provider reference. Never generate a new transfer reference, create a replacement credit/debit, mark an obligation paid, or replay an external payment as a new financial operation.
