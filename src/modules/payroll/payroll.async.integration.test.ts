import assert from "node:assert/strict";
import test from "node:test";
import { prisma } from "../../core/prisma";
import { processPayRunBatch } from "./payroll.service";

const enabled = process.env.RUN_PAYROLL_ASYNC_DB_INTEGRATION === "true";

test("payroll batch delivery is idempotent and finalizes only once", { skip: !enabled }, async () => {
  const employee = await prisma.employee.findFirst({ where: { status: "ACTIVE" }, select: { id: true, organizationId: true } });
  assert.ok(employee, "an active employee fixture is required");
  const originalEnrollment = await prisma.payrollEnrollment.findUnique({ where: { employeeId: employee.id } });
  await prisma.payrollEnrollment.upsert({ where: { employeeId: employee.id }, create: { employeeId: employee.id, organizationId: employee.organizationId, isActive: true }, update: { isActive: true, removedAt: null } });
  const originalSalary = await prisma.salaryStructure.findFirst({ where: { employeeId: employee.id, effectiveFrom: { lte: new Date("2098-01-31T23:59:59.999Z") }, OR: [{ effectiveTo: null }, { effectiveTo: { gte: new Date("2098-01-01T00:00:00.000Z") } }] } });
  const testSalary = originalSalary ? null : await prisma.salaryStructure.create({ data: { organizationId: employee.organizationId, employeeId: employee.id, title: "Async integration fixture", basic: 100000, effectiveFrom: new Date("2098-01-01T00:00:00.000Z") } });
  const periodStart = new Date("2098-01-01T00:00:00.000Z"); const periodEnd = new Date("2098-01-31T23:59:59.999Z");
  const run = await prisma.payrollRun.create({ data: { organizationId: employee.organizationId, name: `Async test ${Date.now()}`, periodStart, periodEnd, status: "PROCESSING", employeeCount: 1, expectedEmployeeCount: 1, calculationInput: { test: true } } });
  const batch = await prisma.payrollCalculationBatch.create({ data: { organizationId: employee.organizationId, payrollRunId: run.id, batchIndex: 0, employeeIds: [employee.id], expectedCount: 1 } });
  try {
    const results = await Promise.all([processPayRunBatch(batch.id), processPayRunBatch(batch.id), processPayRunBatch(batch.id)]);
    assert.equal(await prisma.payslip.count({ where: { payrollRunId: run.id, employeeId: employee.id } }), 1);
    assert.equal((await prisma.payrollRun.findUniqueOrThrow({ where: { id: run.id } })).status, "PENDING_APPROVAL");
    assert.equal(results.filter(result => (result as any).processed === 1).length, 1);
  } finally {
    await prisma.payrollRun.delete({ where: { id: run.id } });
    if (testSalary) await prisma.salaryStructure.delete({ where: { id: testSalary.id } });
    if (!originalEnrollment) await prisma.payrollEnrollment.delete({ where: { employeeId: employee.id } });
    else await prisma.payrollEnrollment.update({ where: { employeeId: employee.id }, data: { isActive: originalEnrollment.isActive, removedAt: originalEnrollment.removedAt } });
    await prisma.$disconnect();
  }
});
