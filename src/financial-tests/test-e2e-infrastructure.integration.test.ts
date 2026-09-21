import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { prisma } from "../core/prisma.js";
import { assertSafeTestDatabase } from "../test-infrastructure/test-database.js";
import { classifyTestTenant, creditTestTenantWallet, setTestTenantEntitlement } from "../modules/platform-admin/test-e2e.service.js";
import { createAccountingWallet } from "../modules/accounting/accounting.service.js";
import { evaluateEffectiveModuleAccess, isOrganizationModuleEnabled } from "../modules/billing/module-access.service.js";

const enabled = Boolean(process.env.TEST_DATABASE_GUARD);
if (enabled) assertSafeTestDatabase({ databaseUrl: process.env.DATABASE_URL_ORIGINAL, testDatabaseUrl: process.env.DATABASE_URL, nodeEnv: process.env.NODE_ENV, destructive: true });
const financialTest = enabled ? test : test.skip;
const prefix = `test-e2e-infra-${Date.now()}`;

let tenantId = "";
let tenantUser: any;
let platformUser: any;

before(async () => {
  if (!enabled) return;
  const platformOrg = await prisma.organization.create({ data: { name: `${prefix}-platform`, slug: `${prefix}-platform` } });
  const platformRole = await prisma.role.create({ data: { organizationId: platformOrg.id, name: "Platform" } });
  platformUser = await prisma.user.create({ data: { organizationId: platformOrg.id, roleId: platformRole.id, email: `${prefix}-platform@example.test`, passwordHash: "test-only", firstName: "Platform", lastName: "Admin", isPlatformAdmin: true } });
  const tenant = await prisma.organization.create({ data: { name: `${prefix}-tenant`, slug: `${prefix}-tenant` } });
  tenantId = tenant.id;
  const role = await prisma.role.create({ data: { organizationId: tenant.id, name: "Owner" } });
  tenantUser = await prisma.user.create({ data: { organizationId: tenant.id, roleId: role.id, email: `${prefix}-owner@example.test`, passwordHash: "test-only", firstName: "E2E", lastName: "Owner" } });
});

after(async () => {
  if (!enabled) return;
  const organizations = await prisma.organization.findMany({ where: { slug: { startsWith: prefix } }, select: { id: true } });
  for (const organization of organizations) {
    await prisma.auditLog.deleteMany({ where: { organizationId: organization.id } });
    await prisma.auditLogChain.deleteMany({ where: { organizationId: organization.id } });
    await prisma.walletTransaction.deleteMany({ where: { organizationId: organization.id } });
    await prisma.walletAccount.deleteMany({ where: { organizationId: organization.id } });
    await prisma.testModuleEntitlement.deleteMany({ where: { organizationId: organization.id } });
    await prisma.user.deleteMany({ where: { organizationId: organization.id } });
    await prisma.role.deleteMany({ where: { organizationId: organization.id } });
    await prisma.organization.delete({ where: { id: organization.id } });
  }
  await prisma.$disconnect();
});

financialTest("classification, entitlement, empty wallet and test credit preserve billing truth", async () => {
  const platform = { id: platformUser.id, organizationId: platformUser.organizationId, email: platformUser.email, roleId: platformUser.roleId, isPlatformAdmin: true, permissions: [] } as any;
  const tenant = { id: tenantUser.id, organizationId: tenantId, email: tenantUser.email, roleId: tenantUser.roleId, isPlatformAdmin: false, permissions: ["accounting:wallets:update"] } as any;
  assert.equal((await prisma.organization.findUniqueOrThrow({ where: { id: tenantId } })).classification, "CUSTOMER");
  await assert.rejects(() => setTestTenantEntitlement(tenantId, "accounting", { active: true, reason: "Must reject ordinary customer tenant" }, platform), /TEST_E2E tenant/);
  await assert.rejects(() => classifyTestTenant(tenantId, { classification: "TEST_E2E", reason: "Unauthorized tenant classification attempt" }, tenant), /Platform Admin/);

  await classifyTestTenant(tenantId, { classification: "TEST_E2E", reason: "Controlled financial integration test tenant" }, platform);
  await setTestTenantEntitlement(tenantId, "accounting", { active: true, reason: "Controlled Accounting integration test access" }, platform);
  assert.equal(await isOrganizationModuleEnabled(tenantId, "accounting"), true);
  assert.equal(await evaluateEffectiveModuleAccess({ organizationId: tenantId, userIsActive: true, permissions: ["accounting:wallets:update"], module: "accounting" }), true);
  assert.equal(await prisma.billingHistory.count({ where: { organizationId: tenantId } }), 0);
  assert.equal(await prisma.subscriptionPaymentAttempt.count({ where: { organizationId: tenantId } }), 0);
  assert.equal(await prisma.systemConfig.count({ where: { organizationId: tenantId, key: "billing.subscription" } }), 0);

  const wallet = await createAccountingWallet(tenantId, { name: "E2E Wallet", purpose: "PHASE2B_E2E", currency: "NGN" }, tenant);
  assert.equal(wallet.balance, 0);
  assert.equal(wallet.reservedBalance, 0);
  const input = { walletAccountId: wallet.id, amount: "100.00", reference: `${prefix}-credit`, reason: "Controlled non-real financial integration value" };
  const first = await creditTestTenantWallet(tenantId, input, platform);
  const replay = await creditTestTenantWallet(tenantId, input, platform);
  assert.equal(first.idempotentReplay, false);
  assert.equal(replay.idempotentReplay, true);
  assert.equal(await prisma.walletTransaction.count({ where: { organizationId: tenantId, type: "TEST_E2E_CREDIT" } }), 1);
  const persisted = await prisma.walletAccount.findUniqueOrThrow({ where: { id: wallet.id } });
  assert.equal(persisted.balance.toString(), "100");
  assert.equal(persisted.reservedBalance.toString(), "0");
  assert.ok(await prisma.auditLog.count({ where: { organizationId: tenantId, action: { in: ["PLATFORM_TENANT_CLASSIFICATION_CHANGED", "PLATFORM_TEST_ENTITLEMENT_GRANTED", "ACCOUNTING_WALLET_CREATED", "PLATFORM_TEST_WALLET_CREDITED"] } } }) >= 4);

  await setTestTenantEntitlement(tenantId, "accounting", { active: false, reason: "Controlled entitlement revocation verification" }, platform);
  assert.equal(await isOrganizationModuleEnabled(tenantId, "accounting"), false);
});

financialTest("ordinary tenant cannot receive test credit", async () => {
  const platform = { id: platformUser.id, organizationId: platformUser.organizationId, email: platformUser.email, roleId: platformUser.roleId, isPlatformAdmin: true, permissions: [] } as any;
  await classifyTestTenant(tenantId, { classification: "CUSTOMER", reason: "Return fixture to ordinary customer classification" }, platform);
  await assert.rejects(() => creditTestTenantWallet(tenantId, { walletAccountId: "cross-tenant", amount: "1.00", reference: `${prefix}-blocked`, reason: "Must reject ordinary customer test credit" }, platform), /TEST_E2E tenant/);
});
