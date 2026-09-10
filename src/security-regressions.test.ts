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
