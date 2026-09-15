import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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

test("financial state transitions use database claims and serializable payment recording", () => {
  const service = source("./modules/accounting/accounting.service.ts");
  assert.match(service, /recordInvoicePayment[\s\S]*TransactionIsolationLevel\.Serializable/);
  assert.match(service, /paymentRequest\.updateMany\([\s\S]*status: "PENDING"/);
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
