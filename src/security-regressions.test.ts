import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const source = (relativePath: string) => readFileSync(path.resolve(__dirname, relativePath), "utf8");

test("authentication recovery is throttled, non-enumerating, and atomically consumes challenges", () => {
  const routes = source("./modules/auth/auth.routes.ts");
  const service = source("./modules/auth/auth.service.ts");
  assert.match(routes, /passwordRecoveryLimit/);
  assert.match(service, /If an active account matches those details/);
  assert.match(service, /passwordResetOtp\.updateMany\([\s\S]*consumedAt: null[\s\S]*verifiedAt: \{ not: null \}/);
  assert.match(service, /authChallenge\.updateMany\([\s\S]*consumedAt: null/);
});

test("financial state transitions use database claims and TiDB-supported repeatable-read payment recording", () => {
  const service = source("./modules/accounting/accounting.service.ts");
  assert.match(service, /recordInvoicePayment[\s\S]*TransactionIsolationLevel\.RepeatableRead/);
  assert.match(service, /paymentRequest\.updateMany\([\s\S]*status: "PENDING"/);
  assert.match(
    service,
    /disbursePaymentRequest[\s\S]*completeManualSettlement[\s\S]*paymentRequest\.updateMany\([\s\S]*status: "APPROVED"/,
  );
});

test("TiDB runtime code never requests unsupported SERIALIZABLE isolation", () => {
  const files: string[] = [];
  const walk = (directory: string) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory() && !["scripts", "financial-tests", "test-infrastructure"].includes(entry.name)) walk(absolute);
      else if (entry.isFile() && entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")) files.push(absolute);
    }
  };
  walk(path.resolve(__dirname));
  for (const file of files) {
    const runtimeSource = readFileSync(file, "utf8");
    assert.doesNotMatch(runtimeSource, /TransactionIsolationLevel\.Serializable|isolationLevel\s*:\s*["']Serializable["']|SET\s+TRANSACTION\s+ISOLATION\s+LEVEL\s+SERIALIZABLE/i, file);
  }
});

test("financial settlements have durable identities, reservations and a default-off provider gate", () => {
  const schema = source("../prisma/schema.prisma");
  const settlement = source("./core/financial-settlement.ts");
  const provider = source("./core/settlement-provider.ts");
  const env = source("./config/env.ts");
  assert.match(schema, /model FinancialSettlement[\s\S]*@@unique\(\[organizationId, sourceType, sourceId\]/);
  assert.match(schema, /reservedBalance/);
  assert.match(settlement, /balance - reservedBalance >=/);
  assert.match(settlement, /status: "SUCCEEDED"/);
  assert.match(provider, /PROVIDER_SETTLEMENT_DISABLED/);
  assert.match(env, /PAYSTACK_TRANSFERS_ENABLED[\s\S]*default\("false"\)/);
  assert.match(env, /PAYSTACK_TRANSFERS_MODE: z\.enum\(\["test", "live"\]\)\.optional\(\)/);
  assert.match(provider, /assertPaystackTransferCredentialMode/);
  assert.doesNotMatch(source("./core/provider-settlement.ts"), /otp[\s\S]*walletTransaction\.create/);
});

test("TEST_E2E value and provider paths fail closed outside test mode", () => {
  const schema = source("../prisma/schema.prisma");
  const providerSettlement = source("./core/provider-settlement.ts");
  const testInfrastructure = source("./modules/platform-admin/test-e2e.service.ts");
  assert.match(schema, /classification\s+organization_classification\s+@default\(CUSTOMER\)/);
  assert.match(providerSettlement, /classification === "TEST_E2E" && env\.PAYSTACK_TRANSFERS_MODE !== "test"/);
  assert.match(testInfrastructure, /classification: "TEST_E2E"/);
  assert.match(testInfrastructure, /type: "TEST_E2E_CREDIT"/);
  assert.match(testInfrastructure, /isPlatformAdmin/);
});

test("Paystack OTP finalization is tenant-authenticated, strongly authorized, rate-limited, and never audited with the OTP", () => {
  const routes = source("./modules/accounting/accounting.routes.ts");
  const service = source("./modules/accounting/accounting.service.ts");
  const provider = source("./core/provider-settlement.ts");
  assert.match(routes, /financial-settlements\/:id\/finalize-otp[\s\S]*limit: 5[\s\S]*accounting:payments:approve[\s\S]*accounting:wallets:update/);
  assert.match(provider, /findFirst\(\{ where: \{ id: settlementId, organizationId \} \}\)/);
  assert.match(provider, /providerStatus: "otp_finalizing"/);
  const auditBlock = service.match(/finalizeAccountingSettlementOtp[\s\S]*?return settlementDto\(settlement\);[\s\S]*?throw error;/)?.[0] ?? "";
  assert.ok(auditBlock);
  const auditCalls = auditBlock.split("\n").filter((line) => line.includes("await audit("));
  assert.equal(auditCalls.length, 2);
  assert.doesNotMatch(auditCalls.join("\n"), /\{[^}]*\botp\s*:/i);
  assert.doesNotMatch(source("./app.ts"), /morgan\([^)]*:body/);
});

test("database diagnostics do not embed credentials", () => {
  const diagnostic = source("./db/db.ts");
  assert.match(diagnostic, /process\.env\.DATABASE_URL/);
  assert.doesNotMatch(diagnostic, /password\s*:/);
});

test("subscription value requires a durable verified provider payment", () => {
  const service = source("./modules/admin/admin.service.ts");
  const schema = source("../prisma/schema.prisma");
  assert.doesNotMatch(service, /createProviderCardToken|Buffer\.from\(tokenSeed\)/);
  assert.match(service, /initializeSubscriptionPayment[\s\S]*initializePaystackTransaction/);
  assert.match(service, /finalizeSubscriptionPayment[\s\S]*verification\.amount[\s\S]*verification\.currency/);
  assert.match(service, /subscriptionPaymentAttempt\.updateMany[\s\S]*status: "VERIFIED"/);
  assert.match(service, /paymentAuthorized: true[\s\S]*pendingKey: `PENDING:/);
  assert.match(service, /applyDuePlanChanges[\s\S]*paymentAuthorized: true[\s\S]*status: "COMPLETED"/);
  assert.match(schema, /model SubscriptionPaymentAttempt[\s\S]*@@unique\(\[organizationId, idempotencyKey\]/);
  assert.match(schema, /pendingKey\s+String\?\s+@unique/);
});

test("object storage uses a canonical origin and restricts remote reads", () => {
  const storage = source("./core/object-storage.ts");
  assert.match(storage, /env\.PUBLIC_BASE_URL/);
  assert.match(storage, /isAllowedBlobHost/);
  assert.match(storage, /redirect: "error"/);
  assert.match(storage, /MAX_REMOTE_OBJECT_BYTES/);
});

test("shared CRUD mutations require explicit permissions and unsafe domain CRUD mounts are absent", () => {
  const crud = source("./core/crud-router.ts");
  const hrisRoutes = source("./modules/hris/hris.routes.ts");
  const accountingRoutes = source("./modules/accounting/accounting.routes.ts");
  assert.match(crud, /createPermission: PermissionKey/);
  assert.match(crud, /updatePermission: PermissionKey/);
  assert.match(crud, /deletePermission: PermissionKey/);
  assert.doesNotMatch(crud, /createPermission \?\? options\.permission/);
  for (const unsafe of ["employees", "attendance", "leave"]) assert.doesNotMatch(hrisRoutes, new RegExp(`createCrudRouter\\([^)]*${unsafe}`));
  for (const unsafe of ["wallets", "tax-reports", "wallet-disbursements"]) assert.doesNotMatch(accountingRoutes, new RegExp(`createCrudRouter\\([^)]*${unsafe}`));
});

test("password reset and logout revoke server-side sessions", () => {
  const routes = source("./modules/auth/auth.routes.ts");
  const service = source("./modules/auth/auth.service.ts");
  assert.match(routes, /authRouter\.post\("\/logout", authenticate/);
  assert.match(service, /export const logout[\s\S]*userSession\.updateMany[\s\S]*revokeReason: "User logged out"/);
  assert.match(service, /resetPassword[\s\S]*userSession\.updateMany[\s\S]*revokeReason: "Password reset"/);
});

test("private local objects are not mounted as unauthenticated static files", () => {
  const app = source("./app.ts");
  const storage = source("./core/object-storage.ts");
  assert.match(app, /general-settings\/branding/);
  assert.match(app, /return res\.status\(404\)\.end\(\)/);
  assert.match(storage, /resolvedVisibility = visibility \?\?/);
  assert.match(storage, /get\(reference/);
});

test("release hardening includes readiness, POST cron, strict dates, and separate workers", () => {
  assert.match(source("./app.ts"), /app\.get\("\/ready"/);
  assert.match(source("./modules/internal/internal.routes.ts"), /internalRouter\.post\([\s\S]*"\/cron\/subscriptions"/);
  assert.match(source("./core/date-only.ts"), /getUTCFullYear/);
  const queues = source("./queues/index.ts");
  for (const name of ["NOTIFICATION_QUEUE_NAME", "LIFECYCLE_QUEUE_NAME", "EXPORT_QUEUE_NAME"]) assert.match(queues, new RegExp(name));
});
