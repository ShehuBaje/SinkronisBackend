import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import jwt from "jsonwebtoken";
import crypto from "node:crypto";
import { env } from "./config/env";
import { prisma } from "./core/prisma";
import { authenticate } from "./middleware/auth.middleware";
import { unsafeRawSqlViolations } from "./scripts/check-unsafe-raw-sql";
import { logout, refreshAuthenticationTokens, signTokens } from "./modules/auth/auth.service";

const root = process.cwd();
const read = (file: string) => fs.readFileSync(path.join(root, file), "utf8");

test("unsafe raw SQL guard rejects runtime unsafe APIs while allowing parameterized financial SQL", () => {
  assert.deepEqual(unsafeRawSqlViolations(root), []);
  const wallet = read("src/core/wallet-integrity.ts");
  assert.equal(wallet.includes("$executeRaw" + "Unsafe"), false);
  assert.equal(wallet.includes("$queryRaw" + "Unsafe"), false);
  assert.match(wallet, /\$executeRaw`[\s\S]*\$\{input\.walletAccountId\}/);
  assert.match(wallet, /organizationId = \$\{input\.organizationId\}/);
});

test("malicious identifiers remain Prisma tagged-template parameters", () => {
  const malicious = "wallet' OR 1=1 --";
  const query = (prisma as any).$executeRaw;
  assert.equal(typeof query, "function");
  const source = read("src/core/wallet-integrity.ts");
  assert.equal(source.includes(malicious), false);
  assert.doesNotMatch(source, /\$executeRaw\([^`]/);
});

test("financial evidence relations fail closed on parent deletion", () => {
  const schema = read("prisma/schema.prisma");
  for (const relation of [
    "AuditLog_organizationId_fkey", "AuditLogChain_organizationId_fkey",
    "BillingHistory_organizationId_fkey", "SubscriptionPaymentAttempt_organizationId_fkey",
    "WalletAccount_organizationId_fkey", "WalletFundingAttempt_org_fkey",
    "WalletFundingAttempt_wallet_fkey", "FinancialSettlement_org_fkey",
    "ProviderTransferRecipient_org_fkey", "WalletTransaction_org_fkey",
    "WalletTransaction_wallet_fkey", "WalletDisbursement_walletAccountId_fkey",
  ]) {
    const line = schema.split(/\r?\n/).find((value) => value.includes(`map: "${relation}"`));
    assert.match(line ?? "", /onDelete: Restrict/, relation);
  }
  assert.doesNotMatch(read("src/modules/platform-admin/organization-deletion.service.ts"), /organization\.delete/);
});

test("authenticated requests require a current durable session", async () => {
  const originalUser = prisma.user.findFirst;
  const originalSession = prisma.userSession.findFirst;
  let sessionWhere: any;
  (prisma.user.findFirst as any) = async () => ({
    id: "user", organizationId: "org", email: "safe@example.test", roleId: "role",
    isActive: true, isPlatformAdmin: true, moduleAccess: [], organization: { status: "ACTIVE" },
    role: { isSystem: false, name: "Platform", permissions: [] },
  });
  (prisma.userSession.findFirst as any) = async (input: any) => { sessionWhere = input.where; return null; };
  try {
    const token = jwt.sign({ organizationId: "org", sessionId: "revoked-session" }, env.JWT_ACCESS_SECRET, { subject: "user", expiresIn: "5m" });
    let received: any;
    await authenticate({ header: () => `Bearer ${token}` } as any, {} as any, (error?: unknown) => { received = error; });
    assert.equal(received?.statusCode, 401);
    assert.equal(sessionWhere.isCurrent, true);
    assert.equal(sessionWhere.revokedAt, null);
    assert.ok(sessionWhere.expiresAt.gt instanceof Date);
  } finally {
    (prisma.user.findFirst as any) = originalUser;
    (prisma.userSession.findFirst as any) = originalSession;
  }
});

test("sessionless normal access tokens fail closed", async () => {
  const originalUser = prisma.user.findFirst;
  (prisma.user.findFirst as any) = async () => ({
    id: "user", organizationId: "org", email: "safe@example.test", roleId: "role",
    isActive: true, isPlatformAdmin: true, moduleAccess: [], organization: { status: "ACTIVE" },
    role: { isSystem: false, name: "Platform", permissions: [] },
  });
  try {
    const token = jwt.sign({ organizationId: "org" }, env.JWT_ACCESS_SECRET, { subject: "user", expiresIn: "5m" });
    let received: any;
    await authenticate({ header: () => `Bearer ${token}` } as any, {} as any, (error?: unknown) => { received = error; });
    assert.equal(received?.statusCode, 401);
  } finally {
    (prisma.user.findFirst as any) = originalUser;
  }
});

test("refresh rejects a non-current durable session", async () => {
  const originalFind = prisma.userSession.findFirst;
  let where: any;
  (prisma.userSession.findFirst as any) = async (input: any) => { where = input.where; return null; };
  try {
    const refreshToken = signTokens({ id: "user", organizationId: "org" }, "old-session").refreshToken;
    await assert.rejects(refreshAuthenticationTokens({ refreshToken }), (error: any) => error?.statusCode === 401);
    assert.equal(where.refreshTokenHash, crypto.createHash("sha256").update(refreshToken).digest("hex"));
    assert.equal(where.isCurrent, true);
    assert.equal(where.revokedAt, null);
  } finally {
    (prisma.userSession.findFirst as any) = originalFind;
  }
});

test("logout revokes and clears current status for the bound session", async () => {
  const originalUpdate = prisma.userSession.updateMany;
  let input: any;
  (prisma.userSession.updateMany as any) = async (value: any) => { input = value; return { count: 1 }; };
  try {
    await logout("user", "org", "session");
    assert.deepEqual(input.where, { id: "session", userId: "user", organizationId: "org", revokedAt: null });
    assert.equal(input.data.isCurrent, false);
    assert.ok(input.data.revokedAt instanceof Date);
  } finally {
    (prisma.userSession.updateMany as any) = originalUpdate;
  }
});

test("new login and refresh predicates revoke superseded sessions deterministically", () => {
  const auth = read("src/modules/auth/auth.service.ts");
  assert.match(auth, /SELECT id FROM User WHERE id = \$\{user\.id\}[\s\S]*FOR UPDATE/);
  assert.match(auth, /revokeReason: "Superseded by a new login"/);
  assert.match(auth, /isCurrent: true,[\s\S]*revokedAt: null/);
  assert.match(auth, /isolationLevel: Prisma\.TransactionIsolationLevel\.RepeatableRead/);
});

test("historical integrity correction remains an administrative adjustment", () => {
  const scanner = read("src/core/financial-integrity-scanner.ts");
  assert.match(scanner, /FINANCIAL_INTEGRITY_CORRECTION/);
  assert.match(scanner, /FINANCIAL_INTEGRITY_REPAIR/);
  assert.match(scanner, /ADJUSTMENT/);
});
