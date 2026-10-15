import assert from "node:assert/strict";
import test from "node:test";
import jwt from "jsonwebtoken";
import { app } from "../app";
import { env } from "../config/env";
import { prisma } from "../core/prisma";
import { assertSafeTestDatabase } from "../test-infrastructure/test-database";

const enabled = Boolean(process.env.TEST_DATABASE_GUARD);
if (enabled) assertSafeTestDatabase({ databaseUrl: process.env.DATABASE_URL_ORIGINAL, testDatabaseUrl: process.env.DATABASE_URL, nodeEnv: process.env.NODE_ENV, destructive: true });
const it = enabled ? test : test.skip;

it("exposes actor-specific Payroll and Accounting eligibility through the HTTP contract", { timeout: 300_000 }, async () => {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const organization = await prisma.organization.create({ data: { name: `FAS HTTP ${suffix}`, slug: `fas-http-${suffix}` } });
  const originalMode = env.FINANCIAL_APPROVAL_ENFORCEMENT_MODE;
  let server: ReturnType<typeof app.listen> | undefined;
  try {
    const [ownerRole, checkerRole, viewerRole] = await Promise.all([
      prisma.role.create({ data: { organizationId: organization.id, name: "Owner", isSystem: true } }),
      prisma.role.create({ data: { organizationId: organization.id, name: `Checker ${suffix}` } }),
      prisma.role.create({ data: { organizationId: organization.id, name: `Viewer ${suffix}` } }),
    ]);
    const permissionKeys = ["payroll:runs:view", "payroll:runs:approve", "payroll:statutory:update", "accounting:payments:view", "accounting:payments:create", "accounting:payments:approve", "accounting:wallets:update"];
    await prisma.permission.createMany({ data: permissionKeys.map((key) => ({ key, description: `FAS-2.1 isolated fixture ${key}` })), skipDuplicates: true });
    const permissions = await prisma.permission.findMany({ where: { key: { in: permissionKeys } }, select: { id: true, key: true } });
    assert.equal(permissions.length, permissionKeys.length);
    const byKey = new Map(permissions.map((row) => [row.key, row.id]));
    await prisma.rolePermission.createMany({ data: [
      ...permissionKeys.map((key) => ({ roleId: checkerRole.id, permissionId: byKey.get(key)! })),
      ...["payroll:runs:view", "accounting:payments:view"].map((key) => ({ roleId: viewerRole.id, permissionId: byKey.get(key)! })),
    ] });
    const [maker, checker, viewer] = await Promise.all([
      prisma.user.create({ data: { organizationId: organization.id, roleId: ownerRole.id, email: `maker-${suffix}@example.test`, passwordHash: "test", firstName: "Maker", lastName: "Owner" } }),
      prisma.user.create({ data: { organizationId: organization.id, roleId: checkerRole.id, email: `checker-${suffix}@example.test`, passwordHash: "test", firstName: "Independent", lastName: "Checker" } }),
      prisma.user.create({ data: { organizationId: organization.id, roleId: viewerRole.id, email: `viewer-${suffix}@example.test`, passwordHash: "test", firstName: "Read", lastName: "Only" } }),
    ]);
    await prisma.systemConfig.create({ data: { organizationId: organization.id, key: "billing.subscription", value: { status: "ACTIVE", planKey: "all-in-one" } } });
    const sessions = await Promise.all([maker, checker, viewer].map((user) => prisma.userSession.create({ data: { organizationId: organization.id, userId: user.id, refreshTokenHash: `test-${user.id}`, isCurrent: true, expiresAt: new Date(Date.now() + 600_000) } })));
    const token = (index: number) => jwt.sign({ organizationId: organization.id, sessionId: sessions[index].id }, env.JWT_ACCESS_SECRET, { subject: [maker, checker, viewer][index].id, expiresIn: "10m" });
    const [pendingRun, approvedRun, pendingRequest, approvedRequest] = await Promise.all([
      prisma.payrollRun.create({ data: { organizationId: organization.id, createdById: maker.id, name: `Pending ${suffix}`, periodStart: new Date("2098-01-01"), periodEnd: new Date("2098-01-31"), status: "PENDING_APPROVAL", calculationInput: { requestedById: maker.id, currency: "NGN" } } }),
      prisma.payrollRun.create({ data: { organizationId: organization.id, createdById: maker.id, name: `Approved ${suffix}`, periodStart: new Date("2098-02-01"), periodEnd: new Date("2098-02-28"), status: "APPROVED", approvedById: checker.id, approvedAt: new Date(), calculationInput: { requestedById: maker.id, currency: "NGN" } } }),
      prisma.paymentRequest.create({ data: { organizationId: organization.id, title: `Pending ${suffix}`, amount: 100, requesterUserId: maker.id, requestedBy: "Maker Owner", status: "PENDING" } }),
      prisma.paymentRequest.create({ data: { organizationId: organization.id, title: `Approved ${suffix}`, amount: 100, requesterUserId: maker.id, requestedBy: "Maker Owner", status: "APPROVED", approvedBy: checker.id, approvedAt: new Date() } }),
    ]);
    server = app.listen(0);
    await new Promise<void>((resolve) => server!.once("listening", resolve));
    const address = server.address(); assert.ok(address && typeof address === "object");
    const base = `http://127.0.0.1:${address.port}${env.API_PREFIX}`;
    const request = async (path: string, actor: number, init: RequestInit = {}) => {
      const response = await fetch(`${base}${path}`, { ...init, headers: { authorization: `Bearer ${token(actor)}`, "content-type": "application/json", ...init.headers } });
      return { response, body: await response.json() };
    };

    env.FINANCIAL_APPROVAL_ENFORCEMENT_MODE = "MAKER_CHECKER";
    const makerRun = await request(`/payroll/pay-runs/${pendingRun.id}?page=1&limit=20`, 0);
    const checkerRun = await request(`/payroll/pay-runs/${pendingRun.id}?page=1&limit=20`, 1);
    const viewerRun = await request(`/payroll/pay-runs/${pendingRun.id}?page=1&limit=20`, 2);
    for (const result of [makerRun, checkerRun, viewerRun]) assert.equal(result.response.status, 200, JSON.stringify(result.body));
    assert.equal(makerRun.body.data.payRun.canApprove, false); assert.equal(makerRun.body.data.payRun.canReject, false);
    assert.equal(makerRun.body.data.payRun.approvalBlockedReason, "INDEPENDENT_APPROVER_REQUIRED");
    assert.equal(makerRun.body.data.payRun.availableActions.includes("APPROVE"), false);
    assert.equal(checkerRun.body.data.payRun.canApprove, true); assert.equal(checkerRun.body.data.payRun.availableActions.includes("APPROVE"), true);
    assert.equal(viewerRun.body.data.payRun.canApprove, false); assert.equal(viewerRun.body.data.payRun.availableActions.includes("APPROVE"), false);
    const payrollList = await request("/payroll/pay-runs?page=1&limit=20", 1);
    assert.equal(payrollList.response.status, 200); assert.ok(Array.isArray(payrollList.body.data)); assert.ok("canApprove" in payrollList.body.data[0]); assert.ok(payrollList.body.pagination);
    const makerApproved = await request(`/payroll/pay-runs/${approvedRun.id}?page=1&limit=20`, 0);
    const checkerApproved = await request(`/payroll/pay-runs/${approvedRun.id}?page=1&limit=20`, 1);
    assert.equal(makerApproved.body.data.payRun.canInitiatePayment, false); assert.equal(makerApproved.body.data.payRun.availableActions.includes("INITIATE_PAYMENT"), false);
    assert.equal(checkerApproved.body.data.payRun.canInitiatePayment, true); assert.equal(checkerApproved.body.data.payRun.availableActions.includes("INITIATE_PAYMENT"), true);

    const auditBefore = await prisma.auditLog.count({ where: { organizationId: organization.id } });
    const denied = await request(`/payroll/pay-runs/${pendingRun.id}/approve`, 0, { method: "POST", body: "{}" });
    assert.equal(denied.response.status, 409); assert.equal((await prisma.payrollRun.findUniqueOrThrow({ where: { id: pendingRun.id } })).status, "PENDING_APPROVAL");
    assert.equal(await prisma.auditLog.count({ where: { organizationId: organization.id } }), auditBefore);

    const makerAccounting = await request(`/accounting/payment-requests/${pendingRequest.id}`, 0);
    const checkerAccounting = await request(`/accounting/payment-requests/${pendingRequest.id}`, 1);
    const viewerAccounting = await request(`/accounting/payment-requests/${pendingRequest.id}`, 2);
    assert.equal(makerAccounting.body.data.canApprove, false); assert.equal(makerAccounting.body.data.approvalBlockedReason, "INDEPENDENT_APPROVER_REQUIRED");
    assert.equal(checkerAccounting.body.data.canApprove, true); assert.equal(viewerAccounting.body.data.canApprove, false);
    const operatorAccounting = await request(`/accounting/payment-requests/${approvedRequest.id}`, 1);
    assert.equal(operatorAccounting.body.data.canInitiatePayment, true);
    const accountingList = await request("/accounting/payment-requests?page=1&limit=20&status=ALL", 1);
    assert.equal(accountingList.response.status, 200); assert.ok(Array.isArray(accountingList.body.data.requests)); assert.ok("canApprove" in accountingList.body.data.requests[0]); assert.ok(accountingList.body.data.pagination);
    const created = await request("/accounting/payment-requests", 0, { method: "POST", body: JSON.stringify({ title: `Created ${suffix}`, amount: "100.00" }) });
    assert.equal(created.response.status, 201, JSON.stringify(created.body)); assert.equal(created.body.data.canApprove, false); assert.equal(created.body.data.requiresIndependentApprover, true);
    const deniedAccounting = await request(`/accounting/payment-requests/${pendingRequest.id}/approve`, 0, { method: "POST", body: "{}" });
    assert.equal(deniedAccounting.response.status, 409); assert.equal((await prisma.paymentRequest.findUniqueOrThrow({ where: { id: pendingRequest.id } })).status, "PENDING");
    assert.equal(await prisma.financialSettlement.count({ where: { organizationId: organization.id } }), 0);
    assert.equal(await prisma.walletTransaction.count({ where: { organizationId: organization.id } }), 0);

    const approved = await request(`/accounting/payment-requests/${pendingRequest.id}/approve`, 1, { method: "POST", body: "{}" });
    assert.equal(approved.response.status, 200, JSON.stringify(approved.body));
    assert.equal(approved.body.data.status, "APPROVED"); assert.equal(approved.body.data.canInitiatePayment, true);
    for (const field of ["canApprove", "canReject", "canInitiatePayment", "approvalBlockedReason", "requiresIndependentApprover"]) assert.ok(field in approved.body.data);
    const declinedFixture = await prisma.paymentRequest.create({ data: { organizationId: organization.id, title: `Decline ${suffix}`, amount: 100, requesterUserId: maker.id, status: "PENDING" } });
    const declined = await request(`/accounting/payment-requests/${declinedFixture.id}/decline`, 1, { method: "POST", body: JSON.stringify({ reason: "Independent review" }) });
    assert.equal(declined.response.status, 200, JSON.stringify(declined.body)); assert.equal(declined.body.data.status, "DECLINED"); assert.equal(declined.body.data.canApprove, false);

    env.FINANCIAL_APPROVAL_ENFORCEMENT_MODE = "LEGACY";
    const legacyRun = await request(`/payroll/pay-runs/${pendingRun.id}?page=1&limit=20`, 0);
    assert.equal(legacyRun.body.data.payRun.canApprove, true); assert.equal(legacyRun.body.data.payRun.availableActions.includes("APPROVE"), true);
    const legacyAccounting = await request(`/accounting/payment-requests/${declinedFixture.id}`, 0);
    assert.equal(legacyAccounting.body.data.requiresIndependentApprover, false);

    await prisma.systemConfig.update({ where: { organizationId_key: { organizationId: organization.id, key: "billing.subscription" } }, data: { value: { status: "EXPIRED", planKey: "all-in-one" } } });
    assert.equal((await request(`/accounting/payment-requests/${approvedRequest.id}`, 1)).response.status, 403);
  } finally {
    env.FINANCIAL_APPROVAL_ENFORCEMENT_MODE = originalMode;
    if (server) await new Promise<void>((resolve, reject) => server!.close((error) => error ? reject(error) : resolve()));
    await prisma.auditLog.deleteMany({ where: { organizationId: organization.id } });
    await prisma.auditLogChain.deleteMany({ where: { organizationId: organization.id } });
    await prisma.paymentRequest.deleteMany({ where: { organizationId: organization.id } });
    await prisma.payrollRun.deleteMany({ where: { organizationId: organization.id } });
    await prisma.userSession.deleteMany({ where: { organizationId: organization.id } });
    await prisma.rolePermission.deleteMany({ where: { role: { organizationId: organization.id } } });
    await prisma.user.deleteMany({ where: { organizationId: organization.id } });
    await prisma.role.deleteMany({ where: { organizationId: organization.id } });
    await prisma.systemConfig.deleteMany({ where: { organizationId: organization.id } });
    await prisma.organization.delete({ where: { id: organization.id } });
    await prisma.permission.deleteMany({ where: { description: { startsWith: "FAS-2.1 isolated fixture" }, rolePermissions: { none: {} } } });
    await prisma.$disconnect();
  }
});
