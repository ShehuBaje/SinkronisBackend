import assert from "node:assert/strict";
import test from "node:test";
import { prisma } from "../../core/prisma";
import { processPayRunBatch } from "./payroll.service";

const enabled = process.env.RUN_PAYROLL_P2_FROZEN_DB_INTEGRATION === "true";

test("frozen external snapshots calculate once and ignore later Payee changes", { skip: !enabled }, async () => {
  const suffix = `${Date.now()}`;
  const existingOrganization = await prisma.organization.findFirst({ select: { id: true } });
  const organization = existingOrganization ?? await prisma.organization.create({ data: { name: `P2.2 isolated fixture ${suffix}`, slug: `p22-isolated-${suffix}` }, select: { id: true } });
  const contract = await prisma.payee.create({ data: { organizationId: organization.id, name: `Contract fixture ${suffix}`, type: "CONTRACT", status: "ACTIVE", taxRegime: "WHT", externalOnPayroll: true, monthlyAmount: 100000 } });
  const consultant = await prisma.payee.create({ data: { organizationId: organization.id, name: `Consultant fixture ${suffix}`, type: "CONSULTANT", status: "ACTIVE", taxRegime: "EXEMPT", externalOnPayroll: true, monthlyAmount: 100000 } });
  const run = await prisma.payrollRun.create({ data: { organizationId: organization.id, name: `Frozen external integration ${suffix}`, periodStart: new Date("2097-01-01T00:00:00.000Z"), periodEnd: new Date("2097-01-31T23:59:59.999Z"), status: "PROCESSING", membershipVersion: "UNIFIED_PAYEE_V1", participantsFrozenAt: new Date(), participantCount: 2, externalPayeeCount: 2, calculationInput: { currency: "NGN", test: true } } });
  const frozen = new Date();
  const participants = await Promise.all([
    prisma.payrollRunParticipant.create({ data: { organizationId: organization.id, payrollRunId: run.id, payeeId: contract.id, participantType: "CONTRACT", selectionSource: "AUTO", frozenAt: frozen, calculationSnapshot: { version: "P2_V1", participantType: "CONTRACT", currency: "NGN", payeeId: contract.id, name: "Frozen contract", role: "Contractor", monthlyAmount: "100000.00", taxRegime: "WHT", dateOnboarded: null, tin: null, bank: {} } } }),
    prisma.payrollRunParticipant.create({ data: { organizationId: organization.id, payrollRunId: run.id, payeeId: consultant.id, participantType: "CONSULTANT", selectionSource: "AUTO", frozenAt: frozen, calculationSnapshot: { version: "P2_V1", participantType: "CONSULTANT", currency: "NGN", payeeId: consultant.id, name: "Frozen consultant", role: "Consultant", monthlyAmount: "100000.00", taxRegime: "EXEMPT", dateOnboarded: null, tin: null, bank: {} } } })
  ]);
  const batch = await prisma.payrollCalculationBatch.create({ data: { organizationId: organization.id, payrollRunId: run.id, batchIndex: 0, employeeIds: [], participantIds: participants.map((row) => row.id), expectedCount: 2 } });
  const financialBefore = await Promise.all([prisma.financialSettlement.count(), prisma.walletTransaction.count()]);
  try {
    await prisma.payee.update({ where: { id: contract.id }, data: { monthlyAmount: 900000, taxRegime: "LEGACY_UNSPECIFIED" } });
    const results = await Promise.all([processPayRunBatch(batch.id), processPayRunBatch(batch.id), processPayRunBatch(batch.id)]);
    const payments = await prisma.payeePayment.findMany({ where: { payrollRunId: run.id }, orderBy: { payeeTypeSnapshot: "asc" } });
    assert.equal(payments.length, 2);
    const contractPayment = payments.find((row) => row.payeeTypeSnapshot === "CONTRACT")!;
    const consultantPayment = payments.find((row) => row.payeeTypeSnapshot === "CONSULTANT")!;
    assert.equal(contractPayment.grossAmount.toFixed(2), "100000.00");
    assert.equal(contractPayment.whtAmount.toFixed(2), "5000.00");
    assert.equal(contractPayment.netAmount.toFixed(2), "95000.00");
    assert.equal(consultantPayment.whtAmount.toFixed(2), "0.00");
    assert.equal(consultantPayment.netAmount.toFixed(2), "100000.00");
    const completed = await prisma.payrollRun.findUniqueOrThrow({ where: { id: run.id } });
    assert.equal(completed.status, "PENDING_APPROVAL");
    assert.equal(completed.processedParticipantCount, 2);
    assert.equal(completed.totalGross.toFixed(2), "200000.00");
    assert.equal(completed.totalWht.toFixed(2), "5000.00");
    assert.equal(completed.totalExternalNetPay.toFixed(2), "195000.00");
    assert.equal(completed.totalNetPay.toFixed(2), "195000.00");
    assert.equal(results.filter((row) => (row as { processed?: number }).processed === 2).length, 1);
    assert.deepEqual(await Promise.all([prisma.financialSettlement.count(), prisma.walletTransaction.count()]), financialBefore);
  } finally {
    await prisma.payrollRun.delete({ where: { id: run.id } });
    await prisma.payee.deleteMany({ where: { id: { in: [contract.id, consultant.id] } } });
    await prisma.auditLog.deleteMany({ where: { organizationId: organization.id, resourceId: run.id } });
    if (!existingOrganization) { await prisma.auditLogChain.deleteMany({ where: { organizationId: organization.id } }); await prisma.organization.delete({ where: { id: organization.id } }); }
    await prisma.$disconnect();
  }
});
