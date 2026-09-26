import assert from "node:assert/strict";
import { after, test } from "node:test";
import express from "express";
import { env } from "../config/env.js";
import { checkDatabaseMigrations } from "../core/migration-gate.js";
import { prisma } from "../core/prisma.js";
import { errorMiddleware } from "../middleware/error.middleware.js";
import { internalRouter } from "../modules/internal/internal.routes.js";
import { assertSafeTestDatabase } from "../test-infrastructure/test-database.js";

const enabled = Boolean(process.env.TEST_DATABASE_GUARD);
if (enabled) {
  assert.equal(process.env.NODE_ENV, "test");
  assert.equal(process.env.PAYSTACK_TRANSFERS_ENABLED, "false");
  assertSafeTestDatabase({ databaseUrl: process.env.DATABASE_URL_ORIGINAL, testDatabaseUrl: process.env.DATABASE_URL, nodeEnv: process.env.NODE_ENV, destructive: true });
}
const it = enabled ? test : test.skip;
if (enabled) after(() => prisma.$disconnect());

const serve = async (app: express.Express, fn: (base: string) => Promise<void>) => {
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve, reject) => { server.once("listening", resolve); server.once("error", reject); });
  try {
    const address = server.address(); if (!address || typeof address === "string") throw new Error("No test server address");
    await fn(`http://127.0.0.1:${address.port}`);
  } finally { await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); }
};

it("Phase 3F valid Payroll Cron is accepted and remains bounded", async () => {
  const previous = env.CRON_SECRET; env.CRON_SECRET = "phase3f-financial-test-secret";
  const app = express(); app.use("/api/v1/internal", internalRouter); app.use(errorMiddleware);
  try {
    await serve(app, async (base) => {
      const response = await fetch(`${base}/api/v1/internal/cron/payroll-processing`, { headers: { authorization: `Bearer ${env.CRON_SECRET}` } });
      assert.equal(response.status, 200);
      const body = await response.json() as { success: boolean; data: { recoveredRuns: number } };
      assert.equal(body.success, true);
      assert.equal(body.data.recoveredRuns <= env.PAYROLL_CRON_RUN_LIMIT, true);
    });
  } finally { env.CRON_SECRET = previous; }
});

it("Phase 3F migration release gate accepts the migrated isolated schema", async () => {
  const result = await checkDatabaseMigrations();
  assert.equal(result.current, true, `pending migrations: ${result.pending.join(", ")}`);
  assert.equal(result.pending.length, 0);
});
