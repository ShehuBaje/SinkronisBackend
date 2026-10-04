import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { Prisma } from "@prisma/client";
import { calculateFrozenExternalPayee, calculatePayrollPreview } from "./payroll.service";
import { payrollBonusSchema, payrollPayeeGroupSchema, payrollProrationOverrideSchema } from "./payroll.validation";

const service = fs.readFileSync(path.resolve("src/modules/payroll/payroll.service.ts"), "utf8");
const adjustments = fs.readFileSync(path.resolve("src/modules/payroll/payroll-adjustments.service.ts"), "utf8");
const routes = fs.readFileSync(path.resolve("src/modules/payroll/payroll.routes.ts"), "utf8");
const swagger = fs.readFileSync(path.resolve("src/config/swagger.ts"), "utf8");
const migration = fs.readFileSync(path.resolve("prisma/migrations/20261004090000_payroll_calculation_input_foundation/migration.sql"), "utf8");

test("R1 payloads enforce group, bonus and proration boundaries", () => {
  assert.equal(payrollPayeeGroupSchema.safeParse({ name: "Contract display group", displayColor: "#1A2b3C" }).success, true);
  assert.equal(payrollBonusSchema.safeParse({ amount: "1000.50", frequency: "ONCE", justification: "Approved award", effectiveFrom: "2026-10-01" }).success, true);
  assert.equal(payrollBonusSchema.safeParse({ amount: 1000, frequency: "ONCE", justification: "Award", effectiveFrom: "2026-10-01", effectiveTo: "2026-10-31" }).success, false);
  assert.equal(payrollProrationOverrideSchema.safeParse({ payFrom: "2026-10-10", payUntil: "2026-10-01", basis: "WORKING_DAYS", justification: "Incorrect range" }).success, false);
});

test("bonus is cash compensation while BIK remains outside the cash/statutory engine", () => {
  const result = calculatePayrollPreview({ salary: { basic: new Prisma.Decimal(100000), housing: new Prisma.Decimal(20000), transport: new Prisma.Decimal(10000), otherAllowance: new Prisma.Decimal(0), additionalAllowances: [], prorationResumeDate: null, prorationMethod: null }, deductions: [], loans: [], period: "2026-10", bonusAmount: new Prisma.Decimal(10000) });
  assert.equal(result.gross, 140000);
  assert.equal("bik" in result, false);
  assert.equal(result.employeePension, 10400, "bonus does not change the pensionable basic/housing/transport basis");
});

test("Contract display classification cannot change locked 5% WHT or pension rules", () => {
  const result = calculateFrozenExternalPayee({ participantType: "CONTRACT", taxRegime: "WHT", monthlyAmount: "100000.00", bonusTotal: "0.00", group: { name: "Contract (Pensionable)", policy: "DISPLAY_ONLY_R1" } });
  assert.equal(result.wht.toFixed(2), "5000.00");
  assert.equal(result.net.toFixed(2), "95000.00");
  assert.equal((result as any).employeePension, undefined);
});

test("freeze captures mutable inputs and durably claims one-off adjustments", () => {
  assert.match(service, /version: "P2_V2"/);
  for (const input of ["group", "bonuses", "bik", "proration", "deductions"]) assert.match(service, new RegExp(`${input}:`));
  assert.match(service, /payrollAdjustmentApplication\.createMany/);
  assert.match(service, /skipDuplicates: true/);
  assert.match(service, /status: "APPLIED"/);
  assert.match(service, /calculationInputSnapshot/);
  assert.match(service, /configuredMonthlyAmount: String\(snapshot\.monthlyAmount\)/);
});

test("proration overrides replace rather than stack with automatic proration", () => {
  assert.match(service, /input\.overrideProrationFactor \?\? payrollProrationFactor/);
  assert.match(adjustments, /overlaps an existing active override/);
  assert.doesNotMatch(service, /attendance/i);
});

test("R1 routes and OpenAPI expose only non-financial management foundation", () => {
  for (const route of ["/settings/payee-groups", "/payees/:payeeId/group", "/payees/:payeeId/bonuses", "/payees/:payeeId/proration-overrides"]) assert.match(routes, new RegExp(route.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  for (const contract of ["PayrollPayeeGroup", "PayrollBonus", "PayrollProrationOverride", "NON_CASH_NO_STATUTORY_EFFECT_R1"]) assert.match(swagger, new RegExp(contract));
  assert.doesNotMatch(routes, /one-time-payment|bulk-payment|wht-remittance/i);
});

test("R1 migration is additive and establishes tenant-safe claim uniqueness", () => {
  for (const table of ["PayrollPayeeGroup", "PayrollBonus", "PayrollProrationOverride", "PayrollAdjustmentApplication"]) assert.ok(migration.includes(`CREATE TABLE \`${table}\``));
  assert.match(migration, /PayrollAdjustmentApplication_bonus_key/);
  assert.match(migration, /PayrollAdjustmentApplication_deduction_key/);
  assert.doesNotMatch(migration, /^\s*(DROP TABLE|TRUNCATE|DELETE FROM)/im);
});
