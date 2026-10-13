import "dotenv/config";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import { Prisma, PrismaClient } from "@prisma/client";
import { decideLegacyLoanVerification, submitLegacyLoanVerification } from "../modules/payroll/payroll.service.js";
import { replayAuditHash } from "../modules/admin/admin.audit.js";
import { assertSafeTestDatabase } from "../test-infrastructure/test-database.js";
import type { AuthUser } from "../types.js";

const enabled = Boolean(process.env.TEST_DATABASE_GUARD);
if (enabled) assertSafeTestDatabase({ databaseUrl: process.env.DATABASE_URL_ORIGINAL, testDatabaseUrl: process.env.DATABASE_URL, nodeEnv: process.env.NODE_ENV, destructive: true });
const it = enabled ? test : test.skip;
const prisma = new PrismaClient();
const uid = (prefix: string) => `${prefix}-${crypto.randomUUID()}`;

const fixture = async (status = "ACTIVE") => {
  const organization = await prisma.organization.create({ data: { name: uid("phase4b"), slug: uid("phase4b"), currency: "NGN" } });
  const role = await prisma.role.create({ data: { organizationId: organization.id, name: uid("role"), isSystem: false } });
  const submitter = await prisma.user.create({ data: { organizationId: organization.id, roleId: role.id, email: `${uid("submitter")}@example.test`, passwordHash: "test", firstName: "Submit", lastName: "User" } });
  const confirmer = await prisma.user.create({ data: { organizationId: organization.id, roleId: role.id, email: `${uid("confirmer")}@example.test`, passwordHash: "test", firstName: "Confirm", lastName: "User" } });
  const employee = await prisma.employee.create({ data: { organizationId: organization.id, employeeNo: uid("EMP"), firstName: "Legacy", lastName: "Employee", email: `${uid("employee")}@example.test`, status: "ACTIVE" } });
  const payee = await prisma.payee.create({ data: { organizationId: organization.id, employeeId: employee.id, type: "PERMANENT", status: "ACTIVE", name: "Legacy Employee" } });
  const document = await prisma.payeeDocument.create({ data: { organizationId: organization.id, payeeId: payee.id, documentName: "Evidence", originalName: "evidence.pdf", fileReference: "private/test/evidence.pdf", mimeType: "application/pdf", size: 10, uploadedById: submitter.id } });
  const loan = await prisma.loanAdvance.create({ data: { organizationId: organization.id, employeeId: employee.id, amount: new Prisma.Decimal(100000), outstanding: new Prisma.Decimal(100000), issuedAt: new Date("2026-01-01"), loanType: "RECURRING", monthlyRepayment: new Prisma.Decimal(10000), status, origin: "LEGACY_UNCONFIRMED", confirmationStatus: "LEGACY_UNCONFIRMED", ...(status === "CLOSED_EARLY" ? { closeReason: "Payroll recovery stopped administratively", closedAt: new Date("2026-06-01") } : {}) } });
  const user = (row: typeof submitter): AuthUser => ({ id: row.id, organizationId: organization.id, roleId: role.id, email: row.email, isPlatformAdmin: false, permissions: [] });
  return { organization, role, submitter, confirmer, employee, payee, document, loan, submitterUser: user(submitter), confirmerUser: user(confirmer) };
};

const input = (documentId: string, overrides: Record<string, unknown> = {}) => ({ assertedOriginalPrincipal: 100000, assertedCutoverOutstanding: 100000, currency: "NGN" as const, externalDisbursementDate: "2025-12-01", proposedRecoveryStartDate: "2026-11-01", repaymentType: "RECURRING" as const, proposedMonthlyRepayment: 10000, evidenceDocumentId: documentId, attestation: true as const, reason: "Verified against signed employer disbursement evidence", idempotencyKey: uid("verify"), ...overrides });

const cleanup = async (organizationId: string) => {
  await prisma.auditLog.deleteMany({ where: { organizationId } });
  await prisma.auditLogChain.deleteMany({ where: { organizationId } });
  await prisma.legacyLoanVerification.deleteMany({ where: { organizationId } });
  await prisma.loanAdvance.deleteMany({ where: { organizationId } });
  await prisma.payeeDocument.deleteMany({ where: { organizationId } });
  await prisma.payee.deleteMany({ where: { organizationId } });
  await prisma.employee.deleteMany({ where: { organizationId } });
  await prisma.user.deleteMany({ where: { organizationId } });
  await prisma.role.deleteMany({ where: { organizationId } });
  await prisma.organization.delete({ where: { id: organizationId } });
};

it("submits idempotently and independently confirms without financial mutation", async () => {
  const fx = await fixture();
  try {
    const request = input(fx.document.id);
    const submitted = await submitLegacyLoanVerification(fx.organization.id, fx.loan.id, request, fx.submitterUser);
    const replay = await submitLegacyLoanVerification(fx.organization.id, fx.loan.id, request, fx.submitterUser);
    assert.equal(submitted.status, "PENDING_VERIFICATION"); assert.equal(replay.id, submitted.id); assert.equal(replay.idempotent, true);
    await assert.rejects(() => decideLegacyLoanVerification(fx.organization.id, fx.loan.id, submitted.id, { decision: "CONFIRM", reason: "Submitter cannot self-confirm evidence" }, fx.submitterUser), (error: any) => error?.details?.errorCode === "LEGACY_LOAN_SEPARATION_OF_DUTIES_REQUIRED");
    const decided = await decideLegacyLoanVerification(fx.organization.id, fx.loan.id, submitted.id, { decision: "CONFIRM", reason: "Independent reviewer matched every asserted fact" }, fx.confirmerUser);
    assert.equal(decided.status, "CONFIRMED"); assert.equal(decided.loan.origin, "EXTERNAL_MANUAL"); assert.equal(decided.loan.confirmationStatus, "CONFIRMED");
    const loan = await prisma.loanAdvance.findUniqueOrThrow({ where: { id: fx.loan.id } });
    assert.equal(loan.amount.toFixed(2), "100000.00"); assert.equal(loan.outstanding.toFixed(2), "100000.00"); assert.equal(loan.status, "ACTIVE");
    assert.equal(await prisma.loanRepayment.count({ where: { organizationId: fx.organization.id } }), 0); assert.equal(await prisma.loanRecoveryApplication.count({ where: { organizationId: fx.organization.id } }), 0); assert.equal(await prisma.financialSettlement.count({ where: { organizationId: fx.organization.id } }), 0); assert.equal(await prisma.walletTransaction.count({ where: { organizationId: fx.organization.id } }), 0);
    const audits = await prisma.auditLog.findMany({ where: { organizationId: fx.organization.id }, orderBy: { sequence: "asc" } });
    assert.equal(audits.length, 2); for (const row of audits) assert.equal(replayAuditHash({ organizationId: row.organizationId, actorUserId: row.actorUserId ?? undefined, action: row.action, resource: row.resource, resourceId: row.resourceId ?? undefined, summary: row.summary, metadata: row.metadata as Prisma.InputJsonValue, sequence: row.sequence!, previousHash: row.previousHash, createdAt: row.createdAt, hashVersion: row.hashVersion }), row.hash);
  } finally { await cleanup(fx.organization.id); }
});

it("routes monetary conflicts to reconciliation and preserves CLOSED_EARLY", async () => {
  const fx = await fixture("CLOSED_EARLY");
  try {
    const submitted = await submitLegacyLoanVerification(fx.organization.id, fx.loan.id, input(fx.document.id, { assertedCutoverOutstanding: 90000 }), fx.submitterUser);
    const decided = await decideLegacyLoanVerification(fx.organization.id, fx.loan.id, submitted.id, { decision: "CONFIRM", reason: "Independent review requested confirmation" }, fx.confirmerUser);
    assert.equal(decided.status, "NEEDS_RECONCILIATION"); assert.equal(decided.confirmed, false);
    const loan = await prisma.loanAdvance.findUniqueOrThrow({ where: { id: fx.loan.id } });
    assert.equal(loan.origin, "LEGACY_UNCONFIRMED"); assert.equal(loan.confirmationStatus, "LEGACY_UNCONFIRMED"); assert.equal(loan.status, "CLOSED_EARLY"); assert.equal(loan.outstanding.toFixed(2), "100000.00");
  } finally { await cleanup(fx.organization.id); }
});

test.after(async () => prisma.$disconnect());
