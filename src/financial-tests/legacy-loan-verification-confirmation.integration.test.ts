import "dotenv/config";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import { Prisma, PrismaClient } from "@prisma/client";
import { decideLegacyLoanVerification, getPayrollLoan, submitLegacyLoanVerification } from "../modules/payroll/payroll.service.js";
import { replayAuditHash } from "../modules/admin/admin.audit.js";
import { assertSafeTestDatabase } from "../test-infrastructure/test-database.js";
import type { AuthUser } from "../types.js";

const enabled = Boolean(process.env.TEST_DATABASE_GUARD);
if (enabled) assertSafeTestDatabase({ databaseUrl: process.env.DATABASE_URL_ORIGINAL, testDatabaseUrl: process.env.DATABASE_URL, nodeEnv: process.env.NODE_ENV, destructive: true });
const it = enabled ? test : test.skip;
const prisma = new PrismaClient();
const uid = (prefix: string) => `${prefix}-${crypto.randomUUID()}`;

const fixture = async (status = "ACTIVE", employeeStatus = "ACTIVE") => {
  const organization = await prisma.organization.create({ data: { name: uid("phase4b"), slug: uid("phase4b"), currency: "NGN" } });
  const role = await prisma.role.create({ data: { organizationId: organization.id, name: uid("role"), isSystem: false } });
  const submitter = await prisma.user.create({ data: { organizationId: organization.id, roleId: role.id, email: `${uid("submitter")}@example.test`, passwordHash: "test", firstName: "Submit", lastName: "User" } });
  const confirmer = await prisma.user.create({ data: { organizationId: organization.id, roleId: role.id, email: `${uid("confirmer")}@example.test`, passwordHash: "test", firstName: "Confirm", lastName: "User" } });
  const employee = await prisma.employee.create({ data: { organizationId: organization.id, employeeNo: uid("EMP"), firstName: "Legacy", lastName: "Employee", email: `${uid("employee")}@example.test`, status: employeeStatus as any } });
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

it("routes CLOSED_EARLY financial-resolution language to reconciliation without changing debt", async () => {
  for (const closeReason of ["Early settlement by employee", "Loan settled externally", "Paid in full", "Loan repaid", "Balance written off"]) {
    const fx = await fixture("CLOSED_EARLY");
    try {
      await prisma.loanAdvance.update({ where: { id: fx.loan.id }, data: { closeReason } });
      const submitted = await submitLegacyLoanVerification(fx.organization.id, fx.loan.id, input(fx.document.id), fx.submitterUser);
      const decided = await decideLegacyLoanVerification(fx.organization.id, fx.loan.id, submitted.id, { decision: "CONFIRM", reason: "Independent reviewer evaluated historical evidence" }, fx.confirmerUser);
      assert.equal(decided.status, "NEEDS_RECONCILIATION");
      const loan = await prisma.loanAdvance.findUniqueOrThrow({ where: { id: fx.loan.id } });
      assert.equal(loan.origin, "LEGACY_UNCONFIRMED");
      assert.equal(loan.confirmationStatus, "LEGACY_UNCONFIRMED");
      assert.equal(loan.status, "CLOSED_EARLY");
      assert.equal(loan.outstanding.toFixed(2), "100000.00");
    } finally { await cleanup(fx.organization.id); }
  }
});

it("confirms supported historical facts for a suspended employee without enabling recovery", async () => {
  const fx = await fixture("ACTIVE", "SUSPENDED");
  try {
    const submitted = await submitLegacyLoanVerification(fx.organization.id, fx.loan.id, input(fx.document.id), fx.submitterUser);
    const decided = await decideLegacyLoanVerification(fx.organization.id, fx.loan.id, submitted.id, { decision: "CONFIRM", reason: "Independent historical debt verification" }, fx.confirmerUser);
    assert.equal(decided.status, "CONFIRMED");
    const projected: any = await getPayrollLoan(fx.organization.id, fx.loan.id);
    assert.equal(projected.recoveryEligible, false);
    assert.ok(projected.recoveryIneligibilityReasons.includes("EMPLOYEE_PAYROLL_INELIGIBLE"));
    assert.equal((await prisma.employee.findUniqueOrThrow({ where: { id: fx.employee.id } })).status, "SUSPENDED");
  } finally { await cleanup(fx.organization.id); }
});

it("rejects cross-tenant and wrong-Payee evidence without creating an attempt", async () => {
  const fx = await fixture();
  const other = await fixture();
  try {
    await assert.rejects(() => submitLegacyLoanVerification(other.organization.id, fx.loan.id, input(other.document.id), other.submitterUser));
    await assert.rejects(() => submitLegacyLoanVerification(fx.organization.id, fx.loan.id, input(other.document.id), fx.submitterUser));
    const otherEmployee = await prisma.employee.create({ data: { organizationId: fx.organization.id, employeeNo: uid("OTHER"), firstName: "Other", lastName: "Employee", email: `${uid("other")}@example.test`, status: "ACTIVE" } });
    const otherPayee = await prisma.payee.create({ data: { organizationId: fx.organization.id, employeeId: otherEmployee.id, type: "PERMANENT", status: "ACTIVE", name: "Other Employee" } });
    const wrongDocument = await prisma.payeeDocument.create({ data: { organizationId: fx.organization.id, payeeId: otherPayee.id, documentName: "Wrong evidence", originalName: "wrong.pdf", fileReference: "private/test/wrong.pdf", mimeType: "application/pdf", size: 10, uploadedById: fx.submitter.id } });
    await assert.rejects(() => submitLegacyLoanVerification(fx.organization.id, fx.loan.id, input(wrongDocument.id), fx.submitterUser));
    assert.equal(await prisma.legacyLoanVerification.count({ where: { organizationId: fx.organization.id } }), 0);
  } finally { await cleanup(fx.organization.id); await cleanup(other.organization.id); }
});

it("serializes concurrent submissions and decisions and enforces idempotency fingerprints", async () => {
  const fx = await fixture();
  try {
    const request = input(fx.document.id);
    const submissions = await Promise.all([
      submitLegacyLoanVerification(fx.organization.id, fx.loan.id, request, fx.submitterUser),
      submitLegacyLoanVerification(fx.organization.id, fx.loan.id, request, fx.submitterUser)
    ]);
    assert.equal(submissions[0].id, submissions[1].id);
    assert.equal(await prisma.legacyLoanVerification.count({ where: { organizationId: fx.organization.id } }), 1);
    await assert.rejects(() => submitLegacyLoanVerification(fx.organization.id, fx.loan.id, { ...request, assertedCutoverOutstanding: 90000 }, fx.submitterUser), (error: any) => error?.details?.errorCode === "LEGACY_LOAN_IDEMPOTENCY_CONFLICT");
    const decisions = await Promise.all([
      decideLegacyLoanVerification(fx.organization.id, fx.loan.id, submissions[0].id, { decision: "CONFIRM", reason: "Independent concurrent reviewer exact match" }, fx.confirmerUser),
      decideLegacyLoanVerification(fx.organization.id, fx.loan.id, submissions[0].id, { decision: "CONFIRM", reason: "Independent concurrent reviewer exact match" }, fx.confirmerUser)
    ]);
    assert.equal(decisions[0].status, "CONFIRMED"); assert.equal(decisions[1].status, "CONFIRMED");
    assert.equal(await prisma.legacyLoanVerification.count({ where: { organizationId: fx.organization.id, status: "CONFIRMED" } }), 1);
  } finally { await cleanup(fx.organization.id); }
});

it("rolls back submission and confirmation when required audit persistence fails", async () => {
  const fx = await fixture();
  const failAudit = async () => { throw new Error("injected audit persistence failure"); };
  try {
    const request = input(fx.document.id);
    await assert.rejects(() => submitLegacyLoanVerification(fx.organization.id, fx.loan.id, request, fx.submitterUser, { appendAudit: failAudit as any }));
    assert.equal(await prisma.legacyLoanVerification.count({ where: { organizationId: fx.organization.id } }), 0);
    const submitted = await submitLegacyLoanVerification(fx.organization.id, fx.loan.id, request, fx.submitterUser);
    await assert.rejects(() => decideLegacyLoanVerification(fx.organization.id, fx.loan.id, submitted.id, { decision: "CONFIRM", reason: "Independent exact-match confirmation" }, fx.confirmerUser, { appendAudit: failAudit as any }));
    const [verification, loan] = await Promise.all([prisma.legacyLoanVerification.findUniqueOrThrow({ where: { id: submitted.id } }), prisma.loanAdvance.findUniqueOrThrow({ where: { id: fx.loan.id } })]);
    assert.equal(verification.status, "PENDING_VERIFICATION");
    assert.equal(loan.origin, "LEGACY_UNCONFIRMED"); assert.equal(loan.confirmationStatus, "LEGACY_UNCONFIRMED");
    assert.equal(loan.amount.toFixed(2), "100000.00"); assert.equal(loan.outstanding.toFixed(2), "100000.00");
    assert.equal(await prisma.auditLog.count({ where: { organizationId: fx.organization.id, action: "LEGACY_LOAN_VERIFICATION_CONFIRMED" } }), 0);
  } finally { await cleanup(fx.organization.id); }
});

test.after(async () => prisma.$disconnect());
