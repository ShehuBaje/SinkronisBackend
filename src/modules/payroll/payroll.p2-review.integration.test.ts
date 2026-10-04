import assert from "node:assert/strict";
import test from "node:test";
import { prisma } from "../../core/prisma";
import type { AuthUser } from "../../types";
import { approvePayRun, createReplacementDraft, getPayRunDetail, initializePayRunCalculation, processDraftPayRun, rejectPayRunForRework } from "./payroll.service";

const enabled = process.env.RUN_PAYROLL_P2_REVIEW_DB_INTEGRATION === "true";

test("mixed review rejection creates a fresh revision and preserves exactly-once adjustment authority", { skip: !enabled }, async () => {
  const suffix = `${Date.now()}`;
  const organization = await prisma.organization.create({ data: { name: `P2.3 review fixture ${suffix}`, slug: `p23-review-${suffix}` } });
  const role = await prisma.role.create({ data: { organizationId: organization.id, name: `Payroll review ${suffix}` } });
  const dbUser = await prisma.user.create({ data: { organizationId: organization.id, roleId: role.id, email: `p23-${suffix}@example.invalid`, passwordHash: "not-used", firstName: "Review", lastName: "Fixture" } });
  const user: AuthUser = { id: dbUser.id, organizationId: organization.id, roleId: role.id, email: dbUser.email, isPlatformAdmin: false, permissions: ["payroll:runs:view", "payroll:runs:update", "payroll:runs:approve"] };
  const payee = await prisma.payee.create({ data: { organizationId: organization.id, name: "Revision contract fixture", type: "CONTRACT", status: "ACTIVE", taxRegime: "WHT", externalOnPayroll: true, monthlyAmount: 100000 } });
  const bonus = await prisma.payrollBonus.create({ data: { organizationId: organization.id, payeeId: payee.id, amount: 10000, frequency: "ONCE", justification: "Revision-safe bonus", effectiveFrom: new Date("2097-01-01T00:00:00.000Z") } });
  const runA = await prisma.payrollRun.create({ data: { organizationId: organization.id, name: `Review integration ${suffix}`, periodStart: new Date("2097-01-01T00:00:00.000Z"), periodEnd: new Date("2097-01-31T23:59:59.999Z"), status: "DRAFT", membershipVersion: "UNIFIED_PAYEE_V1", calculationInput: { currency: "NGN", requestedById: dbUser.id } } });
  await prisma.payrollRunParticipant.create({ data: { organizationId: organization.id, payrollRunId: runA.id, payeeId: payee.id, participantType: "CONTRACT", selectionSource: "MANUAL", selectedById: dbUser.id } });
  try {
    await processDraftPayRun(organization.id, runA.id, user); await initializePayRunCalculation(runA.id, { execution: "direct" });
    await rejectPayRunForRework(organization.id, runA.id, "Correct the approved source data", user);
    const rejected = await prisma.payrollRun.findUniqueOrThrow({ where: { id: runA.id } });
    assert.equal(rejected.status, "REJECTED_FOR_REWORK");
    assert.equal((await prisma.payrollAdjustmentApplication.findFirstOrThrow({ where: { payrollRunId: runA.id, bonusId: bonus.id } })).status, "SUPERSEDED");
    const replacement = await createReplacementDraft(organization.id, runA.id, user); const replacementId = replacement.id as string;
    const idempotent = await createReplacementDraft(organization.id, runA.id, user); assert.equal(idempotent.id, replacementId);
    await processDraftPayRun(organization.id, replacementId, user); await initializePayRunCalculation(replacementId, { execution: "direct" });
    const detail = await getPayRunDetail(organization.id, replacementId, { page: 1, limit: 20 }, user);
    assert.equal(detail.items[0].resultType, "PAYEE_PAYMENT"); assert.equal(detail.items[0].baseCompensation, 100000); assert.equal(detail.items[0].bonus, 10000); assert.equal(detail.items[0].wht, 5500);
    await approvePayRun(organization.id, replacementId, user); await approvePayRun(organization.id, replacementId, user);
    assert.equal((await prisma.payrollRun.findUniqueOrThrow({ where: { id: replacementId } })).status, "APPROVED");
    assert.equal((await prisma.payrollAdjustmentApplication.findFirstOrThrow({ where: { payrollRunId: replacementId, bonusId: bonus.id } })).status, "ACCEPTED");
    assert.equal(await prisma.financialSettlement.count({ where: { organizationId: organization.id } }), 0);
    assert.equal(await prisma.walletTransaction.count({ where: { organizationId: organization.id } }), 0);
  } finally {
    await prisma.payrollAdjustmentApplication.deleteMany({ where: { organizationId: organization.id } });
    await prisma.payrollRun.deleteMany({ where: { organizationId: organization.id } });
    await prisma.payrollBonus.delete({ where: { id: bonus.id } }); await prisma.payee.delete({ where: { id: payee.id } });
    await prisma.auditLog.deleteMany({ where: { organizationId: organization.id } }); await prisma.auditLogChain.deleteMany({ where: { organizationId: organization.id } });
    await prisma.user.delete({ where: { id: dbUser.id } }); await prisma.role.delete({ where: { id: role.id } }); await prisma.organization.delete({ where: { id: organization.id } }); await prisma.$disconnect();
  }
});
