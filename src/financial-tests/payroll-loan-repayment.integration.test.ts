import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { Prisma } from "@prisma/client";
import { prisma } from "../core/prisma.js";
import { completeManualSettlement, prepareProviderSettlement } from "../core/financial-settlement.js";
import { applyProviderTransferResult, finalizeProviderSettlementSuccess, reserveAndClaimProviderSettlement, reverseProviderSettlement } from "../core/provider-settlement.js";
import { commitPayrollLoanRecoveries } from "../core/payroll-loan-repayment.js";
import { assertSafeTestDatabase } from "../test-infrastructure/test-database.js";

const enabled = Boolean(process.env.TEST_DATABASE_GUARD);
if (enabled) {
  assert.equal(process.env.NODE_ENV, "test");
  assert.equal(process.env.PAYSTACK_TRANSFERS_ENABLED, "false");
  assertSafeTestDatabase({ databaseUrl: process.env.DATABASE_URL_ORIGINAL, testDatabaseUrl: process.env.DATABASE_URL, nodeEnv: process.env.NODE_ENV, destructive: true });
}
const financialTest = enabled ? test : test.skip;
const PREFIX = "phase3-loan-repayment-";
let sequence = 0;
const uid = (label: string) => `${PREFIX}${label}-${Date.now()}-${sequence++}`;
const money = (value: string | number) => new Prisma.Decimal(value);

const clean = async () => {
  const organizations = await prisma.organization.findMany({ where: { slug: { startsWith: PREFIX } }, select: { id: true } });
  for (const { id } of organizations) {
    await prisma.loanRepayment.deleteMany({ where: { organizationId: id } });
    await prisma.loanRecoveryApplication.deleteMany({ where: { organizationId: id } });
    await prisma.financialSettlement.deleteMany({ where: { organizationId: id } });
    await prisma.walletTransaction.deleteMany({ where: { organizationId: id } });
    await prisma.loanAdvance.deleteMany({ where: { organizationId: id } });
    await prisma.payslip.deleteMany({ where: { organizationId: id } });
    await prisma.payrollRunParticipant.deleteMany({ where: { organizationId: id } });
    await prisma.payrollRun.deleteMany({ where: { organizationId: id } });
    await prisma.payee.deleteMany({ where: { organizationId: id } });
    await prisma.employee.deleteMany({ where: { organizationId: id } });
    await prisma.auditLog.deleteMany({ where: { organizationId: id } });
    await prisma.auditLogChain.deleteMany({ where: { organizationId: id } });
    await prisma.walletAccount.deleteMany({ where: { organizationId: id } });
    await prisma.user.deleteMany({ where: { organizationId: id } });
    await prisma.role.deleteMany({ where: { organizationId: id } });
    await prisma.organization.delete({ where: { id } });
  }
};

type LoanInput = { outstanding: number; applied: number; type?: "RECURRING" | "ONE_OFF"; status?: string };
const fixture = async (loanInputs: LoanInput[], netPay = 100) => {
  const slug = uid("tenant");
  const organization = await prisma.organization.create({ data: { name: slug, slug, currency: "NGN" } });
  const role = await prisma.role.create({ data: { organizationId: organization.id, name: "Phase 3 Financial Tester", isSystem: true } });
  const user = await prisma.user.create({ data: { organizationId: organization.id, roleId: role.id, email: `${slug}@example.test`, passwordHash: "test-only", firstName: "Phase", lastName: "Tester" } });
  const wallet = await prisma.walletAccount.create({ data: { organizationId: organization.id, name: "Test Wallet", purpose: "PRIMARY", balance: money(1000), currency: "NGN" } });
  const employee = await prisma.employee.create({ data: { organizationId: organization.id, employeeNo: uid("employee"), firstName: "Loan", lastName: "Employee", email: `${uid("employee")}@example.test`, status: "ACTIVE", lifecycleStatus: "CONFIRMED" } });
  const payee = await prisma.payee.create({ data: { organizationId: organization.id, employeeId: employee.id, name: "Loan Employee", type: "PERMANENT", status: "ACTIVE", taxRegime: "PAYE", externalOnPayroll: true } });
  const run = await prisma.payrollRun.create({ data: { organizationId: organization.id, name: uid("run"), periodStart: new Date("2026-10-01"), periodEnd: new Date("2026-10-31"), status: "APPROVED", membershipVersion: "UNIFIED_PAYEE_V1", participantCount: 1, permanentEmployeeCount: 1, employeeCount: 1, totalLoans: money(loanInputs.reduce((sum, loan) => sum + loan.applied, 0)), totalNetPay: money(netPay), totalPermanentNetPay: money(netPay) } });
  const participant = await prisma.payrollRunParticipant.create({ data: { organizationId: organization.id, payrollRunId: run.id, payeeId: payee.id, employeeId: employee.id, participantType: "PERMANENT", selectionSource: "MANUAL", frozenAt: new Date() } });
  const payslip = await prisma.payslip.create({ data: { organizationId: organization.id, payrollRunId: run.id, employeeId: employee.id, grossPay: money(netPay + loanInputs.reduce((sum, loan) => sum + loan.applied, 0)), deductions: money(loanInputs.reduce((sum, loan) => sum + loan.applied, 0)), loanDeduction: money(loanInputs.reduce((sum, loan) => sum + loan.applied, 0)), netPay: money(netPay), currency: "NGN", paymentStatus: "PENDING" } });
  const loans = [];
  const applications = [];
  for (const input of loanInputs) {
    const loan = await prisma.loanAdvance.create({ data: { organizationId: organization.id, employeeId: employee.id, amount: money(input.outstanding), openingOutstanding: money(input.outstanding), outstanding: money(input.outstanding), currency: "NGN", issuedAt: new Date("2026-09-01"), externalDisbursementDate: new Date("2026-09-01"), recoveryStartDate: new Date("2026-10-01"), loanType: input.type ?? "RECURRING", monthlyRepayment: input.type === "ONE_OFF" ? null : money(input.applied), status: input.status ?? "ACTIVE", origin: "EXTERNAL_MANUAL", confirmationStatus: "CONFIRMED", recordedById: user.id, recordedAt: new Date(), attestedById: user.id, attestedAt: new Date() } });
    const application = await prisma.loanRecoveryApplication.create({ data: { organizationId: organization.id, loanAdvanceId: loan.id, payrollRunId: run.id, payrollRunParticipantId: participant.id, payslipId: payslip.id, employeeId: employee.id, revisionRootRunId: run.id, appliedAmount: money(input.applied), currency: "NGN", state: "FROZEN", frozenSnapshot: { loanAdvanceId: loan.id, outstandingBefore: String(input.outstanding) } } });
    loans.push(loan);
    applications.push(application);
  }
  const settlement = await prepareProviderSettlement({ organizationId: organization.id, walletAccountId: wallet.id, sourceType: "PAYROLL_PAYSLIP", sourceId: payslip.id, amount: money(netPay), currency: "NGN", beneficiarySnapshot: { accountNumber: "0000000001", bankCode: "TEST" }, createdById: user.id }, uid("settlement"));
  const claimed = await reserveAndClaimProviderSettlement(organization.id, settlement.id);
  assert.equal(claimed.shouldInitiate, true);
  const success = { reference: claimed.settlement.providerTransferReference!, amountMinor: netPay * 100, currency: "NGN", providerStatus: "success", transferCode: uid("transfer"), state: "SUCCESS" as const };
  return { organization, user, wallet, employee, run, participant, payslip, loans, applications, settlement: claimed.settlement, success };
};

if (enabled) before(clean);
if (enabled) after(async () => { await clean(); await prisma.$disconnect(); });

financialTest("Phase 3 loan: authoritative Payslip success commits multiple frozen recoveries once and reversal compensates once", async () => {
  const fx = await fixture([{ outstanding: 80, applied: 30 }, { outstanding: 20, applied: 20, type: "ONE_OFF" }]);
  await Promise.allSettled([finalizeProviderSettlementSuccess(fx.settlement.id, fx.success), finalizeProviderSettlementSuccess(fx.settlement.id, fx.success)]);
  const repayments = await prisma.loanRepayment.findMany({ where: { organizationId: fx.organization.id }, orderBy: { loanId: "asc" } });
  assert.equal(repayments.length, 2);
  assert.deepEqual(repayments.map((row) => row.amount.toNumber()).sort((a, b) => a - b), [20, 30]);
  assert.equal(await prisma.loanRecoveryApplication.count({ where: { organizationId: fx.organization.id, state: "COMMITTED" } }), 2);
  const loans = await prisma.loanAdvance.findMany({ where: { organizationId: fx.organization.id }, orderBy: { outstanding: "asc" } });
  assert.deepEqual(loans.map((row) => row.outstanding.toNumber()), [0, 50]);
  assert.equal(loans[0].status, "COMPLETED");
  assert.equal(await prisma.walletTransaction.count({ where: { organizationId: fx.organization.id, direction: "DEBIT" } }), 1);

  const settled = await prisma.financialSettlement.findUniqueOrThrow({ where: { id: fx.settlement.id } });
  const reversal = { ...fx.success, providerStatus: "reversed", state: "REVERSAL" as const };
  await reverseProviderSettlement(settled, reversal);
  await reverseProviderSettlement(settled, reversal);
  const restored = await prisma.loanAdvance.findMany({ where: { organizationId: fx.organization.id }, orderBy: { outstanding: "asc" } });
  assert.deepEqual(restored.map((row) => row.outstanding.toNumber()), [20, 80]);
  assert.ok(restored.every((row) => row.status === "ACTIVE"));
  assert.equal(await prisma.loanRepayment.count({ where: { organizationId: fx.organization.id, status: "REVERSED" } }), 2);
  assert.equal(await prisma.loanRecoveryApplication.count({ where: { organizationId: fx.organization.id, state: "REVERSED" } }), 2);
  assert.equal(await prisma.walletTransaction.count({ where: { organizationId: fx.organization.id, direction: "CREDIT" } }), 1);
});

financialTest("Phase 3 loan: outstanding drift fails success closed and rolls back settlement business finalization", async () => {
  const fx = await fixture([{ outstanding: 10, applied: 20 }]);
  await assert.rejects(() => finalizeProviderSettlementSuccess(fx.settlement.id, fx.success), (error: any) => error?.details?.code === "PAYROLL_LOAN_RECOVERY_INTEGRITY_CONFLICT");
  assert.equal(await prisma.loanRepayment.count({ where: { organizationId: fx.organization.id } }), 0);
  assert.equal((await prisma.loanAdvance.findUniqueOrThrow({ where: { id: fx.loans[0].id } })).outstanding.toNumber(), 10);
  assert.equal((await prisma.financialSettlement.findUniqueOrThrow({ where: { id: fx.settlement.id } })).status, "PROVIDER_PROCESSING");
  assert.equal((await prisma.payslip.findUniqueOrThrow({ where: { id: fx.payslip.id } })).paymentStatus, "PENDING");
  assert.equal(await prisma.walletTransaction.count({ where: { organizationId: fx.organization.id, direction: "DEBIT" } }), 0);
});

financialTest("Phase 3 loan: failure after first recovery application rolls back all loan, settlement, Payslip, and wallet effects", async () => {
  const fx = await fixture([{ outstanding: 100, applied: 10 }, { outstanding: 100, applied: 20 }]);
  let calls = 0;
  await assert.rejects(() => finalizeProviderSettlementSuccess(fx.settlement.id, fx.success, { afterLoanApplication: async () => { calls += 1; if (calls === 1) throw new Error("injected rollback"); } }), /injected rollback/);
  assert.equal(await prisma.loanRepayment.count({ where: { organizationId: fx.organization.id } }), 0);
  assert.equal(await prisma.loanRecoveryApplication.count({ where: { organizationId: fx.organization.id, state: "FROZEN" } }), 2);
  assert.deepEqual((await prisma.loanAdvance.findMany({ where: { organizationId: fx.organization.id }, orderBy: { id: "asc" } })).map((row) => row.outstanding.toNumber()), [100, 100]);
  assert.equal((await prisma.financialSettlement.findUniqueOrThrow({ where: { id: fx.settlement.id } })).status, "PROVIDER_PROCESSING");
  assert.equal(await prisma.walletTransaction.count({ where: { organizationId: fx.organization.id, direction: "DEBIT" } }), 0);
});

financialTest("Phase 3 loan: manual Payslip success uses the same recovery finalizer without a provider call", async () => {
  const fx = await fixture([{ outstanding: 50, applied: 10 }], 40);
  await prisma.financialSettlement.delete({ where: { id: fx.settlement.id } });
  await prisma.walletAccount.update({ where: { id: fx.wallet.id }, data: { reservedBalance: money(0) } });
  const result = await completeManualSettlement({ organizationId: fx.organization.id, walletAccountId: fx.wallet.id, sourceType: "PAYROLL_PAYSLIP", sourceId: fx.payslip.id, amount: money(40), currency: "NGN", createdById: fx.user.id }, { idempotencyKey: uid("manual-idem"), externalReference: uid("manual-ref"), settledAt: new Date(), note: "Test manual Payslip settlement" }, async (tx, settlement) => {
    await tx.payslip.update({ where: { id: fx.payslip.id }, data: { paymentStatus: "PAID" } });
    return commitPayrollLoanRecoveries(tx, settlement);
  });
  assert.equal(result.settlement.status, "SUCCEEDED");
  assert.equal(await prisma.loanRepayment.count({ where: { organizationId: fx.organization.id, source: "PAYROLL_SETTLEMENT" } }), 1);
  assert.equal((await prisma.loanAdvance.findUniqueOrThrow({ where: { id: fx.loans[0].id } })).outstanding.toNumber(), 40);
});

financialTest("Phase 3 loan: non-terminal, unknown, and failed settlement states never repay", async () => {
  const fx = await fixture([{ outstanding: 50, applied: 10 }], 40);
  assert.equal(await prisma.loanRepayment.count({ where: { organizationId: fx.organization.id } }), 0);
  await applyProviderTransferResult(fx.settlement, { ...fx.success, providerStatus: "pending", state: "NON_CONCLUSIVE" });
  await prisma.financialSettlement.update({ where: { id: fx.settlement.id }, data: { status: "UNKNOWN" } });
  assert.equal(await prisma.loanRepayment.count({ where: { organizationId: fx.organization.id } }), 0);
  assert.equal((await prisma.loanAdvance.findUniqueOrThrow({ where: { id: fx.loans[0].id } })).outstanding.toNumber(), 50);
  const current = await prisma.financialSettlement.findUniqueOrThrow({ where: { id: fx.settlement.id } });
  await applyProviderTransferResult(current, { ...fx.success, providerStatus: "failed", state: "FAILURE" });
  assert.equal((await prisma.financialSettlement.findUniqueOrThrow({ where: { id: fx.settlement.id } })).status, "FAILED");
  assert.equal(await prisma.loanRepayment.count({ where: { organizationId: fx.organization.id } }), 0);
  assert.equal(await prisma.loanRecoveryApplication.count({ where: { organizationId: fx.organization.id, state: "FROZEN" } }), 1);
});

financialTest("Phase 3 loan: superseded recovery fails closed and prospective pause does not rewrite frozen authority", async () => {
  const superseded = await fixture([{ outstanding: 50, applied: 10 }], 40);
  await prisma.loanRecoveryApplication.update({ where: { id: superseded.applications[0].id }, data: { state: "SUPERSEDED", supersededAt: new Date() } });
  await assert.rejects(() => finalizeProviderSettlementSuccess(superseded.settlement.id, superseded.success), (error: any) => error?.details?.code === "PAYROLL_LOAN_RECOVERY_INTEGRITY_CONFLICT");
  assert.equal(await prisma.loanRepayment.count({ where: { organizationId: superseded.organization.id } }), 0);

  const paused = await fixture([{ outstanding: 50, applied: 10 }], 40);
  await prisma.loanAdvance.update({ where: { id: paused.loans[0].id }, data: { status: "PAUSED", pausedAt: new Date() } });
  await finalizeProviderSettlementSuccess(paused.settlement.id, paused.success);
  const loan = await prisma.loanAdvance.findUniqueOrThrow({ where: { id: paused.loans[0].id } });
  assert.equal(loan.outstanding.toNumber(), 40);
  assert.equal(loan.status, "PAUSED");
});
