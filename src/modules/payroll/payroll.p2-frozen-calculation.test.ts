import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { calculateFrozenExternalPayee } from "./payroll.service";

const source = fs.readFileSync(path.resolve("src/modules/payroll/payroll.service.ts"), "utf8");
const routes = fs.readFileSync(path.resolve("src/modules/payroll/payroll.routes.ts"), "utf8");
const controller = fs.readFileSync(path.resolve("src/modules/payroll/payroll.controller.ts"), "utf8");
const swagger = fs.readFileSync(path.resolve("src/config/swagger.ts"), "utf8");
const migration = fs.readFileSync(path.resolve("prisma/migrations/20261004100000_frozen_mixed_pay_run_calculation/migration.sql"), "utf8");

test("Contract frozen calculation uses Decimal-safe 5% WHT", () => {
  const result = calculateFrozenExternalPayee({ participantType: "CONTRACT", taxRegime: "WHT", monthlyAmount: "100000.00" });
  assert.equal(result.gross.toFixed(2), "100000.00");
  assert.equal(result.whtRate.toString(), "0.05");
  assert.equal(result.wht.toFixed(2), "5000.00");
  assert.equal(result.net.toFixed(2), "95000.00");
  assert.deepEqual(result.rule, { regime: "WHT", code: "CONTRACT_WHT", version: "P2_V1", rate: "0.05" });
});

test("Consultant frozen calculation is explicitly EXEMPT", () => {
  const result = calculateFrozenExternalPayee({ participantType: "CONSULTANT", taxRegime: "EXEMPT", monthlyAmount: "100000.00" });
  assert.equal(result.wht.toFixed(2), "0.00");
  assert.equal(result.net.toFixed(2), "100000.00");
  assert.deepEqual(result.rule, { regime: "EXEMPT", code: "CONSULTANT_EXEMPT", version: "P2_V1", rate: "0" });
});

test("external calculation fails closed for legacy or contradictory tax semantics", () => {
  assert.throws(() => calculateFrozenExternalPayee({ participantType: "CONTRACTOR", taxRegime: "LEGACY_UNSPECIFIED", monthlyAmount: "100000" }));
  assert.throws(() => calculateFrozenExternalPayee({ participantType: "CONTRACT", taxRegime: "EXEMPT", monthlyAmount: "100000" }));
});

test("Process freezes only unified DRAFT membership and enqueues after commit", () => {
  const body = source.slice(source.indexOf("export const processDraftPayRun"), source.indexOf("export const calculateFrozenExternalPayee"));
  assert.match(body, /status: "DRAFT"/);
  assert.match(body, /membershipVersion: "UNIFIED_PAYEE_V1"/);
  assert.match(body, /calculationSnapshot: enrichedFrozenParticipantSnapshot/);
  assert.match(body, /participantsFrozenAt: now/);
  assert.match(body, /PAYROLL_PARTICIPANTS_INELIGIBLE/);
  assert.ok(body.indexOf("await prisma.$transaction") < body.indexOf("enqueuePayrollJob"));
});

test("unified batching derives work only from frozen participant IDs", () => {
  const body = source.slice(source.indexOf("export const initializePayRunCalculation"), source.indexOf("export const processPayRunBatch"));
  assert.match(body, /payrollRunParticipant\.findMany/);
  assert.match(body, /frozenAt: \{ not: null \}/);
  assert.match(body, /participantIds: participants\.map/);
  assert.match(body, /payRunEmployeeWhere/); // retained only for LEGACY_EMPLOYEE recovery
});

test("mixed processing partitions results and aggregates PAYE and WHT separately", () => {
  const body = source.slice(source.indexOf("const computeFrozenParticipantResults"), source.indexOf("export const initializePayRunCalculation"));
  assert.match(body, /participantType === "PERMANENT"/);
  assert.match(body, /tx\.payslip\.upsert/);
  assert.match(body, /participantType === "CONTRACT"/);
  assert.match(body, /participantType === "CONSULTANT"/);
  assert.match(body, /tx\.payeePayment\.upsert/);
  assert.match(body, /totals\.paye/);
  assert.match(body, /totals\.wht/);
});

test("batch completion uses conditional exactly-once aggregation and reconciles expected results", () => {
  const body = source.slice(source.indexOf("export const processPayRunBatch"), source.indexOf("export const failPayRunBatch"));
  assert.match(body, /status: "PROCESSING"/);
  assert.match(body, /if \(completed\.count\)/);
  assert.match(body, /processedParticipantCount/);
  assert.match(source, /payslips === run\.permanentEmployeeCount/);
  assert.match(source, /external === run\.externalPayeeCount/);
  assert.match(body, /status: "PENDING_APPROVAL"/);
  assert.match(source, /reconcileUnifiedPayRunCompletion/);
  assert.match(source, /Frozen payroll processing result reconciliation failed/);
});

test("mixed approval is run-level and remains financially inert after P2.3", () => {
  const body = source.slice(source.indexOf("export const approvePayRun"), source.indexOf("export const rejectPayRunForRework"));
  assert.match(body, /status: "PENDING_APPROVAL"/);
  assert.match(body, /status: "APPROVED"/);
  assert.doesNotMatch(body, /FinancialSettlement|wallet|Paystack|paymentStatus/);
});

test("process route requires the existing payroll:runs:update permission", () => {
  assert.match(routes, /post\("\/pay-runs\/:payRunId\/process", authorize\("payroll:runs:update"\)/);
  assert.match(controller, /processDraftPayRunController/);
  assert.match(swagger, /Freeze and process a DRAFT pay run/);
});

test("P2.2 migration is additive and does not rewrite historical financial amounts", () => {
  assert.match(migration, /ADD COLUMN `participantIds` JSON NULL/);
  assert.match(migration, /ADD COLUMN `calculationInputSnapshot` JSON NULL/);
  assert.match(migration, /ADD COLUMN `whtAmount`/);
  assert.match(migration, /PayeePayment_participantId_key/);
  assert.doesNotMatch(migration, /^\s*(DELETE FROM|TRUNCATE|DROP TABLE)/im);
  assert.doesNotMatch(migration, /UPDATE `Payslip`|UPDATE `PayeePayment`|UPDATE `Wallet|UPDATE `Financial/);
});
