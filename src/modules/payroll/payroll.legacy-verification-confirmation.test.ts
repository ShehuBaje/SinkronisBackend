import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { payrollLegacyLoanVerificationDecisionSchema, payrollLegacyLoanVerificationSchema } from "./payroll.validation";

const read = (file: string) => fs.readFileSync(path.join(process.cwd(), file), "utf8");
const valid = { assertedOriginalPrincipal: 100000, assertedCutoverOutstanding: 100000, currency: "NGN", externalDisbursementDate: "2026-01-01", proposedRecoveryStartDate: "2026-11-01", repaymentType: "RECURRING", proposedMonthlyRepayment: 10000, evidenceDocumentId: "cm0000000000000000000001", attestation: true, reason: "Verified against the signed disbursement record", idempotencyKey: "legacy-verify-001" };

test("legacy verification validation requires evidence, attestation, reason and valid terms", () => {
  assert.equal(payrollLegacyLoanVerificationSchema.safeParse(valid).success, true);
  assert.equal(payrollLegacyLoanVerificationSchema.safeParse({ ...valid, evidenceDocumentId: undefined, externalReference: "HR-1", evidenceNote: "Corroborated by signed HR register" }).success, true);
  assert.equal(payrollLegacyLoanVerificationSchema.safeParse({ ...valid, evidenceDocumentId: undefined }).success, false);
  assert.equal(payrollLegacyLoanVerificationSchema.safeParse({ ...valid, attestation: false }).success, false);
  assert.equal(payrollLegacyLoanVerificationSchema.safeParse({ ...valid, repaymentType: "ONE_OFF", proposedMonthlyRepayment: 10000 }).success, false);
  assert.equal(payrollLegacyLoanVerificationSchema.safeParse({ ...valid, proposedRecoveryStartDate: "2025-12-31" }).success, false);
  assert.equal(payrollLegacyLoanVerificationDecisionSchema.safeParse({ decision: "CONFIRM", reason: "Independent evidence review completed" }).success, true);
});

test("routes enforce separate submission and restricted decision authorities", () => {
  const routes = read("src/modules/payroll/payroll.routes.ts");
  assert.match(routes, /legacy-verification", authorize\("payroll:loans:update"\)/);
  assert.match(routes, /legacy-verification\/:verificationId\/decision", authorize\("payroll:loans:confirm-legacy"\)/);
  assert.doesNotMatch(routes, /legacy-verification.*payroll:loans:approve/);
});

test("implementation preserves financial boundaries and deterministic locks", () => {
  const service = read("src/modules/payroll/payroll.service.ts");
  assert.match(service, /SELECT id FROM LoanAdvance[\s\S]*FOR UPDATE/);
  assert.match(service, /SELECT id FROM LegacyLoanVerification[\s\S]*FOR UPDATE/);
  assert.match(service, /LEGACY_LOAN_SEPARATION_OF_DUTIES_REQUIRED/);
  assert.match(service, /openingOutstanding: verification\.assertedCutoverOutstanding/);
  assert.match(service, /loanStatusPreserved: loan\.status/);
  assert.doesNotMatch(service.slice(service.indexOf("submitLegacyLoanVerification"), service.indexOf("adjustPayrollLoan")), /walletTransaction\.(create|update)|loanRepayment\.(create|update)|financialSettlement\.(create|update)|loanRecoveryApplication\.create/);
});
