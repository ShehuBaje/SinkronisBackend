import "dotenv/config";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import { Prisma, PrismaClient } from "@prisma/client";
import { AUDIT_HASH_VERSION_V2, buildAuditHash, createAuditLog, replayAuditHash } from "../modules/admin/admin.audit.js";
import { assertSafeTestDatabase } from "../test-infrastructure/test-database.js";

const enabled = Boolean(process.env.TEST_DATABASE_GUARD);
if (enabled) assertSafeTestDatabase({ databaseUrl: process.env.DATABASE_URL_ORIGINAL, testDatabaseUrl: process.env.DATABASE_URL, nodeEnv: process.env.NODE_ENV, destructive: true });
const it = enabled ? test : test.skip;
const prisma = new PrismaClient();
const uid = (prefix: string) => `${prefix}-${crypto.randomUUID()}`;
const money = (value: number) => new Prisma.Decimal(value);

const fixture = async () => {
  const organization = await prisma.organization.create({ data: { name: uid("legacy-verification"), slug: uid("legacy-verification"), currency: "NGN" } });
  const other = await prisma.organization.create({ data: { name: uid("other"), slug: uid("other"), currency: "NGN" } });
  const role = await prisma.role.create({ data: { organizationId: organization.id, name: "Verifier", isSystem: false } });
  const otherRole = await prisma.role.create({ data: { organizationId: other.id, name: "Other", isSystem: false } });
  const submitter = await prisma.user.create({ data: { organizationId: organization.id, roleId: role.id, email: `${uid("submitter")}@example.test`, passwordHash: "test", firstName: "Submit", lastName: "User" } });
  const confirmer = await prisma.user.create({ data: { organizationId: organization.id, roleId: role.id, email: `${uid("confirmer")}@example.test`, passwordHash: "test", firstName: "Confirm", lastName: "User" } });
  const otherUser = await prisma.user.create({ data: { organizationId: other.id, roleId: otherRole.id, email: `${uid("other")}@example.test`, passwordHash: "test", firstName: "Other", lastName: "User" } });
  const employee = await prisma.employee.create({ data: { organizationId: organization.id, employeeNo: uid("EMP"), firstName: "Legacy", lastName: "Employee", email: `${uid("employee")}@example.test`, status: "ACTIVE" } });
  const payee = await prisma.payee.create({ data: { organizationId: organization.id, employeeId: employee.id, type: "PERMANENT", status: "ACTIVE", name: "Legacy Employee" } });
  const document = await prisma.payeeDocument.create({ data: { organizationId: organization.id, payeeId: payee.id, documentName: "Evidence", originalName: "evidence.pdf", fileReference: "private/test/evidence.pdf", mimeType: "application/pdf", size: 10, uploadedById: submitter.id } });
  const loan = await prisma.loanAdvance.create({ data: { organizationId: organization.id, employeeId: employee.id, amount: money(100000), outstanding: money(100000), issuedAt: new Date("2026-01-01"), loanType: "RECURRING", monthlyRepayment: money(10000), status: "ACTIVE", origin: "LEGACY_UNCONFIRMED", confirmationStatus: "LEGACY_UNCONFIRMED" } });
  return { organization, other, submitter, confirmer, otherUser, employee, document, loan };
};

const verificationData = (fx: Awaited<ReturnType<typeof fixture>>, overrides: Record<string, unknown> = {}) => ({
  organizationId: fx.organization.id, loanAdvanceId: fx.loan.id, attemptNumber: 1, status: "PENDING_VERIFICATION" as const,
  recordedPrincipalSnapshot: money(100000), recordedOutstandingSnapshot: money(100000), assertedOriginalPrincipal: money(100000), assertedCutoverOutstanding: money(100000),
  currency: "NGN", externalDisbursementDate: new Date("2025-12-01"), proposedRecoveryStartDate: new Date("2026-11-01"), repaymentType: "RECURRING", proposedMonthlyRepayment: money(10000),
  evidenceDocumentId: fx.document.id, evidenceFingerprint: "a".repeat(64), attestationVersion: "LEGACY_EXTERNAL_V1", attestationAccepted: true,
  reason: "Controlled legacy verification fixture", submittedById: fx.submitter.id, idempotencyKey: uid("idempotency"), pendingVerificationKey: `${fx.organization.id}:${fx.loan.id}`, ...overrides
});

const cleanup = async (ids: string[]) => {
  await prisma.auditLog.deleteMany({ where: { organizationId: { in: ids } } });
  await prisma.auditLogChain.deleteMany({ where: { organizationId: { in: ids } } });
  await prisma.legacyLoanVerification.deleteMany({ where: { organizationId: { in: ids } } });
  await prisma.loanAdvance.deleteMany({ where: { organizationId: { in: ids } } });
  await prisma.payeeDocument.deleteMany({ where: { organizationId: { in: ids } } });
  await prisma.payee.deleteMany({ where: { organizationId: { in: ids } } });
  await prisma.employee.deleteMany({ where: { organizationId: { in: ids } } });
  await prisma.user.deleteMany({ where: { organizationId: { in: ids } } });
  await prisma.role.deleteMany({ where: { organizationId: { in: ids } } });
  await prisma.organization.deleteMany({ where: { id: { in: ids } } });
};

it("tenant-safe verification constraints, uniqueness, no grants and financial non-mutation", async () => {
  const fx = await fixture(); const ids = [fx.organization.id, fx.other.id];
  try {
    const before = await prisma.loanAdvance.findUniqueOrThrow({ where: { id: fx.loan.id }, select: { amount: true, outstanding: true, origin: true, confirmationStatus: true } });
    const row = await prisma.legacyLoanVerification.create({ data: verificationData(fx) });
    assert.equal(row.status, "PENDING_VERIFICATION");
    await assert.rejects(() => prisma.legacyLoanVerification.create({ data: verificationData(fx, { idempotencyKey: uid("other"), attemptNumber: 2 }) }), (error: any) => error?.code === "P2002");
    await assert.rejects(() => prisma.legacyLoanVerification.create({ data: verificationData(fx, { organizationId: fx.other.id, submittedById: fx.otherUser.id, evidenceDocumentId: null, pendingVerificationKey: null, attemptNumber: 2, idempotencyKey: uid("cross") }) }), (error: any) => error?.code === "P2003");
    const confirmed = await prisma.legacyLoanVerification.create({ data: verificationData(fx, { attemptNumber: 2, status: "CONFIRMED", idempotencyKey: uid("confirmed"), pendingVerificationKey: null, confirmedVerificationKey: `${fx.organization.id}:${fx.loan.id}`, confirmedById: fx.confirmer.id, confirmedAt: new Date(), decisionAt: new Date() }) });
    assert.equal(confirmed.status, "CONFIRMED");
    await assert.rejects(() => prisma.legacyLoanVerification.create({ data: verificationData(fx, { attemptNumber: 3, status: "CONFIRMED", idempotencyKey: uid("confirmed-duplicate"), pendingVerificationKey: null, confirmedVerificationKey: `${fx.organization.id}:${fx.loan.id}`, confirmedById: fx.confirmer.id }) }), (error: any) => error?.code === "P2002");
    const after = await prisma.loanAdvance.findUniqueOrThrow({ where: { id: fx.loan.id }, select: { amount: true, outstanding: true, origin: true, confirmationStatus: true } });
    assert.deepEqual(after, before);
    assert.equal(await prisma.loanRepayment.count({ where: { organizationId: fx.organization.id } }), 0);
    assert.equal(await prisma.loanRecoveryApplication.count({ where: { organizationId: fx.organization.id } }), 0);
    assert.equal(await prisma.financialSettlement.count({ where: { organizationId: fx.organization.id } }), 0);
    assert.equal(await prisma.walletTransaction.count({ where: { organizationId: fx.organization.id } }), 0);
    const permission = await prisma.permission.findUniqueOrThrow({ where: { key: "payroll:loans:confirm-legacy" } });
    assert.equal(await prisma.rolePermission.count({ where: { permissionId: permission.id } }), 0);
  } finally { await cleanup(ids); }
});

it("V1 to V2 audit continuity, concurrent append and rollback remain safe", async () => {
  const fx = await fixture(); const ids = [fx.organization.id, fx.other.id];
  try {
    const createdAt = new Date("2026-10-09T00:00:00.000Z"); const metadata = { legacy: true };
    const hash = buildAuditHash({ organizationId: fx.organization.id, actorUserId: fx.submitter.id, action: "LEGACY", resource: "LOAN_ADVANCE", resourceId: fx.loan.id, summary: "Legacy audit", metadata, sequence: 1, previousHash: null, createdAt });
    await prisma.auditLog.create({ data: { organizationId: fx.organization.id, actorUserId: fx.submitter.id, action: "LEGACY", resource: "LOAN_ADVANCE", resourceId: fx.loan.id, summary: "Legacy audit", metadata, sequence: 1, previousHash: null, hash, hashVersion: null, createdAt } });
    await prisma.auditLogChain.create({ data: { organizationId: fx.organization.id, sequence: 1, lastHash: hash } });
    await Promise.all([1, 2].map(index => createAuditLog({ organizationId: fx.organization.id, actorUserId: fx.submitter.id, action: `V2_${index}`, resource: "LOAN_ADVANCE", resourceId: fx.loan.id, summary: "Versioned audit", metadata: { occurredAt: new Date(`2026-10-09T00:00:0${index}.000Z`), nested: { index } } as never })));
    const rows = await prisma.auditLog.findMany({ where: { organizationId: fx.organization.id }, orderBy: { sequence: "asc" } });
    assert.equal(rows.length, 3); assert.equal(rows[1].previousHash, hash); assert.equal(rows[1].hashVersion, AUDIT_HASH_VERSION_V2); assert.equal(rows[2].previousHash, rows[1].hash);
    for (const row of rows.slice(1)) assert.equal(replayAuditHash({ organizationId: row.organizationId, actorUserId: row.actorUserId ?? undefined, action: row.action, resource: row.resource, resourceId: row.resourceId ?? undefined, summary: row.summary, metadata: row.metadata as Prisma.InputJsonValue, sequence: row.sequence!, previousHash: row.previousHash, createdAt: row.createdAt, hashVersion: row.hashVersion }), row.hash);
    await assert.rejects(() => prisma.$transaction(async tx => { await createAuditLog({ organizationId: fx.organization.id, actorUserId: fx.submitter.id, action: "ROLLBACK", resource: "LOAN_ADVANCE", resourceId: fx.loan.id, summary: "Must roll back" }, tx); throw new Error("rollback"); }));
    assert.equal(await prisma.auditLog.count({ where: { organizationId: fx.organization.id } }), 3);
  } finally { await cleanup(ids); }
});

test.after(async () => prisma.$disconnect());
