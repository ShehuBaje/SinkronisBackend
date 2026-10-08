import { Prisma, type FinancialSettlement } from "@prisma/client";
import { createAuditLog } from "../modules/admin/admin.audit";
import { conflict } from "./http-error";

type Db = Prisma.TransactionClient;
type CommitHooks = { afterApplication?: (applicationId: string) => Promise<void> };

const integrityConflict = (message: string, details: Record<string, unknown>) =>
  conflict(message, { code: "PAYROLL_LOAN_RECOVERY_INTEGRITY_CONFLICT", ...details });

const lockApplications = async (tx: Db, settlement: FinancialSettlement) => {
  await tx.$queryRaw`
    SELECT id
    FROM LoanRecoveryApplication
    WHERE organizationId = ${settlement.organizationId}
      AND payslipId = ${settlement.sourceId}
    ORDER BY loanAdvanceId ASC
    FOR UPDATE
  `;
  return tx.loanRecoveryApplication.findMany({
    where: { organizationId: settlement.organizationId, payslipId: settlement.sourceId },
    orderBy: [{ loanAdvanceId: "asc" }, { id: "asc" }],
  });
};

const lockLoans = async (tx: Db, organizationId: string, loanIds: string[]) => {
  const ids = [...new Set(loanIds)].sort();
  if (!ids.length) return new Map<string, Awaited<ReturnType<Db["loanAdvance"]["findFirstOrThrow"]>>>();
  await tx.$queryRaw`
    SELECT id
    FROM LoanAdvance
    WHERE organizationId = ${organizationId}
      AND id IN (${Prisma.join(ids)})
    ORDER BY id ASC
    FOR UPDATE
  `;
  const rows = await tx.loanAdvance.findMany({ where: { organizationId, id: { in: ids } } });
  if (rows.length !== ids.length) throw integrityConflict("A frozen Payroll loan is unavailable", { loanAdvanceIds: ids });
  return new Map(rows.map((row) => [row.id, row]));
};

export const commitPayrollLoanRecoveries = async (
  tx: Db,
  settlement: FinancialSettlement,
  hooks?: CommitHooks,
) => {
  if (settlement.sourceType !== "PAYROLL_PAYSLIP") return [];
  const payslip = await tx.payslip.findFirst({
    where: { id: settlement.sourceId, organizationId: settlement.organizationId },
    select: { id: true, payrollRunId: true, currency: true, loanDeduction: true },
  });
  if (!payslip) throw integrityConflict("Payroll settlement source Payslip is unavailable", { settlementId: settlement.id });

  const applications = await lockApplications(tx, settlement);
  if (!applications.length) return [];
  const superseded = applications.find((application) => application.state === "SUPERSEDED");
  if (superseded) throw integrityConflict("A superseded Payroll loan recovery cannot be committed", { settlementId: settlement.id, loanRecoveryApplicationId: superseded.id });
  const invalidState = applications.find((application) => !["FROZEN", "COMMITTED"].includes(application.state));
  if (invalidState) throw integrityConflict("Payroll loan recovery is not committable", { settlementId: settlement.id, loanRecoveryApplicationId: invalidState.id, state: invalidState.state });

  const sum = applications.reduce((total, application) => total.plus(application.appliedAmount), new Prisma.Decimal(0));
  if (!sum.equals(payslip.loanDeduction)) throw integrityConflict("Frozen Payroll loan applications do not reconcile to the Payslip", { settlementId: settlement.id, payslipId: payslip.id, applicationTotal: sum.toFixed(2), payslipLoanDeduction: payslip.loanDeduction.toFixed(2) });
  const loans = await lockLoans(tx, settlement.organizationId, applications.map((application) => application.loanAdvanceId));
  const repayments = [];
  for (const application of applications) {
    const existing = await tx.loanRepayment.findFirst({ where: { organizationId: settlement.organizationId, loanRecoveryApplicationId: application.id } });
    if (application.state === "COMMITTED") {
      if (!existing || existing.financialSettlementId !== settlement.id || existing.status !== "POSTED") throw integrityConflict("Committed Payroll loan recovery evidence is inconsistent", { settlementId: settlement.id, loanRecoveryApplicationId: application.id });
      repayments.push(existing);
      continue;
    }
    if (existing) throw integrityConflict("Frozen Payroll loan recovery already has repayment evidence", { settlementId: settlement.id, loanRecoveryApplicationId: application.id });
    const loan = loans.get(application.loanAdvanceId)!;
    const amount = application.appliedAmount;
    if (!amount.greaterThan(0)) throw integrityConflict("Frozen Payroll loan recovery amount must be positive", { loanRecoveryApplicationId: application.id });
    if (application.currency !== settlement.currency || application.currency !== (loan.currency ?? "NGN") || application.currency !== (payslip.currency ?? "NGN")) throw integrityConflict("Payroll loan recovery currency does not match its authoritative source", { loanRecoveryApplicationId: application.id });
    if (loan.outstanding.lessThan(amount)) throw integrityConflict("Loan outstanding is less than the frozen Payroll recovery", { loanAdvanceId: loan.id, loanRecoveryApplicationId: application.id, outstanding: loan.outstanding.toFixed(2), appliedAmount: amount.toFixed(2) });
    const outstandingAfter = loan.outstanding.minus(amount);
    const completedLoan = outstandingAfter.equals(0);
    const committedAt = new Date();
    const repayment = await tx.loanRepayment.create({ data: {
      organizationId: settlement.organizationId,
      loanId: loan.id,
      loanRecoveryApplicationId: application.id,
      payrollRunId: application.payrollRunId,
      payrollRunParticipantId: application.payrollRunParticipantId,
      payslipId: application.payslipId,
      financialSettlementId: settlement.id,
      source: "PAYROLL_SETTLEMENT",
      amount,
      currency: application.currency,
      outstandingBefore: loan.outstanding,
      outstandingAfter,
      statusBeforeCommit: loan.status,
      completedLoan,
      repaymentDate: settlement.settledAt ?? committedAt,
      committedAt,
      status: "POSTED",
    } });
    await tx.loanAdvance.update({ where: { id: loan.id }, data: { outstanding: outstandingAfter, ...(completedLoan ? { status: "COMPLETED", completedAt: committedAt } : {}) } });
    const transitioned = await tx.loanRecoveryApplication.updateMany({ where: { id: application.id, organizationId: settlement.organizationId, state: "FROZEN" }, data: { state: "COMMITTED", committedAt } });
    if (transitioned.count !== 1) throw integrityConflict("Payroll loan recovery was concurrently changed", { loanRecoveryApplicationId: application.id });
    loans.set(loan.id, { ...loan, outstanding: outstandingAfter, ...(completedLoan ? { status: "COMPLETED", completedAt: committedAt } : {}) });
    repayments.push(repayment);
    await hooks?.afterApplication?.(application.id);
  }
  await createAuditLog({ organizationId: settlement.organizationId, actorUserId: settlement.createdById ?? undefined, action: "PAYROLL_LOAN_RECOVERY_COMMITTED", resource: "FINANCIAL_SETTLEMENT", resourceId: settlement.id, summary: `Committed ${repayments.length} frozen Payroll loan recoveries`, metadata: { payslipId: payslip.id, repaymentIds: repayments.map((row) => row.id), amount: sum.toFixed(2), currency: settlement.currency } }, tx);
  return repayments;
};

export const reversePayrollLoanRecoveries = async (tx: Db, settlement: FinancialSettlement, reversalReference: string) => {
  if (settlement.sourceType !== "PAYROLL_PAYSLIP") return [];
  const applications = await lockApplications(tx, settlement);
  if (!applications.length) return [];
  const invalidState = applications.find((application) => !["COMMITTED", "REVERSED"].includes(application.state));
  if (invalidState) throw integrityConflict("Payroll loan recovery cannot be reversed from its current state", { settlementId: settlement.id, loanRecoveryApplicationId: invalidState.id, state: invalidState.state });
  const loans = await lockLoans(tx, settlement.organizationId, applications.map((application) => application.loanAdvanceId));
  const repayments = [];
  for (const application of applications) {
    const repayment = await tx.loanRepayment.findFirst({ where: { organizationId: settlement.organizationId, loanRecoveryApplicationId: application.id } });
    if (!repayment || repayment.financialSettlementId !== settlement.id) throw integrityConflict("Payroll loan repayment evidence is unavailable for reversal", { settlementId: settlement.id, loanRecoveryApplicationId: application.id });
    if (application.state === "REVERSED") {
      if (repayment.status !== "REVERSED") throw integrityConflict("Reversed Payroll loan recovery evidence is inconsistent", { loanRecoveryApplicationId: application.id });
      repayments.push(repayment);
      continue;
    }
    if (repayment.status !== "POSTED") throw integrityConflict("Payroll loan repayment is not reversible", { loanRecoveryApplicationId: application.id, repaymentId: repayment.id, status: repayment.status });
    const loan = loans.get(application.loanAdvanceId)!;
    const restoredOutstanding = loan.outstanding.plus(repayment.amount);
    const reversedAt = new Date();
    await tx.loanAdvance.update({ where: { id: loan.id }, data: { outstanding: restoredOutstanding, ...(repayment.completedLoan && loan.status === "COMPLETED" ? { status: repayment.statusBeforeCommit ?? "ACTIVE", completedAt: null } : {}) } });
    const repaymentTransition = await tx.loanRepayment.updateMany({ where: { id: repayment.id, organizationId: settlement.organizationId, status: "POSTED" }, data: { status: "REVERSED", reversedAt, reversalReference } });
    const applicationTransition = await tx.loanRecoveryApplication.updateMany({ where: { id: application.id, organizationId: settlement.organizationId, state: "COMMITTED" }, data: { state: "REVERSED", reversedAt } });
    if (repaymentTransition.count !== 1 || applicationTransition.count !== 1) throw integrityConflict("Payroll loan reversal was concurrently changed", { loanRecoveryApplicationId: application.id, repaymentId: repayment.id });
    loans.set(loan.id, { ...loan, outstanding: restoredOutstanding, ...(repayment.completedLoan && loan.status === "COMPLETED" ? { status: repayment.statusBeforeCommit ?? "ACTIVE", completedAt: null } : {}) });
    repayments.push({ ...repayment, status: "REVERSED", reversedAt, reversalReference });
  }
  const amount = repayments.reduce((total, repayment) => total.plus(repayment.amount), new Prisma.Decimal(0));
  await createAuditLog({ organizationId: settlement.organizationId, actorUserId: settlement.createdById ?? undefined, action: "PAYROLL_LOAN_RECOVERY_REVERSED", resource: "FINANCIAL_SETTLEMENT", resourceId: settlement.id, summary: `Reversed ${repayments.length} Payroll loan recoveries`, metadata: { payslipId: settlement.sourceId, repaymentIds: repayments.map((row) => row.id), amount: amount.toFixed(2), currency: settlement.currency, reversalReference } }, tx);
  return repayments;
};
