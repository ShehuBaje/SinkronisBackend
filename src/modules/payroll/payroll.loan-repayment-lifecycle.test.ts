import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const read = (path: string) => readFileSync(path, "utf8");
const schema = read("prisma/schema.prisma");
const migration = read("prisma/migrations/20261008100000_authoritative_payroll_loan_repayment/migration.sql");
const repayment = read("src/core/payroll-loan-repayment.ts");
const provider = read("src/core/provider-settlement.ts");
const payroll = read("src/modules/payroll/payroll.service.ts");
const routes = read("src/modules/payroll/payroll.routes.ts");

test("Phase 3 repayment schema has tenant-safe authoritative identity and reversible evidence", () => {
  assert.match(schema, /enum loan_recovery_application_status\s*\{\s*FROZEN\s*SUPERSEDED\s*COMMITTED\s*REVERSED/);
  assert.match(schema, /@@unique\(\[organizationId, loanRecoveryApplicationId\], map: "LoanRepayment_org_application_key"\)/);
  assert.match(schema, /financialSettlement\s+FinancialSettlement\?\s+@relation\(fields: \[organizationId, financialSettlementId\]/);
  assert.match(schema, /outstandingBefore\s+Decimal\?/);
  assert.match(schema, /outstandingAfter\s+Decimal\?/);
  assert.match(schema, /statusBeforeCommit\s+String\?/);
});

test("migration 80 is additive financial structure and performs no historical DML", () => {
  assert.match(migration, /ALTER TABLE `LoanRecoveryApplication`/);
  assert.match(migration, /CREATE UNIQUE INDEX `LoanRepayment_org_application_key`/);
  assert.doesNotMatch(migration, /\b(?:INSERT|UPDATE|DELETE)\s+(?:INTO|FROM|`)/i);
  assert.doesNotMatch(migration, /WalletAccount|WalletTransaction/);
});

test("only authoritative Payslip settlement finalization commits and reversal compensates", () => {
  assert.match(provider, /finalizeProviderSettlementSuccess[\s\S]*commitPayrollLoanRecoveries/);
  assert.match(payroll, /completeManualSettlement[\s\S]*commitPayrollLoanRecoveries/);
  assert.match(provider, /reverseSucceededSettlement[\s\S]*reversePayrollLoanRecoveries/);
  assert.match(repayment, /PAYROLL_LOAN_RECOVERY_INTEGRITY_CONFLICT/);
  assert.match(repayment, /ORDER BY loanAdvanceId ASC[\s\S]*FOR UPDATE/);
  assert.match(repayment, /state: "FROZEN"[\s\S]*state: "COMMITTED"/);
  assert.match(repayment, /state: "COMMITTED"[\s\S]*state: "REVERSED"/);
});

test("mixed settlement guard remains and no public repayment CRUD is introduced", () => {
  assert.match(payroll, /MIXED_PAYROLL_SETTLEMENT_NOT_AVAILABLE/);
  assert.doesNotMatch(routes, /loan-recovery-applications|loans\/:loanId\/repay|loan-repayments/);
  assert.doesNotMatch(repayment, /PaystackTransferProvider|initiateTransfer|reserveWalletBalance/);
});
