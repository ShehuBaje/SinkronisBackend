import assert from "node:assert/strict";
import test from "node:test";
import { prisma } from "../../core/prisma";
import type { AuthUser } from "../../types";
import { addPayRunParticipants, cancelDraftPayRun, initializePayRunCalculation, processDraftPayRun, removePayRunParticipant } from "./payroll.service";

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
    assert.equal((await prisma.payrollAdjustmentApplication.findUniqueOrThrow({ where: { bonusId: bonus.id } })).status, "APPLIED");
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
