import assert from "node:assert/strict";
import test from "node:test";
import { prisma } from "../../core/prisma";
import type { AuthUser } from "../../types";
import { createPayrollLoan, recordExternalPayrollLoan } from "./payroll.service";

const enabled = process.env.RUN_PAYROLL_LOAN_RECORDING_DB_INTEGRATION === "true";

test("canonical and compatibility routes record externally disbursed loans without financial side effects", { skip: !enabled }, async () => {
  const suffix = `${Date.now()}`;
  const organization = await prisma.organization.create({ data: { name: `Loan recording fixture ${suffix}`, slug: `loan-recording-${suffix}` } });
  const otherOrganization = await prisma.organization.create({ data: { name: `Other loan fixture ${suffix}`, slug: `other-loan-${suffix}` } });
  const role = await prisma.role.create({ data: { organizationId: organization.id, name: `Loan recorder ${suffix}` } });
  const dbUser = await prisma.user.create({ data: { organizationId: organization.id, roleId: role.id, email: `loan-recorder-${suffix}@example.invalid`, passwordHash: "not-used", firstName: "Loan", lastName: "Recorder" } });
  const user: AuthUser = { id: dbUser.id, organizationId: organization.id, roleId: role.id, email: dbUser.email, isPlatformAdmin: false, permissions: ["payroll:loans:create"] };
  const employee = await prisma.employee.create({ data: { organizationId: organization.id, employeeNo: `LR-${suffix}`, firstName: "External", lastName: "Borrower", email: `borrower-${suffix}@example.invalid`, status: "ACTIVE", lifecycleStatus: "CONFIRMED", hireDate: new Date("2025-01-01T00:00:00.000Z") } });
  const payee = await prisma.payee.create({ data: { organizationId: organization.id, employeeId: employee.id, type: "PERMANENT", status: "ACTIVE", taxRegime: "PAYE" } });
  await prisma.payrollEnrollment.create({ data: { organizationId: organization.id, employeeId: employee.id, enrolledById: dbUser.id } });
  const otherEmployee = await prisma.employee.create({ data: { organizationId: otherOrganization.id, employeeNo: `OTHER-${suffix}`, firstName: "Other", lastName: "Tenant", email: `other-${suffix}@example.invalid`, status: "ACTIVE", lifecycleStatus: "CONFIRMED" } });
  const before = { repayments: await prisma.loanRepayment.count(), settlements: await prisma.financialSettlement.count(), wallets: await prisma.walletAccount.aggregate({ _count: { _all: true }, _sum: { balance: true, reservedBalance: true } }), ledger: await prisma.walletTransaction.count() };
  try {
    const recurring = await recordExternalPayrollLoan(organization.id, { employeeId: employee.id, purpose: "Externally paid education advance", originalPrincipal: 1_000_000, openingOutstanding: 750_000, externalDisbursementDate: "2026-01-15", recoveryStartDate: "2026-02-01", repaymentType: "RECURRING", monthlyRepayment: 100_000, currency: "NGN", attestation: true, externalReference: `EXT-${suffix}` }, user);
    assert.equal(recurring.originalPrincipal, 1_000_000);
    assert.equal(recurring.openingOutstanding, 750_000);
    assert.equal(recurring.outstandingAmount, 750_000);
    assert.equal(recurring.repaidAmount, 0, "pre-Sinkronis reduction is not reported as a Sinkronis repayment");
    assert.equal(recurring.preSinkronisReduction, 250_000);
    assert.equal(recurring.origin, "EXTERNAL_MANUAL");
    assert.equal(recurring.confirmationStatus, "CONFIRMED");
    assert.equal(recurring.currency, "NGN");
    const stored = await prisma.loanAdvance.findUniqueOrThrow({ where: { id: recurring.id } });
    assert.equal(stored.amount.toFixed(2), "1000000.00");
    assert.equal(stored.openingOutstanding?.toFixed(2), "750000.00");
    assert.equal(stored.outstanding.toFixed(2), "750000.00");
    assert.equal(stored.recordedById, dbUser.id);
    assert.equal(stored.attestedById, dbUser.id);
    assert.ok(stored.recordedAt);
    assert.ok(stored.attestedAt);

    const oneOff = await createPayrollLoan(organization.id, employee.id, { purpose: "Externally paid one-off advance", type: "ONE_OFF", principal: 200_000, openingOutstanding: 125_000, externalDisbursementDate: "2026-03-01", startDate: "2026-04-01", currency: "NGN", attestation: true, externalReference: `ONE-${suffix}` }, user);
    assert.equal(oneOff.repaymentType, "ONE_OFF");
    assert.equal(oneOff.monthlyRepayment, null);
    assert.equal(oneOff.outstandingAmount, 125_000);

    await assert.rejects(recordExternalPayrollLoan(organization.id, { employeeId: otherEmployee.id, purpose: "Cross tenant", originalPrincipal: 1000, openingOutstanding: 1000, externalDisbursementDate: "2026-01-01", recoveryStartDate: "2026-02-01", repaymentType: "ONE_OFF", currency: "NGN", attestation: true }, user), /Eligible Permanent payroll employee not found/);
    await assert.rejects(recordExternalPayrollLoan(organization.id, { employeeId: employee.id, purpose: "Duplicate reference", originalPrincipal: 1000, openingOutstanding: 1000, externalDisbursementDate: "2026-01-01", recoveryStartDate: "2026-02-01", repaymentType: "ONE_OFF", currency: "NGN", attestation: true, externalReference: `EXT-${suffix}` }, user), /External loan reference already exists/);
    assert.equal(await prisma.loanRepayment.count(), before.repayments);
    assert.equal(await prisma.financialSettlement.count(), before.settlements);
    assert.equal(await prisma.walletTransaction.count(), before.ledger);
    const wallets = await prisma.walletAccount.aggregate({ _count: { _all: true }, _sum: { balance: true, reservedBalance: true } });
    assert.deepEqual(wallets, before.wallets);
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { organizationId: organization.id, resource: "LOAN_ADVANCE", resourceId: recurring.id } });
    assert.equal(audit.action, "PAYROLL_LOAN_CREATED");
    assert.equal((audit.metadata as any).origin, "EXTERNAL_MANUAL");
    assert.equal((audit.metadata as any).openingOutstanding, "750000.00");
  } finally {
    await prisma.loanAdvance.deleteMany({ where: { organizationId: organization.id } });
    await prisma.payee.delete({ where: { id: payee.id } });
    await prisma.employee.delete({ where: { id: employee.id } });
    await prisma.employee.delete({ where: { id: otherEmployee.id } });
    await prisma.auditLog.deleteMany({ where: { organizationId: organization.id } });
    await prisma.auditLogChain.deleteMany({ where: { organizationId: organization.id } });
    await prisma.user.delete({ where: { id: dbUser.id } });
    await prisma.role.delete({ where: { id: role.id } });
    await prisma.organization.delete({ where: { id: organization.id } });
    await prisma.organization.delete({ where: { id: otherOrganization.id } });
    await prisma.$disconnect();
  }
});
