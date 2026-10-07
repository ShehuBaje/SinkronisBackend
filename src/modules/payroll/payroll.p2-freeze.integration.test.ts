import assert from "node:assert/strict";
import test from "node:test";
import { Prisma } from "@prisma/client";
import { prisma } from "../../core/prisma";
import type { AuthUser } from "../../types";
import { addPayRunParticipants, cancelDraftPayRun, createReplacementDraft, initializePayRunCalculation, processDraftPayRun, rejectPayRunForRework, removePayRunParticipant } from "./payroll.service";

const enabled = process.env.RUN_PAYROLL_P2_FREEZE_DB_INTEGRATION === "true";

test("process atomically freezes, revalidates and makes membership immutable", { skip: !enabled }, async () => {
  const suffix = `${Date.now()}`;
  const organization = await prisma.organization.create({ data: { name: `P2.2 freeze fixture ${suffix}`, slug: `p22-freeze-${suffix}` } });
  const role = await prisma.role.create({ data: { organizationId: organization.id, name: `Payroll fixture ${suffix}` } });
  const dbUser = await prisma.user.create({ data: { organizationId: organization.id, roleId: role.id, email: `p22-${suffix}@example.invalid`, passwordHash: "not-used", firstName: "P2", lastName: "Fixture" } });
  const user: AuthUser = { id: dbUser.id, organizationId: organization.id, roleId: role.id, email: dbUser.email, isPlatformAdmin: false, permissions: ["payroll:runs:update"] };
  const group = await prisma.payrollPayeeGroup.create({ data: { organizationId: organization.id, name: "Original Contract Group" } });
  const payee = await prisma.payee.create({ data: { organizationId: organization.id, payrollGroupId: group.id, name: "Frozen contract fixture", type: "CONTRACT", status: "ACTIVE", taxRegime: "WHT", externalOnPayroll: true, monthlyAmount: 100000 } });
  const bonus = await prisma.payrollBonus.create({ data: { organizationId: organization.id, payeeId: payee.id, amount: 10000, frequency: "ONCE", justification: "Frozen approved bonus", effectiveFrom: new Date("2096-01-01T00:00:00.000Z") } });
  const run = await prisma.payrollRun.create({ data: { organizationId: organization.id, name: `Freeze integration ${suffix}`, periodStart: new Date("2096-01-01T00:00:00.000Z"), periodEnd: new Date("2096-01-31T23:59:59.999Z"), status: "DRAFT", membershipVersion: "UNIFIED_PAYEE_V1", calculationInput: { currency: "NGN", requestedById: dbUser.id } } });
  await prisma.payrollRunParticipant.create({ data: { organizationId: organization.id, payrollRunId: run.id, payeeId: payee.id, participantType: "CONTRACT", selectionSource: "MANUAL", selectedById: dbUser.id } });
  try {
    const claims = await Promise.allSettled([processDraftPayRun(organization.id, run.id, user), processDraftPayRun(organization.id, run.id, user)]);
    assert.equal(claims.filter((result) => result.status === "fulfilled").length, 1);
    assert.equal(claims.filter((result) => result.status === "rejected").length, 1);
    const frozen = await prisma.payrollRun.findUniqueOrThrow({ where: { id: run.id }, include: { participants: true } });
    assert.equal(frozen.status, "PROCESSING");
    assert.ok(frozen.participantsFrozenAt);
    assert.ok(frozen.participants[0].frozenAt);
    assert.ok(frozen.participants[0].calculationSnapshot);
    assert.equal(await prisma.payrollAdjustmentApplication.count({ where: { bonusId: bonus.id, payrollRunId: run.id } }), 1);
    await assert.rejects(addPayRunParticipants(organization.id, run.id, [payee.id], user));
    await assert.rejects(removePayRunParticipant(organization.id, run.id, payee.id, user));
    await assert.rejects(cancelDraftPayRun(organization.id, run.id, user));
    await prisma.payee.update({ where: { id: payee.id }, data: { monthlyAmount: 900000, externalOnPayroll: false } });
    await prisma.payrollPayeeGroup.update({ where: { id: group.id }, data: { name: "Renamed After Freeze" } });
    await prisma.payrollBonus.update({ where: { id: bonus.id }, data: { amount: 80000 } });
    await initializePayRunCalculation(run.id, { execution: "direct" });
    const result = await prisma.payeePayment.findUniqueOrThrow({ where: { payrollRunId_payeeId: { payrollRunId: run.id, payeeId: payee.id } } });
    assert.equal(result.grossAmount.toFixed(2), "110000.00");
    assert.equal(result.whtAmount.toFixed(2), "5500.00");
    assert.equal(result.netAmount.toFixed(2), "104500.00");
    const compensation = result.compensationSnapshot as any;
    assert.equal(compensation.group.name, "Original Contract Group");
    assert.equal(compensation.bonusTotal, "10000.00");
    assert.equal((await prisma.payrollAdjustmentApplication.findFirstOrThrow({ where: { bonusId: bonus.id, payrollRunId: run.id } })).status, "APPLIED");
    assert.equal((await prisma.payrollRun.findUniqueOrThrow({ where: { id: run.id } })).status, "PENDING_APPROVAL");
    assert.equal(await prisma.payrollCalculationBatch.count({ where: { payrollRunId: run.id } }), 1);
  } finally {
    await prisma.payrollAdjustmentApplication.deleteMany({ where: { payrollRunId: run.id } });
    await prisma.payrollRun.delete({ where: { id: run.id } });
    await prisma.payrollBonus.delete({ where: { id: bonus.id } });
    await prisma.payee.delete({ where: { id: payee.id } });
    await prisma.payrollPayeeGroup.delete({ where: { id: group.id } });
    await prisma.auditLog.deleteMany({ where: { organizationId: organization.id } });
    await prisma.auditLogChain.deleteMany({ where: { organizationId: organization.id } });
    await prisma.user.delete({ where: { id: dbUser.id } });
    await prisma.role.delete({ where: { id: role.id } });
    await prisma.organization.delete({ where: { id: organization.id } });
    await prisma.$disconnect();
  }
});

test("excess one-off deductions fail before freeze and remain retryable after correction", { skip: !enabled }, async () => {
  const suffix = `${Date.now()}-deductions`;
  const organization = await prisma.organization.create({ data: { name: `Deduction invariant fixture ${suffix}`, slug: `deduction-invariant-${suffix}` } });
  const role = await prisma.role.create({ data: { organizationId: organization.id, name: `Payroll invariant ${suffix}` } });
  const dbUser = await prisma.user.create({ data: { organizationId: organization.id, roleId: role.id, email: `deduction-${suffix}@example.invalid`, passwordHash: "not-used", firstName: "Deduction", lastName: "Fixture" } });
  const user: AuthUser = { id: dbUser.id, organizationId: organization.id, roleId: role.id, email: dbUser.email, isPlatformAdmin: false, permissions: ["payroll:runs:update"] };
  const employee = await prisma.employee.create({ data: { organizationId: organization.id, employeeNo: `DED-${suffix}`, firstName: "Deduction", lastName: "Employee", email: `employee-${suffix}@example.invalid`, status: "ACTIVE", lifecycleStatus: "CONFIRMED", hireDate: new Date("2025-01-01T00:00:00.000Z") } });
  const payee = await prisma.payee.create({ data: { organizationId: organization.id, employeeId: employee.id, type: "PERMANENT", taxRegime: "PAYE" } });
  await prisma.payrollEnrollment.create({ data: { organizationId: organization.id, employeeId: employee.id, isActive: true, enrolledById: dbUser.id } });
  await prisma.salaryStructure.create({ data: { organizationId: organization.id, employeeId: employee.id, title: "Invariant salary", basic: 100, effectiveFrom: new Date("2096-02-01T00:00:00.000Z") } });
  const deduction = await prisma.employeeDeduction.create({ data: { organizationId: organization.id, employeeId: employee.id, name: "One-off invariant", amount: 101, frequency: "ONE_OFF", effectiveFrom: new Date("2096-02-01T00:00:00.000Z") } });
  const run = await prisma.payrollRun.create({ data: { organizationId: organization.id, name: `Deduction invariant ${suffix}`, periodStart: new Date("2096-02-01T00:00:00.000Z"), periodEnd: new Date("2096-02-29T23:59:59.999Z"), status: "DRAFT", membershipVersion: "UNIFIED_PAYEE_V1", calculationInput: { currency: "NGN", requestedById: dbUser.id } } });
  await prisma.payrollRunParticipant.create({ data: { organizationId: organization.id, payrollRunId: run.id, payeeId: payee.id, employeeId: employee.id, participantType: "PERMANENT", selectionSource: "MANUAL", selectedById: dbUser.id } });
  try {
    await assert.rejects(processDraftPayRun(organization.id, run.id, user), (error: any) => error?.details?.errorCode === "PAYROLL_DEDUCTIONS_EXCEED_GROSS");
    const failed = await prisma.payrollRun.findUniqueOrThrow({ where: { id: run.id }, include: { participants: true } });
    assert.equal(failed.status, "DRAFT");
    assert.equal(failed.participants[0].frozenAt, null);
    assert.equal(await prisma.payrollAdjustmentApplication.count({ where: { payrollRunId: run.id } }), 0);
    assert.equal(await prisma.payslip.count({ where: { payrollRunId: run.id } }), 0);

    await prisma.employeeDeduction.update({ where: { id: deduction.id }, data: { amount: 10 } });
    const retried = await processDraftPayRun(organization.id, run.id, user);
    assert.equal(retried.status, "PROCESSING");
    assert.equal((await prisma.payrollAdjustmentApplication.findFirstOrThrow({ where: { payrollRunId: run.id, employeeDeductionId: deduction.id } })).status, "FROZEN");
  } finally {
    await prisma.payrollAdjustmentApplication.deleteMany({ where: { payrollRunId: run.id } });
    await prisma.payrollRun.delete({ where: { id: run.id } });
    await prisma.employeeDeduction.delete({ where: { id: deduction.id } });
    await prisma.salaryStructure.deleteMany({ where: { employeeId: employee.id } });
    await prisma.payrollEnrollment.delete({ where: { employeeId: employee.id } });
    await prisma.payee.delete({ where: { id: payee.id } });
    await prisma.employee.delete({ where: { id: employee.id } });
    await prisma.auditLog.deleteMany({ where: { organizationId: organization.id } });
    await prisma.auditLogChain.deleteMany({ where: { organizationId: organization.id } });
    await prisma.user.delete({ where: { id: dbUser.id } });
    await prisma.role.delete({ where: { id: role.id } });
    await prisma.organization.delete({ where: { id: organization.id } });
    await prisma.$disconnect();
  }
});

test("confirmed external loans freeze as distinct immutable applications and rework supersedes them", { skip: !enabled }, async () => {
  const suffix = `${Date.now()}-loan-recovery`;
  const organization = await prisma.organization.create({ data: { name: `Loan recovery fixture ${suffix}`, slug: `loan-recovery-${suffix}` } });
  const role = await prisma.role.create({ data: { organizationId: organization.id, name: `Loan recovery ${suffix}` } });
  const dbUser = await prisma.user.create({ data: { organizationId: organization.id, roleId: role.id, email: `loan-recovery-${suffix}@example.invalid`, passwordHash: "not-used", firstName: "Loan", lastName: "Fixture" } });
  const user: AuthUser = { id: dbUser.id, organizationId: organization.id, roleId: role.id, email: dbUser.email, isPlatformAdmin: false, permissions: ["payroll:runs:update", "payroll:runs:approve"] };
  const employee = await prisma.employee.create({ data: { organizationId: organization.id, employeeNo: `LOAN-${suffix}`, firstName: "Loan", lastName: "Employee", email: `loan-employee-${suffix}@example.invalid`, status: "ACTIVE", lifecycleStatus: "CONFIRMED", hireDate: new Date("2025-01-01T00:00:00.000Z") } });
  const payee = await prisma.payee.create({ data: { organizationId: organization.id, employeeId: employee.id, type: "PERMANENT", taxRegime: "PAYE" } });
  await prisma.payrollEnrollment.create({ data: { organizationId: organization.id, employeeId: employee.id, isActive: true, enrolledById: dbUser.id } });
  await prisma.salaryStructure.create({ data: { organizationId: organization.id, employeeId: employee.id, title: "Recovery salary", basic: 1000000, effectiveFrom: new Date("2096-03-01T00:00:00.000Z") } });
  const recurring = await prisma.loanAdvance.create({ data: { organizationId: organization.id, employeeId: employee.id, amount: 300000, openingOutstanding: 300000, outstanding: 300000, currency: "NGN", reason: "Confirmed external fixture", issuedAt: new Date("2096-01-01T00:00:00.000Z"), externalDisbursementDate: new Date("2096-01-01T00:00:00.000Z"), recoveryStartDate: new Date("2096-03-01T00:00:00.000Z"), loanType: "RECURRING", monthlyRepayment: 30000, status: "ACTIVE", origin: "EXTERNAL_MANUAL", confirmationStatus: "CONFIRMED", recordedById: dbUser.id, recordedAt: new Date(), attestedById: dbUser.id, attestedAt: new Date() } });
  const oneOff = await prisma.loanAdvance.create({ data: { organizationId: organization.id, employeeId: employee.id, amount: 20000, openingOutstanding: 20000, outstanding: 20000, currency: "NGN", reason: "One-off external fixture", issuedAt: new Date("2096-01-01T00:00:00.000Z"), externalDisbursementDate: new Date("2096-01-01T00:00:00.000Z"), recoveryStartDate: new Date("2096-03-01T00:00:00.000Z"), loanType: "ONE_OFF", status: "ACTIVE", origin: "EXTERNAL_MANUAL", confirmationStatus: "CONFIRMED", recordedById: dbUser.id, recordedAt: new Date(), attestedById: dbUser.id, attestedAt: new Date() } });
  await prisma.loanAdvance.create({ data: { organizationId: organization.id, employeeId: employee.id, amount: 90000, outstanding: 90000, issuedAt: new Date("2096-01-01T00:00:00.000Z"), loanType: "RECURRING", monthlyRepayment: 10000, status: "ACTIVE", origin: "LEGACY_UNCONFIRMED", confirmationStatus: "LEGACY_UNCONFIRMED" } });
  const run = await prisma.payrollRun.create({ data: { organizationId: organization.id, name: `Loan recovery ${suffix}`, periodStart: new Date("2096-03-01T00:00:00.000Z"), periodEnd: new Date("2096-03-31T23:59:59.999Z"), status: "DRAFT", membershipVersion: "UNIFIED_PAYEE_V1", calculationInput: { currency: "NGN", requestedById: dbUser.id } } });
  await prisma.payrollRunParticipant.create({ data: { organizationId: organization.id, payrollRunId: run.id, payeeId: payee.id, employeeId: employee.id, participantType: "PERMANENT", selectionSource: "MANUAL", selectedById: dbUser.id } });
  try {
    await processDraftPayRun(organization.id, run.id, user);
    await initializePayRunCalculation(run.id, { execution: "direct" });
    const applications = await prisma.loanRecoveryApplication.findMany({ where: { payrollRunId: run.id }, orderBy: { loanAdvanceId: "asc" } });
    const payslip = await prisma.payslip.findFirstOrThrow({ where: { payrollRunId: run.id, employeeId: employee.id } });
    assert.equal(applications.length, 2);
    assert.deepEqual(applications.map((item) => item.loanAdvanceId), [recurring.id, oneOff.id].sort());
    assert.equal(applications.reduce((sum, item) => sum.add(item.appliedAmount), new Prisma.Decimal(0)).toFixed(2), payslip.loanDeduction.toFixed(2));
    assert.equal(payslip.loanDeduction.toFixed(2), "50000.00");
    assert.equal((applications.find((item) => item.loanAdvanceId === recurring.id)?.frozenSnapshot as any).outstandingBefore, "300000.00");
    assert.equal(await prisma.loanRepayment.count({ where: { organizationId: organization.id } }), 0);
    assert.equal((await prisma.loanAdvance.findUniqueOrThrow({ where: { id: recurring.id } })).outstanding.toFixed(2), "300000.00");

    await prisma.loanAdvance.update({ where: { id: recurring.id }, data: { monthlyRepayment: 40000 } });
    assert.equal((applications.find((item) => item.loanAdvanceId === recurring.id)?.frozenSnapshot as any).configuredMonthlyRepayment, "30000.00");
    await rejectPayRunForRework(organization.id, run.id, "Recalculate current loan terms", user);
    assert.equal(await prisma.loanRecoveryApplication.count({ where: { payrollRunId: run.id, state: "SUPERSEDED" } }), 2);
    const replacement = await createReplacementDraft(organization.id, run.id, user);
    await processDraftPayRun(organization.id, replacement.id, user);
    await initializePayRunCalculation(replacement.id, { execution: "direct" });
    const replacementApplications = await prisma.loanRecoveryApplication.findMany({ where: { payrollRunId: replacement.id } });
    assert.equal(replacementApplications.length, 2);
    assert.equal(replacementApplications.find((item) => item.loanAdvanceId === recurring.id)?.appliedAmount.toFixed(2), "40000.00");
    assert.equal(await prisma.loanRepayment.count({ where: { organizationId: organization.id } }), 0);
    assert.equal((await prisma.loanAdvance.findUniqueOrThrow({ where: { id: recurring.id } })).outstanding.toFixed(2), "300000.00");
  } finally {
    await prisma.loanRecoveryApplication.deleteMany({ where: { organizationId: organization.id } });
    await prisma.payrollRun.deleteMany({ where: { organizationId: organization.id } });
    await prisma.loanAdvance.deleteMany({ where: { employeeId: employee.id } });
    await prisma.salaryStructure.deleteMany({ where: { employeeId: employee.id } });
    await prisma.payrollEnrollment.delete({ where: { employeeId: employee.id } });
    await prisma.payee.delete({ where: { id: payee.id } });
    await prisma.employee.delete({ where: { id: employee.id } });
    await prisma.auditLog.deleteMany({ where: { organizationId: organization.id } });
    await prisma.auditLogChain.deleteMany({ where: { organizationId: organization.id } });
    await prisma.user.delete({ where: { id: dbUser.id } });
    await prisma.role.delete({ where: { id: role.id } });
    await prisma.organization.delete({ where: { id: organization.id } });
    await prisma.$disconnect();
  }
});
