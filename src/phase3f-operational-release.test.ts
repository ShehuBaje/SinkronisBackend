import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import test from "node:test";
import express from "express";
import { env, envSchema } from "./config/env";
import { evaluateMigrationState, migrationGateExitCode } from "./core/migration-gate";
import { errorMiddleware } from "./middleware/error.middleware";
import { internalRouter } from "./modules/internal/internal.routes";

const source = (file: string) => fs.readFileSync(file, "utf8");

const serve = async (app: express.Express, callback: (base: string) => Promise<void>) => {
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  try { await callback(`http://127.0.0.1:${address.port}`); }
  finally { await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); }
};

test("temporary Vercel hosting leaves scheduling external while preserving authenticated GET handlers and canonical cadences", () => {
  const manifest = JSON.parse(source("vercel.json")) as { crons?: Array<{ path: string; schedule: string }> };
  const routes = source("src/modules/internal/internal.routes.ts");
  const runbook = source("docs/financial-release-runbook.md");
  assert.equal(manifest.crons?.length ?? 0, 0);
  for (const expected of [
    ["/api/v1/internal/cron/subscriptions", "0 0 * * *"],
    ["/api/v1/internal/cron/financial-recovery", "*/5 * * * *"],
    ["/api/v1/internal/cron/financial-integrity", "17 * * * *"],
    ["/api/v1/internal/cron/payroll-processing", "*/5 * * * *"],
  ]) {
    assert.match(routes, new RegExp(`internalRouter\\.get\\(\\s*["']${expected[0]!.replace("/api/v1/internal", "").replaceAll("/", "\\/")}`));
    assert.match(runbook, new RegExp(expected[1]!.replaceAll("*", "\\*") + ".*" + expected[0]!.replaceAll("/", "\\/")));
  }
  assert.match(routes, /timingSafeEqual/);
});

test("Phase 3F Payroll Cron rejects missing and invalid authentication", async () => {
  const previous = env.CRON_SECRET;
  env.CRON_SECRET = "phase3f-test-secret-value";
  const app = express(); app.use("/api/v1/internal", internalRouter); app.use(errorMiddleware);
  try {
    await serve(app, async (base) => {
      const url = `${base}/api/v1/internal/cron/payroll-processing`;
      assert.equal((await fetch(url)).status, 401);
      assert.equal((await fetch(url, { headers: { authorization: "Bearer invalid-value" } })).status, 401);
    });
  } finally { env.CRON_SECRET = previous; }
});

test("Phase 3F migration gate detects pending migrations and accepts current state", () => {
  const pending = evaluateMigrationState(["001", "002"], ["001"]);
  const current = evaluateMigrationState(["002", "001"], ["002", "001"]);
  assert.deepEqual(pending, { current: false, required: ["001", "002"], applied: ["001"], pending: ["002"] });
  assert.deepEqual(current, { current: true, required: ["001", "002"], applied: ["001", "002"], pending: [] });
  assert.equal(migrationGateExitCode(pending), 1);
  assert.equal(migrationGateExitCode(current), 0);
});

test("Phase 3F dangerous serverless queue and transfer configurations fail closed", () => {
  const productionBase = {
    NODE_ENV: "production", DATABASE_URL: "mysql://example.invalid/db", JWT_ACCESS_SECRET: "a".repeat(24), JWT_REFRESH_SECRET: "b".repeat(24),
    CORS_ORIGIN: "https://app.example.test", PUBLIC_BASE_URL: "https://api.example.test", RATE_LIMIT_STORE: "redis", REDIS_URL: "redis://cache.example.test:6379",
    CRON_SECRET: "c".repeat(24), BACKGROUND_JOBS_MODE: "inline", DEPLOYMENT_RUNTIME: "serverless", PAYSTACK_TRANSFERS_ENABLED: "false",
  };
  assert.equal(envSchema.safeParse(productionBase).success, true);
  assert.equal(envSchema.safeParse({ ...productionBase, BACKGROUND_JOBS_MODE: "queue" }).success, false);
  assert.equal(envSchema.safeParse({ ...productionBase, PAYSTACK_TRANSFERS_ENABLED: "true", PAYSTACK_TRANSFERS_MODE: undefined, PAYSTACK_SECRET_KEY: undefined }).success, false);
});

test("Phase 3F keeps liveness, readiness, operational health, and worker ownership separate", () => {
  const app = source("src/app.ts");
  const local = source("src/local-server.ts");
  const worker = source("src/worker-server.ts");
  assert.match(app, /app\.get\("\/health"/);
  assert.match(app, /app\.get\("\/ready"/);
  assert.doesNotMatch(app, /FinancialIntegrityFinding/);
  assert.doesNotMatch(local, /initializeWorkers/);
  assert.match(worker, /initializeWorkers/);
  assert.match(worker, /process\.once\("SIGTERM"/);
  assert.match(worker, /closeWorkers/);
  assert.match(source("src/modules/admin/admin.service.ts"), /bounded: true/);
});
