import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { openApiSpec } from "../../config/swagger";
import { payrollPayRunRejectSchema, payrollPayRunsQuerySchema } from "./payroll.validation";

const service = readFileSync("src/modules/payroll/payroll.service.ts", "utf8");
const routes = readFileSync("src/modules/payroll/payroll.routes.ts", "utf8");
const schema = readFileSync("prisma/schema.prisma", "utf8");
const migration = readFileSync("prisma/migrations/20261005100000_mixed_payroll_review_rework/migration.sql", "utf8");

test("review lifecycle is immutable, run-level, tenant-scoped and financially inert", () => {
  assert.match(schema, /REJECTED_FOR_REWORK/);
  assert.match(service, /status: "APPROVED", approvedAt: now, approvedById: user\.id/);
  assert.match(service, /status: "REJECTED_FOR_REWORK", rejectedAt: now, rejectedById: user\.id, rejectionReason: reason/);
  assert.doesNotMatch(service.slice(service.indexOf("export const approvePayRun"), service.indexOf("export const rejectPayRunForRework")), /FinancialSettlement|walletAccount|Paystack|paymentStatus/);
  assert.match(routes, /pay-runs\/:payRunId\/approve.*payroll:runs:approve/);
  assert.match(routes, /pay-runs\/:payRunId\/reject.*payroll:runs:approve/);
  assert.match(service, /MIXED_PAYROLL_SETTLEMENT_NOT_AVAILABLE/);
  assert.match(service, /EXTERNAL_PAYEE_SETTLEMENT_NOT_AVAILABLE/);
});

test("replacement draft has new identity, lineage, fresh freeze and one-off chain safety", () => {
  assert.match(schema, /replacesPayrollRunId/);
  assert.match(schema, /revisionRootRunId/);
  assert.match(schema, /revisionNumber/);
  assert.match(service, /replacementPayrollRun/);
  assert.match(service, /selectionMode: "REWORK"/);
  assert.match(service, /revisionRootRunId: root/);
  assert.match(service, /One or more one-off payroll adjustments belong to another payroll revision chain/);
  assert.match(service, /status: "SUPERSEDED"/);
  assert.match(service, /status: "ACCEPTED"/);
  assert.match(migration, /UPDATE `PayrollAdjustmentApplication` SET `revisionRootRunId` = `payrollRunId`/);
  assert.match(migration, /PayrollAdjustmentApplication_run_bonus_key/);
  assert.match(migration, /PayrollAdjustmentApplication_run_deduction_key/);
});

test("mixed detail and export preserve frozen authorities and PAYE/WHT separation", () => {
  assert.match(service, /resultType: "PAYSLIP"/);
  assert.match(service, /resultType: "PAYEE_PAYMENT"/);
  assert.match(service, /baseCompensation/);
  assert.match(service, /bonus/);
  assert.match(service, /wht: Number\(payment\.whtAmount\)/);
  assert.match(service, /bik: Object\.keys\(bik\)\.length/);
  assert.match(service, /ParticipantType.*ResultType.*BaseCompensation.*Bonus.*CashGross.*PAYE.*WHT/);
  assert.doesNotMatch(service.slice(service.indexOf("export const exportPayRun"), service.indexOf("const walletForTenant")), /AccountNumber|bankSnapshot/);
});

test("validation and OpenAPI publish rejection, history and normalized results", () => {
  assert.equal(payrollPayRunRejectSchema.safeParse({ reason: "Incorrect allowance" }).success, true);
  assert.equal(payrollPayRunRejectSchema.safeParse({ reason: "x" }).success, false);
  assert.equal(payrollPayRunsQuerySchema.safeParse({ status: "REJECTED_FOR_REWORK" }).success, true);
  const spec = openApiSpec as any;
  assert.ok(spec.paths["/api/v1/payroll/pay-runs/{payRunId}/reject"].post);
  assert.ok(spec.paths["/api/v1/payroll/pay-runs/{payRunId}/replacement"].post);
  assert.ok(spec.paths["/api/v1/payroll/pay-runs/{payRunId}/results/{participantId}"].get);
  assert.match(spec.components.schemas.PayrollPayRunStatus.description, /does not mean paid or settled/);
  assert.match(spec.components.schemas.PayrollMixedResult.description, /Payslip.*PayeePayment/);
});
