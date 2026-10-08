import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const service = readFileSync(path.resolve("src/modules/payroll/payroll.service.ts"), "utf8");
const schema = readFileSync(path.resolve("prisma/schema.prisma"), "utf8");
const migration = readFileSync(path.resolve("prisma/migrations/20261007100000_per_loan_recovery_application_foundation/migration.sql"), "utf8");

test("loan recovery application schema is compact, tenant-safe and idempotent", () => {
  assert.match(schema, /model LoanRecoveryApplication[\s\S]*organizationId\s+String/);
  assert.match(schema, /model LoanRecoveryApplication[\s\S]*loanAdvanceId\s+String/);
  assert.match(schema, /model LoanRecoveryApplication[\s\S]*payrollRunParticipantId\s+String/);
  assert.match(schema, /model LoanRecoveryApplication[\s\S]*payslipId\s+String/);
  assert.match(schema, /@@unique\(\[loanAdvanceId, payslipId\], map:/);
  assert.match(schema, /@@unique\(\[payrollRunId, payrollRunParticipantId, loanAdvanceId\], map:/);
  assert.match(schema, /enum loan_recovery_application_status\s*\{\s*FROZEN\s*SUPERSEDED\s*COMMITTED\s*REVERSED\s*\}/);
});

test("migration 79 is additive and fabricates no recovery history", () => {
  assert.match(migration, /CREATE TABLE `LoanRecoveryApplication`/);
  assert.doesNotMatch(migration, /INSERT\s+INTO\s+`LoanRecoveryApplication`/i);
  assert.doesNotMatch(migration, /UPDATE\s+`LoanAdvance`/i);
  assert.doesNotMatch(migration, /CREATE TABLE `LoanRepayment`/i);
  assert.doesNotMatch(migration, /Wallet|FinancialSettlement/);
});

test("freeze persists per-loan applications atomically with the permanent Payslip result", () => {
  assert.match(service, /const payslip = await tx\.payslip\.upsert/);
  assert.match(service, /await persistFrozenLoanRecoveryApplications\(tx,/);
  assert.match(service, /loanRecoveryApplication\.createMany\(\{ data: rows, skipDuplicates: true \}\)/);
  assert.match(service, /Aggregate loan deduction does not equal frozen per-loan applications/i);
  assert.match(service, /if \(snapshot\.version === "P2_V3"\) await persistFrozenLoanRecoveryApplications/);
});

test("rework supersedes applications without repayment or balance mutation", () => {
  assert.match(service, /loanRecoveryApplication\.updateMany\(\{ where: \{ organizationId, payrollRunId: payRunId, state: "FROZEN" \}, data: \{ state: "SUPERSEDED", supersededAt: now \} \}\)/);
  const rejection = service.slice(service.indexOf("export const rejectPayRunForRework"), service.indexOf("export const createReplacementPayRun"));
  assert.doesNotMatch(rejection, /loanRepayment\.(create|update|upsert)/);
  assert.doesNotMatch(rejection, /loanAdvance\.(update|upsert)/);
  assert.doesNotMatch(rejection, /financialSettlement\.(create|update|upsert)/);
});

test("approval contains no repayment commitment or loan balance mutation", () => {
  const approval = service.slice(service.indexOf("export const approvePayRun"), service.indexOf("export const rejectPayRunForRework"));
  assert.doesNotMatch(approval, /loanRepayment\.(create|update|upsert)/);
  assert.doesNotMatch(approval, /loanAdvance\.(update|upsert)/);
  assert.doesNotMatch(approval, /loanRecoveryApplication\.(update|upsert)/);
  assert.doesNotMatch(approval, /financialSettlement\.(create|update|upsert)/);
});

test("only the permanent Payslip branch creates recovery applications", () => {
  const compute = service.slice(service.indexOf("const computeFrozenParticipantResults"), service.indexOf("export const initializePayRunProcessing"));
  const persistenceCall = "await persistFrozenLoanRecoveryApplications(tx";
  assert.equal(compute.split(persistenceCall).length - 1, 1);
  assert.ok(compute.indexOf(persistenceCall) < compute.indexOf('participant.participantType === "CONTRACT"'));
});
