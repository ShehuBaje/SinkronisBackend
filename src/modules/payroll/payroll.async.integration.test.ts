import assert from "node:assert/strict";
import test from "node:test";
import { prisma } from "../../core/prisma";
import { processPayRunBatch } from "./payroll.service";

const enabled = process.env.RUN_PAYROLL_ASYNC_DB_INTEGRATION === "true";

test("payroll batch delivery is idempotent and finalizes only once", { skip: !enabled }, async () => {
  const suffix = `${Date.now()}`;
  const organization = await prisma.organization.create({ data: { name: `Legacy NSITF fixture ${suffix}`, slug: `legacy-nsitf-${suffix}` } });
  const employee = await prisma.employee.create({ data: { organizationId: organization.id, employeeNo: `LEG-${suffix}`, firstName: "Legacy", lastName: "Employee", email: `legacy-${suffix}@example.invalid`, status: "ACTIVE", lifecycleStatus: "CONFIRMED", hireDate: new Date("2025-01-01T00:00:00.000Z") } });
  await prisma.salaryStructure.create({ data: { organizationId: organization.id, employeeId: employee.id, title: "Legacy NSITF fixture", basic: 100000, effectiveFrom: new Date("2098-01-01T00:00:00.000Z") } });
  const periodStart = new Date("2098-01-01T00:00:00.000Z"); const periodEnd = new Date("2098-01-31T23:59:59.999Z");
  const run = await prisma.payrollRun.create({ data: { organizationId: organization.id, name: `Async test ${suffix}`, periodStart, periodEnd, status: "PROCESSING", employeeCount: 1, expectedEmployeeCount: 1, calculationInput: { test: true } } });
  const batch = await prisma.payrollCalculationBatch.create({ data: { organizationId: organization.id, payrollRunId: run.id, batchIndex: 0, employeeIds: [employee.id], expectedCount: 1 } });
  try {
    const results = await Promise.all([processPayRunBatch(batch.id), processPayRunBatch(batch.id), processPayRunBatch(batch.id)]);
    assert.equal(await prisma.payslip.count({ where: { payrollRunId: run.id, employeeId: employee.id } }), 1);
    const payslip = await prisma.payslip.findUniqueOrThrow({ where: { payrollRunId_employeeId: { payrollRunId: run.id, employeeId: employee.id } } });
    assert.equal(payslip.nsitf.toFixed(2), payslip.grossPay.mul("0.01").toFixed(2), "legacy processing persists calculated NSITF");
    assert.equal(payslip.netPay.toFixed(2), payslip.grossPay.sub(payslip.deductions).toFixed(2), "legacy employee net excludes employer-side NSITF");
    assert.equal((await prisma.payrollRun.findUniqueOrThrow({ where: { id: run.id } })).status, "PENDING_APPROVAL");
    assert.equal(results.filter(result => (result as any).processed === 1).length, 1);
  } finally {
    await prisma.payrollRun.delete({ where: { id: run.id } });
    await prisma.salaryStructure.deleteMany({ where: { employeeId: employee.id } });
    await prisma.employee.delete({ where: { id: employee.id } });
    await prisma.organization.delete({ where: { id: organization.id } });
    await prisma.$disconnect();
  }
});
