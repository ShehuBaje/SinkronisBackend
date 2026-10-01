import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { Prisma } from "@prisma/client";
import { calculatePayrollPreview, calculateUnifiedExternalPayee, projectPayrollPayee } from "./payroll.service";
import { payrollPayeeSchema, payrollPayeesQuerySchema } from "./payroll.validation";

const money = (value: Prisma.Decimal.Value) => new Prisma.Decimal(value);
const permanentRow = (overrides: Record<string, unknown> = {}) => ({
  id: "payee-permanent",
  organizationId: "tenant-one",
  employeeId: "employee-one",
  name: null,
  type: "PERMANENT",
  status: "ACTIVE",
  taxRegime: "PAYE",
  externalOnPayroll: null,
  monthlyAmount: null,
  isTaxable: true,
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
  updatedAt: new Date("2026-01-01T00:00:00.000Z"),
  employee: {
    id: "employee-one",
    firstName: "Ada",
    lastName: "Okafor",
    email: "ada@example.test",
    phone: "+2348000000000",
    jobTitle: "Engineer",
    hireDate: new Date("2025-01-01T00:00:00.000Z"),
    lifecycleStatus: "CONFIRMED",
    status: "ACTIVE",
    taxId: null,
    pensionPin: null,
    bankName: "Example Bank",
    bankCode: "058",
    bankAccountNumber: "0123456789",
    bankAccountName: "Ada Okafor",
    payrollEnrollment: { isActive: true },
    payrollStatutoryProfile: { tin: "TIN", pensionPin: "PIN", pfaName: "PFA", nhfNumber: "NHF" },
    payrollDeductions: [],
    loans: [],
    payrollAvcs: [],
    salaryStructures: [{ basic: money(100000), housing: money(20000), transport: money(10000), otherAllowance: money(5000), additionalAllowances: [], prorationResumeDate: null, prorationMethod: null }]
  },
  ...overrides
});

test("Permanent projection reads identity, payroll participation, salary, statutory and bank data from Employee", () => {
  const projected = projectPayrollPayee(permanentRow(), true) as any;
  assert.equal(projected.name, "Ada Okafor");
  assert.equal(projected.onPayroll, true);
  assert.equal(projected.grossSalary, 135000);
  assert.equal(projected.taxStatus, "PAYE");
  assert.equal(projected.salarySource, "SalaryStructure");
  assert.equal(projected.statutorySource, "PayrollStatutoryProfile");
  assert.equal(projected.finalizedNetSource, "Payslip.netPay");
  assert.equal(projected.bank.accountNumber, "******6789");
  assert.equal(projected.statutoryCompleteness.complete, true);
});

test("Permanent projection derives off-payroll and Employee lifecycle precedence without duplicate Payee state", () => {
  const row = permanentRow() as any;
  row.employee.payrollEnrollment.isActive = false;
  row.employee.lifecycleStatus = "EXITED";
  row.status = "ACTIVE";
  const projected = projectPayrollPayee(row) as any;
  assert.equal(projected.onPayroll, false);
  assert.equal(projected.status, "INACTIVE");
});

test("legacy Payees remain readable and are never interpreted as WHT/PAYE/EXEMPT", () => {
  const projected = projectPayrollPayee({ id: "legacy", employeeId: null, name: "Legacy", type: "CONTRACTOR", status: "ACTIVE", taxRegime: "LEGACY_UNSPECIFIED", externalOnPayroll: null, monthlyAmount: money(100000), isTaxable: true, bankName: null, bankCode: null, accountNumber: null, externalRole: null, dateOnboarded: null, email: null, phone: null }) as any;
  assert.equal(projected.legacy, true);
  assert.equal(projected.taxStatus, "LEGACY_UNSPECIFIED");
  assert.equal(projected.calculationStatus, "LEGACY_UNSPECIFIED");
  assert.equal(projected.estimatedNetSalary, 90000, "legacy behavior remains the previous 10% compatibility calculation, not new 5% WHT");
});

test("new Payee type rules reject contradictory or legacy creation inputs", () => {
  assert.equal(payrollPayeeSchema.safeParse({ type: "PERMANENT", employeeId: "cllllllllllllllllllllllll", taxRegime: "PAYE" }).success, true);
  assert.equal(payrollPayeeSchema.safeParse({ type: "CONTRACT", name: "Contract Payee", monthlyAmount: 100000, taxRegime: "WHT" }).success, true);
  assert.equal(payrollPayeeSchema.safeParse({ type: "CONSULTANT", name: "Consultant", monthlyAmount: 100000, taxRegime: "EXEMPT" }).success, true);
  for (const input of [{ type: "PERMANENT", employeeId: "cllllllllllllllllllllllll", taxRegime: "WHT" }, { type: "CONTRACT", name: "Contract", monthlyAmount: 1, taxRegime: "EXEMPT" }, { type: "CONSULTANT", name: "Consultant", monthlyAmount: 1, taxRegime: "PAYE" }, { type: "CONTRACTOR", name: "Legacy", monthlyAmount: 1, taxRegime: "LEGACY_UNSPECIFIED" }]) assert.equal(payrollPayeeSchema.safeParse(input).success, false);
});

test("Contract and Consultant configured projections preserve the approved rates", () => {
  const contract = calculateUnifiedExternalPayee("CONTRACT", money(100000));
  assert.equal(contract.taxAmount.toString(), "5000");
  assert.equal(contract.netAmount.toString(), "95000");
  assert.equal(contract.employeePension.toString(), "0");
  assert.equal(contract.employerPension.toString(), "0");
  assert.equal(contract.nhf.toString(), "0");
  const consultant = calculateUnifiedExternalPayee("CONSULTANT", money(100000));
  assert.equal(consultant.taxAmount.toString(), "0");
  assert.equal(consultant.netAmount.toString(), "100000");
});

test("Permanent payroll rates remain 8% employee pension, 10% employer pension and 2.5% NHF", () => {
  const result = calculatePayrollPreview({ salary: { basic: money(100000), housing: money(20000), transport: money(10000), otherAllowance: money(0), additionalAllowances: [], prorationResumeDate: null, prorationMethod: null }, deductions: [{ amount: money(1000), frequency: "MONTHLY" }], loans: [{ status: "ACTIVE", loanType: "RECURRING", outstanding: money(5000), monthlyRepayment: money(2000) }], period: "2026-10" });
  assert.equal(result.employeePension, 10400);
  assert.equal(result.employerPension, 13000);
  assert.equal(result.nhf, 2500);
  assert.equal(result.customDeductions, 1000);
  assert.equal(result.loanDeductions, 2000);
  assert.equal(result.employerCost, result.gross + result.employerPension + result.nsitf);
});

test("Payee list query allows approved filters while rejecting tenant input and unsafe sort keys", () => {
  assert.equal(payrollPayeesQuerySchema.safeParse({ search: "Ada", type: "PERMANENT", status: "ACTIVE", onPayroll: "true", taxStatus: "PAYE", sortBy: "gross", sortOrder: "desc", page: 1, limit: 20 }).success, true);
  assert.equal(payrollPayeesQuerySchema.safeParse({ type: "CONTRACTOR", taxStatus: "LEGACY_UNSPECIFIED" }).success, true);
  assert.equal(payrollPayeesQuerySchema.safeParse({ organizationId: "other" }).success, false);
  assert.equal(payrollPayeesQuerySchema.safeParse({ sortBy: "accountNumber" }).success, false);
});

test("P1 migration is additive, preserves legacy rows and backfills deterministic Permanent links", () => {
  const sql = readFileSync("prisma/migrations/20261002100000_unified_payee_foundation/migration.sql", "utf8");
  assert.match(sql, /ADD COLUMN `employeeId`/);
  assert.match(sql, /LEGACY_UNSPECIFIED/);
  assert.match(sql, /FROM `PayrollEnrollment` AS enrollment/);
  assert.match(sql, /employee\.`organizationId` = enrollment\.`organizationId`/);
  assert.match(sql, /IF\(enrollment\.`isActive`, 'ACTIVE', 'INACTIVE'\)/);
  assert.match(sql, /ON DUPLICATE KEY UPDATE/);
  assert.doesNotMatch(sql, /UPDATE\s+`Payee`\s+SET\s+`type`/i);
  for (const forbidden of ["PayeePayment", "Payslip", "PayrollRun", "FinancialSettlement", "PayrollWallet"]) assert.equal(sql.includes(`ALTER TABLE \`${forbidden}\``), false, forbidden);
});

test("historical TaxReport migration keeps dueDate creation separate from its TiDB index", () => {
  const sql = readFileSync("prisma/migrations/20260827140000_payroll_dashboard_authoritative_fields/migration.sql", "utf8");
  const column = "ADD COLUMN `dueDate` DATETIME(3) NULL;";
  const index = "CREATE INDEX `TaxReport_org_period_due_idx`";
  assert.ok(sql.includes(column));
  assert.ok(sql.includes(index));
  assert.ok(sql.indexOf(column) < sql.indexOf(index));
  assert.doesNotMatch(sql, /ADD COLUMN `dueDate`[^;]*ADD INDEX/s);
});
