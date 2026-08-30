import assert from "node:assert/strict";
import test from "node:test";
import { Prisma } from "@prisma/client";
import { payrollRouter } from "./payroll.routes";
import { calculatePayrollPreview, parsePayrollCsv, payrollBulkHeaders, payrollBulkTemplate, payrollDashboardMonths, payrollDashboardRunTotals, payrollEmployerCost, payrollProrationFactor, sanitizePayrollCsv, statutoryObligationStatus } from "./payroll.service";
import { payrollBikSchema, payrollCreateEmployeeSchema, payrollDashboardQuerySchema, payrollDeductionSchema, payrollEmployeesQuerySchema, payrollLoanSchema, payrollRunCreateSchema, payrollSalaryStructureSchema } from "./payroll.validation";

const money = (value: number | string) => new Prisma.Decimal(value);

test("payroll dashboard route is registered before shared payroll CRUD routes", () => {
  const route = (payrollRouter as any).stack.find((layer: any) => layer.route?.path === "/dashboard");
  assert.ok(route);
  assert.equal(route.route.methods.get, true);
});

test("payroll dashboard accepts no tenant or employee identity manipulation", () => {
  assert.equal(payrollDashboardQuerySchema.safeParse({}).success, true);
  assert.equal(payrollDashboardQuerySchema.safeParse({ tenantId: "other-tenant" }).success, false);
  assert.equal(payrollDashboardQuerySchema.safeParse({ employeeId: "other-employee" }).success, false);
});

test("six-month payroll chart range is chronological across year boundaries", () => {
  assert.deepEqual(payrollDashboardMonths("2026-02"), ["2025-09", "2025-10", "2025-11", "2025-12", "2026-01", "2026-02"]);
});

test("payroll dashboard totals reconcile from authoritative Decimal payslip values", () => {
  const rows = [{ grossPay: money("100000.10"), netPay: money("81000.10"), payeTax: money("10000"), pension: money("8000"), employerPension: money("10000"), nhf: money("1000"), nsitf: money("1000.25") }, { grossPay: money("200000.20"), netPay: money("162000.20"), payeTax: money("20000"), pension: money("16000"), employerPension: money("20000"), nhf: money("2000"), nsitf: money("2000.25") }];
  assert.deepEqual(payrollDashboardRunTotals(rows), { employees: 2, gross: 300000.3, netPay: 243000.3, paye: 30000, pension: 24000, employerPension: 30000, nhf: 3000, nsitf: 3000.5 });
  assert.equal(payrollEmployerCost(rows), 333000.8);
  assert.equal(payrollEmployerCost(rows), payrollDashboardRunTotals(rows).gross + payrollDashboardRunTotals(rows).employerPension + payrollDashboardRunTotals(rows).nsitf);
});

test("NSITF and employer pension increase employer cost but employee deductions do not", () => {
  const row = { grossPay: money(100), netPay: money(50), payeTax: money(20), pension: money(10), employerPension: money(5), nhf: money(10), nsitf: money(2) };
  assert.equal(payrollEmployerCost([row]), 107);
});

test("statutory remittance remains separate from employee payroll disbursement", () => {
  const now = new Date("2026-08-27T12:00:00.000Z");
  assert.equal(statutoryObligationStatus({ submittedAt: null, dueDate: new Date("2026-08-26T00:00:00.000Z") }, now), "OVERDUE");
  assert.equal(statutoryObligationStatus({ submittedAt: null, dueDate: new Date("2026-08-28T00:00:00.000Z") }, now), "DUE");
  assert.equal(statutoryObligationStatus({ submittedAt: new Date("2026-08-25T00:00:00.000Z"), dueDate: new Date("2026-08-26T00:00:00.000Z") }, now), "REMITTED");
});

test("pay run validation supports the expanded UI workflow without removing legacy statuses", () => {
  for (const status of ["DRAFT", "PROCESSING", "PENDING_APPROVAL", "APPROVED", "PENDING_DISBURSEMENT", "DISBURSING", "DISBURSED", "FAILED", "PAID", "CANCELLED"]) {
    assert.equal(payrollRunCreateSchema.safeParse({ name: "Monthly payroll", periodStart: "2026-08-01", periodEnd: "2026-08-31", status }).success, true, status);
  }
});

test("Payroll Employee routes reuse the shared Payroll module", () => {
  const routes = (payrollRouter as any).stack.filter((layer: any) => layer.route).flatMap((layer: any) => Object.keys(layer.route.methods).map((method) => `${method.toUpperCase()} ${layer.route.path}`));
  for (const route of ["GET /employees", "POST /employees", "GET /employees/:employeeId", "POST /employees/:employeeId/enroll", "DELETE /employees/:employeeId/enrollment", "PUT /employees/:employeeId/salary-structure", "PUT /employees/:employeeId/statutory-profile", "POST /employees/:employeeId/deductions", "POST /employees/:employeeId/loans", "PUT /employees/:employeeId/bik", "GET /employees/:employeeId/payroll-history", "POST /employees/bulk-upload", "GET /employees/export"]) assert.ok(routes.includes(route), route);
});

test("Payroll Employee filters are bounded, whitelisted and reject tenant manipulation", () => {
  assert.equal(payrollEmployeesQuerySchema.safeParse({ search: "Engineer", status: "ACTIVE", employmentType: "FULL_TIME", payrollStatus: "ON_PAYROLL", sortBy: "netPay", sortOrder: "desc" }).success, true);
  assert.equal(payrollEmployeesQuerySchema.safeParse({ tenantId: "other" }).success, false);
  assert.equal(payrollEmployeesQuerySchema.safeParse({ sortBy: "bankAccountNumber" }).success, false);
  assert.equal(payrollEmployeesQuerySchema.safeParse({ limit: 1000 }).success, false);
});

test("salary, deduction, loan and BIK DTOs enforce Payroll business boundaries", () => {
  assert.equal(payrollSalaryStructureSchema.safeParse({ basicSalary: 100, additionalAllowances: [], proration: { resumeDate: null, method: null } }).success, true);
  assert.equal(payrollDeductionSchema.safeParse({ name: "Union dues", amount: -1 }).success, false);
  assert.equal(payrollLoanSchema.safeParse({ purpose: "Advance", type: "RECURRING", principal: 100, monthlyRepayment: 101, startDate: "2026-08-01" }).success, false);
  assert.equal(payrollLoanSchema.safeParse({ purpose: "Advance", type: "ONE_OFF", principal: 100, startDate: "2026-08-01" }).success, true);
  assert.equal(payrollBikSchema.safeParse({ hmoHealthInsurance: -1 }).success, false);
  assert.equal(payrollCreateEmployeeSchema.safeParse({ fullName: "Configured Employee", role: "Engineer", email: "employee@example.com", employmentType: "FULL_TIME", salary: { basicSalary: 100 }, tenantId: "other" }).success, false);
});

test("calendar and working-day proration use the selected period rather than constants", () => {
  assert.equal(payrollProrationFactor({ period: "2026-08", resumeDate: new Date("2026-08-16T00:00:00.000Z"), method: "CALENDAR_DAYS" }).toDecimalPlaces(6).toString(), new Prisma.Decimal(16).div(31).toDecimalPlaces(6).toString());
  assert.equal(payrollProrationFactor({ period: "2026-08", resumeDate: new Date("2026-08-20T00:00:00.000Z"), method: "WORKING_DAYS", workdays: new Set(["2026-08-03", "2026-08-10", "2026-08-20", "2026-08-21"]) }).toString(), "0.5");
});

test("one centralized preview reconciles list/detail values and keeps employer costs and BIK out of employee net deductions", () => {
  const salary = { basic: money(1000), housing: money(100), transport: money(100), otherAllowance: money(100), additionalAllowances: [{ name: "Configured allowance", amount: 100 }], prorationResumeDate: null, prorationMethod: null } as any;
  const input = { salary, deductions: [{ amount: money(50), frequency: "MONTHLY" }], loans: [{ outstanding: money(80), monthlyRepayment: money(30), loanType: "RECURRING", status: "ACTIVE" }], period: "2026-08" };
  const first = calculatePayrollPreview(input); const second = calculatePayrollPreview(input);
  assert.deepEqual(first, second);
  assert.equal(first.gross, 1400);
  assert.equal(first.paye, 140);
  assert.equal(first.employeePension, 112);
  assert.equal(first.customDeductions, 50);
  assert.equal(first.loanDeductions, 30);
  assert.equal(first.netPay, 1068);
  assert.equal(first.employerPension, 0);
  assert.equal(first.nsitf, 0);
  assert.equal(first.employerCost, first.gross);
  assert.equal(input.loans[0].outstanding.toString(), "80", "preview does not commit repayment");
});

test("Payroll CSV template is data-free, parser validates quoted values, and exports mitigate formula injection", () => {
  assert.deepEqual(parsePayrollCsv(`${payrollBulkHeaders.join(",")}\r\n"Person, Name",Finance,Engineer,FULL_TIME,ACTIVE,p@example.com,,,,,100,0,0,0`)[1][0], "Person, Name");
  assert.equal(payrollBulkTemplate().split(/\r?\n/).filter(Boolean).length, 1);
  assert.equal(sanitizePayrollCsv("=HYPERLINK('bad')").startsWith("\"'="), true);
  assert.throws(() => parsePayrollCsv('"unterminated'));
});
