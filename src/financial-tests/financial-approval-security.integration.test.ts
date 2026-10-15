import "dotenv/config";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import { PrismaClient } from "@prisma/client";
import { env } from "../config/env.js";
import { approvePayRun, rejectPayRunForRework } from "../modules/payroll/payroll.service.js";
import { approvePaymentRequest, createPaymentRequest, declinePaymentRequest, disbursePaymentRequest, getPaymentRequest } from "../modules/accounting/accounting.service.js";
import { assertSafeTestDatabase } from "../test-infrastructure/test-database.js";
import type { AuthUser } from "../types.js";

const enabled = Boolean(process.env.TEST_DATABASE_GUARD);
if (enabled) assertSafeTestDatabase({ databaseUrl: process.env.DATABASE_URL_ORIGINAL, testDatabaseUrl: process.env.DATABASE_URL, nodeEnv: process.env.NODE_ENV, destructive: true });
const it = enabled ? test : test.skip;
const prisma = new PrismaClient();
const uid = (prefix: string) => `${prefix}-${crypto.randomUUID()}`;

const fixture = async () => {
  const organization = await prisma.organization.create({ data: { name: uid("fas2"), slug: uid("fas2"), currency: "NGN" } });
  const role = await prisma.role.create({ data: { organizationId: organization.id, name: uid("finance") } });
  const maker = await prisma.user.create({ data: { organizationId: organization.id, roleId: role.id, email: `${uid("maker")}@example.test`, passwordHash: "test", firstName: "Maker", lastName: "User" } });
  const checker = await prisma.user.create({ data: { organizationId: organization.id, roleId: role.id, email: `${uid("checker")}@example.test`, passwordHash: "test", firstName: "Checker", lastName: "User" } });
  const permissions = ["payroll:runs:approve", "payroll:statutory:update", "accounting:payments:approve", "accounting:wallets:update"] as AuthUser["permissions"];
  const actor = (row: typeof maker): AuthUser => ({ id: row.id, organizationId: organization.id, roleId: role.id, email: row.email, isPlatformAdmin: false, permissions });
  return { organization, role, maker, checker, makerUser: actor(maker), checkerUser: actor(checker) };
};

const cleanup = async (organizationId: string) => {
  await prisma.financialSettlement.deleteMany({ where: { organizationId } });
  await prisma.walletTransaction.deleteMany({ where: { organizationId } });
  await prisma.walletAccount.deleteMany({ where: { organizationId } });
  await prisma.paymentRequest.deleteMany({ where: { organizationId } });
  await prisma.payrollAdjustmentApplication.deleteMany({ where: { organizationId } });
  await prisma.loanRecoveryApplication.deleteMany({ where: { organizationId } });
  await prisma.payslip.deleteMany({ where: { organizationId } });
  await prisma.payrollRun.deleteMany({ where: { organizationId } });
  await prisma.auditLog.deleteMany({ where: { organizationId } });
  await prisma.auditLogChain.deleteMany({ where: { organizationId } });
  await prisma.user.deleteMany({ where: { organizationId } });
  await prisma.role.deleteMany({ where: { organizationId } });
  await prisma.organization.delete({ where: { id: organizationId } });
};

const pendingRun = (fx: Awaited<ReturnType<typeof fixture>>, creator: string | null = fx.maker.id) => prisma.payrollRun.create({ data: { organizationId: fx.organization.id, createdById: creator, name: uid("payroll"), periodStart: new Date("2099-01-01"), periodEnd: new Date("2099-01-31"), status: "PENDING_APPROVAL", membershipVersion: "UNIFIED_PAYEE_V1", calculationInput: creator ? { requestedById: creator } : {} } });
const pendingRequest = (fx: Awaited<ReturnType<typeof fixture>>) => prisma.paymentRequest.create({ data: { organizationId: fx.organization.id, title: uid("request"), amount: 100, requesterUserId: fx.maker.id, requestedBy: "Maker User", bankName: "Test Bank", bankCode: "001", accountNumber: "0123456789", accountName: "Maker User" } });

it("enforces independent Payroll decisions and fails closed without creator identity", async () => {
  const fx = await fixture();
  try {
    const self = await pendingRun(fx);
    await assert.rejects(() => approvePayRun(fx.organization.id, self.id, fx.makerUser), (error: any) => error?.details?.errorCode === "FINANCIAL_SELF_APPROVAL_NOT_ALLOWED");
    await assert.rejects(() => rejectPayRunForRework(fx.organization.id, self.id, "Self decision", fx.makerUser), (error: any) => error?.details?.errorCode === "FINANCIAL_SELF_APPROVAL_NOT_ALLOWED");
    assert.equal((await prisma.payrollRun.findUniqueOrThrow({ where: { id: self.id } })).status, "PENDING_APPROVAL");
    const approved = await approvePayRun(fx.organization.id, self.id, fx.checkerUser);
    assert.equal(approved.status, "APPROVED");
    assert.equal(approved.canInitiatePayment, true);

    const unknown = await pendingRun(fx, null);
    await assert.rejects(() => approvePayRun(fx.organization.id, unknown.id, fx.checkerUser), (error: any) => error?.details?.errorCode === "FINANCIAL_ACTOR_CONFIGURATION_CONFLICT");
  } finally { await cleanup(fx.organization.id); }
});

it("serializes concurrent Payroll approval and rejection", async () => {
  const fx = await fixture();
  try {
    const run = await pendingRun(fx);
    const outcomes = await Promise.allSettled([approvePayRun(fx.organization.id, run.id, fx.checkerUser), rejectPayRunForRework(fx.organization.id, run.id, "Independent rejection", fx.checkerUser)]);
    assert.equal(outcomes.filter((result) => result.status === "fulfilled").length, 1);
    assert.ok(["APPROVED", "REJECTED_FOR_REWORK"].includes((await prisma.payrollRun.findUniqueOrThrow({ where: { id: run.id } })).status));
  } finally { await cleanup(fx.organization.id); }
});

it("enforces Accounting maker/checker and rolls decisions back when audit persistence fails", async () => {
  const fx = await fixture();
  try {
    const self = await pendingRequest(fx);
    await assert.rejects(() => approvePaymentRequest(fx.organization.id, self.id, {}, fx.makerUser), (error: any) => error?.details?.errorCode === "FINANCIAL_SELF_APPROVAL_NOT_ALLOWED");
    await assert.rejects(() => declinePaymentRequest(fx.organization.id, self.id, { reason: "Self decline" }, fx.makerUser), (error: any) => error?.details?.errorCode === "FINANCIAL_SELF_APPROVAL_NOT_ALLOWED");
    assert.equal((await prisma.paymentRequest.findUniqueOrThrow({ where: { id: self.id } })).status, "PENDING");

    const rollback = await pendingRequest(fx);
    const missingActor = { ...fx.checkerUser, id: uid("missing") };
    await assert.rejects(() => approvePaymentRequest(fx.organization.id, rollback.id, {}, missingActor));
    assert.equal((await prisma.paymentRequest.findUniqueOrThrow({ where: { id: rollback.id } })).status, "PENDING");

    const approved = await approvePaymentRequest(fx.organization.id, self.id, {}, fx.checkerUser);
    assert.equal(approved.status, "APPROVED");
    const projection = await getPaymentRequest(fx.organization.id, self.id, fx.checkerUser);
    assert.equal(projection.canInitiatePayment, true);
    await assert.rejects(() => disbursePaymentRequest(fx.organization.id, self.id, { walletAccountId: "missing", idempotencyKey: uid("payment"), settlementMethod: "MANUAL", externalReference: uid("external"), settledAt: new Date(), note: "Evidence" }, fx.makerUser), (error: any) => error?.details?.errorCode === "FINANCIAL_EXECUTION_NOT_AUTHORIZED");
    assert.equal(await prisma.financialSettlement.count({ where: { organizationId: fx.organization.id } }), 0);

    const wallet = await prisma.walletAccount.create({ data: { organizationId: fx.organization.id, name: "FAS Wallet", purpose: "PRIMARY", currency: "NGN", balance: 1000 } });
    const paid = await disbursePaymentRequest(fx.organization.id, self.id, { walletAccountId: wallet.id, idempotencyKey: uid("payment"), settlementMethod: "MANUAL", externalReference: uid("external"), settledAt: new Date(), note: "Independent checker payment evidence" }, fx.checkerUser);
    assert.equal(paid.request.status, "PAID");
    assert.equal((await prisma.walletAccount.findUniqueOrThrow({ where: { id: wallet.id } })).balance.toFixed(2), "900.00");
  } finally { await cleanup(fx.organization.id); }
});

it("creates Accounting requests and required V2 audit evidence atomically", async () => {
  const fx = await fixture();
  try {
    const created = await createPaymentRequest(fx.organization.id, { title: "Audited request", amount: 250 } as any, fx.makerUser);
    const audit = await prisma.auditLog.findFirst({ where: { organizationId: fx.organization.id, resourceId: created.id, action: "ACCOUNTING_PAYMENT_REQUEST_CREATED" } });
    assert.ok(audit);
    assert.equal(audit.hashVersion, "V2");
  } finally { await cleanup(fx.organization.id); }
});

it("preserves legacy authorization behavior while enforcement is disabled", async () => {
  const fx = await fixture();
  const original = env.FINANCIAL_APPROVAL_ENFORCEMENT_MODE;
  try {
    (env as any).FINANCIAL_APPROVAL_ENFORCEMENT_MODE = "LEGACY";
    const run = await pendingRun(fx);
    assert.equal((await approvePayRun(fx.organization.id, run.id, fx.makerUser)).status, "APPROVED");
    const request = await pendingRequest(fx);
    assert.equal((await approvePaymentRequest(fx.organization.id, request.id, {}, fx.makerUser)).status, "APPROVED");
  } finally { (env as any).FINANCIAL_APPROVAL_ENFORCEMENT_MODE = original; await cleanup(fx.organization.id); }
});

test.before(() => { (env as any).FINANCIAL_APPROVAL_ENFORCEMENT_MODE = "MAKER_CHECKER"; });
test.after(async () => { await prisma.$disconnect(); });
