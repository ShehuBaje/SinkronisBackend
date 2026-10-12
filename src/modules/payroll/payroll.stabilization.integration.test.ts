import assert from "node:assert/strict";
import test from "node:test";
import { prisma } from "../../core/prisma";
import type { AuthUser } from "../../types";
import { createCustomDeduction, createPayrollDeductionType, getPayRunDetail, processDraftPayRun, resumeStalePayRunProcessing } from "./payroll.service";

const enabled = process.env.RUN_PAYROLL_STABILIZATION_DB_INTEGRATION === "true";
const old = () => new Date(Date.now() - 10 * 60_000);

const baseFixture = async (label: string) => {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const organization = await prisma.organization.create({ data: { name: `${label} ${suffix}`, slug: `${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${suffix}` } });
  const role = await prisma.role.create({ data: { organizationId: organization.id, name: `Payroll ${suffix}` } });
  const dbUser = await prisma.user.create({ data: { organizationId: organization.id, roleId: role.id, email: `${suffix}@example.invalid`, passwordHash: "not-used", firstName: "Payroll", lastName: "Fixture" } });
  const user: AuthUser = { id: dbUser.id, organizationId: organization.id, roleId: role.id, email: dbUser.email, isPlatformAdmin: false, permissions: ["payroll:runs:update", "payroll:salary:update"] };
  const cleanup = async () => {
    await prisma.payrollAdjustmentApplication.deleteMany({ where: { organizationId: organization.id } });
    await prisma.loanRecoveryApplication.deleteMany({ where: { organizationId: organization.id } });
    await prisma.payslip.deleteMany({ where: { organizationId: organization.id } });
    await prisma.payeePayment.deleteMany({ where: { organizationId: organization.id } });
    await prisma.payrollCalculationBatch.deleteMany({ where: { organizationId: organization.id } });
    await prisma.payrollRunParticipant.deleteMany({ where: { organizationId: organization.id } });
    await prisma.payrollRun.deleteMany({ where: { organizationId: organization.id } });
    await prisma.employeeDeduction.deleteMany({ where: { organizationId: organization.id } });
    await prisma.salaryStructure.deleteMany({ where: { organizationId: organization.id } });
    await prisma.payrollEnrollment.deleteMany({ where: { organizationId: organization.id } });
    await prisma.payee.deleteMany({ where: { organizationId: organization.id } });
    await prisma.employee.deleteMany({ where: { organizationId: organization.id } });
    await prisma.systemConfig.deleteMany({ where: { organizationId: organization.id } });
    await prisma.auditLog.deleteMany({ where: { organizationId: organization.id } });
    await prisma.auditLogChain.deleteMany({ where: { organizationId: organization.id } });
    await prisma.user.delete({ where: { id: dbUser.id } });
    await prisma.role.delete({ where: { id: role.id } });
    await prisma.organization.delete({ where: { id: organization.id } });
  };
  return { organization, dbUser, user, cleanup };
};

test("inline processing commits freeze first and completes a Permanent participant without a statutory profile", { skip: !enabled }, async () => {
  assert.equal(process.env.BACKGROUND_JOBS_MODE, "inline");
  const fixture = await baseFixture("Inline payroll");
  const employee = await prisma.employee.create({ data: { organizationId: fixture.organization.id, employeeNo: `EMP-${Date.now()}`, firstName: "Inline", lastName: "Employee", email: `employee-${Date.now()}@example.invalid`, status: "ACTIVE", lifecycleStatus: "CONFIRMED", hireDate: new Date("2025-01-01T00:00:00.000Z") } });
  const payee = await prisma.payee.create({ data: { organizationId: fixture.organization.id, employeeId: employee.id, type: "PERMANENT", status: "ACTIVE", taxRegime: "PAYE" } });
  await prisma.payrollEnrollment.create({ data: { organizationId: fixture.organization.id, employeeId: employee.id, isActive: true, enrolledById: fixture.dbUser.id } });
  await prisma.salaryStructure.create({ data: { organizationId: fixture.organization.id, employeeId: employee.id, title: "Monthly", basic: 100000, effectiveFrom: new Date("2098-01-01T00:00:00.000Z") } });
  const run = await prisma.payrollRun.create({ data: { organizationId: fixture.organization.id, name: "Inline run", periodStart: new Date("2098-01-01T00:00:00.000Z"), periodEnd: new Date("2098-01-31T23:59:59.999Z"), status: "DRAFT", membershipVersion: "UNIFIED_PAYEE_V1", calculationInput: { currency: "NGN", requestedById: fixture.dbUser.id } } });
  await prisma.payrollRunParticipant.create({ data: { organizationId: fixture.organization.id, payrollRunId: run.id, payeeId: payee.id, employeeId: employee.id, participantType: "PERMANENT", selectionSource: "MANUAL", selectedById: fixture.dbUser.id } });
  try {
    const result = await processDraftPayRun(fixture.organization.id, run.id, fixture.user);
    assert.equal(result.execution, "direct");
    assert.equal(result.status, "PENDING_APPROVAL");
    assert.equal(await prisma.payslip.count({ where: { payrollRunId: run.id } }), 1);
    assert.equal(await prisma.payrollStatutoryProfile.count({ where: { employeeId: employee.id } }), 0);
    assert.equal(await prisma.payrollCalculationBatch.count({ where: { payrollRunId: run.id } }), 1);
  } finally { await fixture.cleanup(); }
});

test("stale recovery is tenant-safe, concurrency-safe, and pending detail is truthful", { skip: !enabled }, async () => {
  assert.equal(process.env.BACKGROUND_JOBS_MODE, "inline");
  const fixture = await baseFixture("Resume payroll");
  const other = await baseFixture("Other tenant");
  const payee = await prisma.payee.create({ data: { organizationId: fixture.organization.id, name: "Recovery Contractor", type: "CONTRACT", status: "ACTIVE", taxRegime: "WHT", externalOnPayroll: true, monthlyAmount: 100000 } });
  const run = await prisma.payrollRun.create({ data: { organizationId: fixture.organization.id, name: "Stranded run", periodStart: new Date("2098-02-01T00:00:00.000Z"), periodEnd: new Date("2098-02-28T23:59:59.999Z"), status: "PROCESSING", membershipVersion: "UNIFIED_PAYEE_V1", participantsFrozenAt: old(), participantCount: 1, externalPayeeCount: 1, processingHeartbeatAt: old(), calculationInput: { currency: "NGN", requestedById: fixture.dbUser.id } } });
  const participant = await prisma.payrollRunParticipant.create({ data: { organizationId: fixture.organization.id, payrollRunId: run.id, payeeId: payee.id, participantType: "CONTRACT", selectionSource: "MANUAL", selectedById: fixture.dbUser.id, frozenAt: old(), calculationSnapshot: { version: "P2_V3", participantType: "CONTRACT", currency: "NGN", name: "Recovery Contractor", monthlyAmount: "100000.00", taxRegime: "WHT", bonuses: [], bonusTotal: "0.00", group: null } } });
  try {
    const detail = await getPayRunDetail(fixture.organization.id, run.id, { page: 1, limit: 20 }, fixture.user);
    assert.equal(detail.items[0].participantId, participant.id);
    assert.equal(detail.items[0].resultType, null);
    assert.equal(detail.items[0].resultStatus, "PENDING");
    assert.equal(detail.items[0].netPay, null);
    assert.equal(await prisma.payeePayment.count({ where: { payrollRunId: run.id } }), 0);
    const terminal = await prisma.payrollRun.create({ data: { organizationId: fixture.organization.id, name: "Broken terminal run", periodStart: run.periodStart, periodEnd: run.periodEnd, status: "PENDING_APPROVAL", membershipVersion: "UNIFIED_PAYEE_V1", participantsFrozenAt: old(), participantCount: 1, externalPayeeCount: 1, calculationInput: { currency: "NGN" } } });
    await prisma.payrollRunParticipant.create({ data: { organizationId: fixture.organization.id, payrollRunId: terminal.id, payeeId: payee.id, participantType: "CONTRACT", selectionSource: "MANUAL", selectedById: fixture.dbUser.id, frozenAt: old(), calculationSnapshot: { version: "P2_V3", participantType: "CONTRACT", currency: "NGN", name: "Recovery Contractor", monthlyAmount: "100000.00", taxRegime: "WHT", bonuses: [], bonusTotal: "0.00" } } });
    await assert.rejects(getPayRunDetail(fixture.organization.id, terminal.id, { page: 1, limit: 20 }, fixture.user), /External payroll participant result is missing/);
    await assert.rejects(resumeStalePayRunProcessing(other.organization.id, run.id, other.user), /Payroll run not found/);
    await prisma.payrollRun.update({ where: { id: run.id }, data: { processingHeartbeatAt: new Date() } });
    await assert.rejects(resumeStalePayRunProcessing(fixture.organization.id, run.id, fixture.user), (error: any) => error?.details?.errorCode === "PAYROLL_PROCESSING_ACTIVE");
    await prisma.payrollRun.update({ where: { id: run.id }, data: { processingHeartbeatAt: old() } });
    const concurrent = await Promise.allSettled([resumeStalePayRunProcessing(fixture.organization.id, run.id, fixture.user), resumeStalePayRunProcessing(fixture.organization.id, run.id, fixture.user)]);
    assert.equal(concurrent.filter((result) => result.status === "fulfilled").length, 1);
    assert.equal(concurrent.filter((result) => result.status === "rejected" && (result.reason as any)?.details?.errorCode === "PAYROLL_PROCESSING_RESUME_CONFLICT").length, 1);
    assert.equal(await prisma.payeePayment.count({ where: { payrollRunId: run.id } }), 1);
    assert.equal(await prisma.payrollCalculationBatch.count({ where: { payrollRunId: run.id } }), 1);
    assert.equal(await prisma.financialSettlement.count({ where: { organizationId: fixture.organization.id } }), 0);
    assert.equal(await prisma.walletTransaction.count({ where: { organizationId: fixture.organization.id } }), 0);

    const failed = await prisma.payrollRun.create({ data: { organizationId: fixture.organization.id, name: "Interrupted direct run", periodStart: run.periodStart, periodEnd: run.periodEnd, status: "PROCESSING", membershipVersion: "UNIFIED_PAYEE_V1", participantsFrozenAt: old(), participantCount: 1, externalPayeeCount: 1, processingHeartbeatAt: old(), calculationInput: { currency: "NGN", requestedById: fixture.dbUser.id } } });
    await prisma.payrollRunParticipant.create({ data: { organizationId: fixture.organization.id, payrollRunId: failed.id, payeeId: payee.id, participantType: "CONTRACT", selectionSource: "MANUAL", selectedById: fixture.dbUser.id, frozenAt: old(), calculationSnapshot: { version: "P2_V3", participantType: "CONTRACT", currency: "NGN", name: "Invalid Contractor", monthlyAmount: "100000.00", taxRegime: "EXEMPT", bonuses: [], bonusTotal: "0.00" } } });
    await assert.rejects(resumeStalePayRunProcessing(fixture.organization.id, failed.id, fixture.user), (error: any) => error?.statusCode === 503 && error?.details?.errorCode === "PAYROLL_DIRECT_PROCESSING_INTERRUPTED");
    const interrupted = await prisma.payrollRun.findUniqueOrThrow({ where: { id: failed.id }, include: { calculationBatches: true } });
    assert.equal(interrupted.status, "PROCESSING");
    assert.match(interrupted.failureReason ?? "", /remains resumable/);
    assert.equal(interrupted.calculationBatches[0]?.status, "PENDING");
    assert.match(interrupted.calculationBatches[0]?.errorMessage ?? "", /invalid type or tax regime/);
  } finally { await fixture.cleanup(); await other.cleanup(); }
});

test("custom deduction convenience contract persists recurring and one-off through the existing model", { skip: !enabled }, async () => {
  const fixture = await baseFixture("Deduction contract");
  const employee = await prisma.employee.create({ data: { organizationId: fixture.organization.id, employeeNo: `DED-${Date.now()}`, firstName: "Deduction", lastName: "Employee", email: `deduction-${Date.now()}@example.invalid`, status: "ACTIVE", lifecycleStatus: "CONFIRMED", hireDate: new Date("2025-01-01T00:00:00.000Z") } });
  await prisma.payee.create({ data: { organizationId: fixture.organization.id, employeeId: employee.id, type: "PERMANENT", status: "ACTIVE", taxRegime: "PAYE" } });
  await prisma.payrollEnrollment.create({ data: { organizationId: fixture.organization.id, employeeId: employee.id, isActive: true, enrolledById: fixture.dbUser.id } });
  try {
    const type = await createPayrollDeductionType(fixture.organization.id, { name: "Union stabilization" }, fixture.user);
    const recurring = await createCustomDeduction(fixture.organization.id, { employeeId: employee.id, deductionTypeId: type.id, amount: 1000, type: "RECURRING", currency: "NGN" }, fixture.user);
    const oneOff = await createCustomDeduction(fixture.organization.id, { employeeId: employee.id, deductionTypeId: type.id, amount: 2500, type: "ONE_OFF", currency: "NGN", effectiveFrom: "2098-03-01" }, fixture.user);
    assert.equal(recurring.frequency, "MONTHLY");
    assert.equal(oneOff.frequency, "ONE_OFF");
    assert.equal(oneOff.effectiveFrom.toISOString().slice(0, 10), "2098-03-01");
    assert.equal(await prisma.payrollAdjustmentApplication.count({ where: { organizationId: fixture.organization.id } }), 0);
    assert.equal(await prisma.walletTransaction.count({ where: { organizationId: fixture.organization.id } }), 0);
    assert.equal(await prisma.financialSettlement.count({ where: { organizationId: fixture.organization.id } }), 0);
  } finally { await fixture.cleanup(); }
});
