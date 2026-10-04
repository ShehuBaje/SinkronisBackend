import assert from "node:assert/strict";
import test from "node:test";
import { prisma } from "../../core/prisma";
import { processPayRunBatch } from "./payroll.service";

const enabled = process.env.RUN_PAYROLL_P2_PERMANENT_DB_INTEGRATION === "true";
const statutoryRule = { version: "NG-2026-NTA", jurisdiction: "NG", effectiveFrom: "2026-01-01", paye: { bands: [{ threshold: 800000, rate: "0" }, { threshold: 2200000, rate: "0.15" }, { threshold: 9000000, rate: "0.18" }, { threshold: 13000000, rate: "0.21" }, { threshold: 25000000, rate: "0.23" }, { threshold: null, rate: "0.25" }], annualDeductions: ["EMPLOYEE_PENSION", "NHF"], remittanceDueDay: 10 }, pension: { employeeRate: "0.08", employerRate: "0.10", basis: ["BASIC", "HOUSING", "TRANSPORT"] }, nhf: { employeeRate: "0.025", basis: "BASIC" }, nsitf: { employerRate: "0.01", basis: "GROSS" }, source: "BUILT_IN", rowVersion: 0 };

test("a frozen Permanent participant produces one regression-compatible Payslip", { skip: !enabled }, async () => {
  const suffix = `${Date.now()}`;
  const organization = await prisma.organization.create({ data: { name: `P2.2 permanent fixture ${suffix}`, slug: `p22-permanent-${suffix}` } });
  const employee = await prisma.employee.create({ data: { organizationId: organization.id, employeeNo: `P22-${suffix}`, firstName: "Frozen", lastName: "Employee", email: `employee-${suffix}@example.invalid`, status: "ACTIVE", lifecycleStatus: "CONFIRMED", hireDate: new Date("2025-01-01T00:00:00.000Z") } });
  const payee = await prisma.payee.create({ data: { organizationId: organization.id, employeeId: employee.id, type: "PERMANENT", taxRegime: "PAYE" } });
  const run = await prisma.payrollRun.create({ data: { organizationId: organization.id, name: `Permanent integration ${suffix}`, periodStart: new Date("2095-01-01T00:00:00.000Z"), periodEnd: new Date("2095-01-31T23:59:59.999Z"), status: "PROCESSING", membershipVersion: "UNIFIED_PAYEE_V1", participantsFrozenAt: new Date(), participantCount: 1, permanentEmployeeCount: 1, employeeCount: 1, expectedEmployeeCount: 1, calculationInput: { currency: "NGN", test: true } } });
  const participant = await prisma.payrollRunParticipant.create({ data: { organizationId: organization.id, payrollRunId: run.id, payeeId: payee.id, employeeId: employee.id, participantType: "PERMANENT", selectionSource: "AUTO", frozenAt: new Date(), calculationSnapshot: { version: "P2_V1", participantType: "PERMANENT", currency: "NGN", employee: { id: employee.id, employeeNo: employee.employeeNo, name: "Frozen Employee", role: "Engineer", departmentId: null, departmentName: null, bank: {}, taxState: null, taxAuthority: {}, tin: null, pfaName: null, pensionPin: null }, salary: { basic: "100000.00", housing: "20000.00", transport: "10000.00", otherAllowance: "0.00", additionalAllowances: [], prorationResumeDate: null, prorationMethod: null }, deductions: [], loans: [], avc: "0.00", statutoryRule } } });
  const batch = await prisma.payrollCalculationBatch.create({ data: { organizationId: organization.id, payrollRunId: run.id, batchIndex: 0, employeeIds: [], participantIds: [participant.id], expectedCount: 1 } });
  try {
    const attempts = await Promise.all([processPayRunBatch(batch.id), processPayRunBatch(batch.id)]);
    const payslip = await prisma.payslip.findUniqueOrThrow({ where: { payrollRunId_employeeId: { payrollRunId: run.id, employeeId: employee.id } } });
    assert.equal(await prisma.payeePayment.count({ where: { payrollRunId: run.id } }), 0);
    assert.equal(payslip.grossPay.toFixed(2), "130000.00");
    assert.equal(payslip.pension.toFixed(2), "10400.00");
    assert.equal(payslip.employerPension.toFixed(2), "13000.00");
    assert.equal(payslip.nhf.toFixed(2), "2500.00");
    assert.equal(attempts.filter((row) => (row as { processed?: number }).processed === 1).length, 1);
    const completed = await prisma.payrollRun.findUniqueOrThrow({ where: { id: run.id } });
    assert.equal(completed.status, "PENDING_APPROVAL");
    assert.equal(completed.totalPermanentNetPay.toFixed(2), payslip.netPay.toFixed(2));
  } finally {
    await prisma.payrollRun.delete({ where: { id: run.id } });
    await prisma.payee.delete({ where: { id: payee.id } });
    await prisma.employee.delete({ where: { id: employee.id } });
    await prisma.auditLog.deleteMany({ where: { organizationId: organization.id } });
    await prisma.auditLogChain.deleteMany({ where: { organizationId: organization.id } });
    await prisma.organization.delete({ where: { id: organization.id } });
    await prisma.$disconnect();
  }
});
