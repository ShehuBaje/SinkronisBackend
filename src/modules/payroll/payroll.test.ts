import assert from "node:assert/strict";
import test from "node:test";
import { Prisma } from "@prisma/client";
import { payrollRouter } from "./payroll.routes";
import { assertUnifiedPayeeTypeTax, buildLoanSchedule, calculatePayeePayroll, calculatePayrollPreview, calculateUnifiedExternalPayee, externalPayeeLifecycleTransition, inspectPayrollPayeeDocument, parsePayrollCsv, parsePayrollPayeeCsv, payrollAcceptedReportingStatuses, payrollBulkHeaders, payrollBulkTemplate, payrollDashboardMonths, payrollDashboardRunTotals, payrollEmployerCost, payrollGroupDistribution, payrollMixedRunTotals, payrollPayeeLifecycleStatus, payrollPensionSnapshotTotals, payrollProrationFactor, payrollVariance, payrollWalletShortfall, payRunAvailableActions, sanitizePayrollCsv, statutoryObligationStatus, walletBalanceAfter } from "./payroll.service";
import { effectiveMonthlyPayDate } from "./payroll.service";
import { payrollAllowanceTypeSchema, payrollDeductionTypeSchema, payrollPayPeriodSettingsSchema } from "./payroll.validation";
import { payrollAdjustLoanSchema, payrollAvcCreateSchema, payrollBikSchema, payrollCreateCustomDeductionSchema, payrollCreateEmployeeSchema, payrollCreateLoanSchema, payrollDashboardQuerySchema, payrollDeductionSchema, payrollEmployeesQuerySchema, payrollLoanSchema, payrollLoansQuerySchema, payrollPayeeSchema, payrollPayeesQuerySchema, payrollPayeeUpdateSchema, payrollPayRunCreateSchema, payrollPayRunEligibilityQuerySchema, payrollPayRunsQuerySchema, payrollPayslipsQuerySchema, payrollPfaTransferAdvanceSchema, payrollPfaTransferCreateSchema, payrollReportsBankQuerySchema, payrollReportsDepartmentQuerySchema, payrollReportsSummaryQuerySchema, payrollReportsVarianceQuerySchema, payrollReportsYtdQuerySchema, payrollSalaryStructureSchema, payrollSettlementSchema, payrollTaxAnnualQuerySchema, payrollTaxEmployeesQuerySchema, payrollTaxRemittancesQuerySchema, payrollWalletFundSchema, payrollWalletTransactionsQuerySchema } from "./payroll.validation";

const money = (value: number | string) => new Prisma.Decimal(value);

test("payroll settlement requires explicit manual evidence while provider preparation does not", () => {
  assert.equal(payrollSettlementSchema.safeParse({ settlementMethod: "MANUAL", idempotencyKey: "payroll-run-1", externalReference: "BANK-BATCH-1", settledAt: "2026-09-18T10:00:00.000Z", note: "Authorized salary batch" }).success, true);
  assert.equal(payrollSettlementSchema.safeParse({ settlementMethod: "MANUAL", idempotencyKey: "payroll-run-1" }).success, false);
  assert.equal(payrollSettlementSchema.safeParse({ settlementMethod: "PROVIDER", idempotencyKey: "payroll-run-1" }).success, true);
});

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
  assert.equal(first.paye, 0);
  assert.equal(first.employeePension, 96);
  assert.equal(first.customDeductions, 50);
  assert.equal(first.loanDeductions, 30);
  assert.equal(first.netPay, 1199);
  assert.equal(first.employerPension, 120);
  assert.equal(first.nsitf, 14);
  assert.equal(first.employerCost, 1534);
  assert.equal(input.loans[0].outstanding.toString(), "80", "preview does not commit repayment");
});

test("Payroll Settings routes stay in the existing Payroll module", () => {
  const routes = (payrollRouter as any).stack.filter((layer: any) => layer.route).flatMap((layer: any) => Object.keys(layer.route.methods).map((method) => `${method.toUpperCase()} ${layer.route.path}`));
  for (const route of ["GET /settings", "GET /settings/pay-period", "PUT /settings/pay-period", "GET /settings/allowance-types", "POST /settings/allowance-types", "PATCH /settings/allowance-types/:id", "DELETE /settings/allowance-types/:id", "GET /settings/deduction-types", "POST /settings/deduction-types", "PATCH /settings/deduction-types/:id", "DELETE /settings/deduction-types/:id", "GET /settings/statutory-rates"]) assert.ok(routes.includes(route), route);
});

test("superseded generic Payroll CRUD and queued generation routes are not exposed", () => {
  const routePaths = (payrollRouter as any).stack.filter((layer: any) => layer.route).map((layer: any) => String(layer.route.path));
  assert.equal(routePaths.some((path: string) => path.startsWith("/salary-structures")), false);
  assert.equal(routePaths.some((path: string) => path.startsWith("/statutory")), false);
  assert.equal(routePaths.some((path: string) => path.includes("generate-payslips")), false);
});

test("pay-period settings expose only supported monthly payroll and validate day", () => {
  assert.equal(payrollPayPeriodSettingsSchema.safeParse({ payFrequency: "MONTHLY", defaultPayDay: 31 }).success, true);
  assert.equal(payrollPayPeriodSettingsSchema.safeParse({ payFrequency: "WEEKLY", defaultPayDay: 25 }).success, false);
  assert.equal(payrollPayPeriodSettingsSchema.safeParse({ payFrequency: "MONTHLY", defaultPayDay: 0 }).success, false);
  assert.equal(payrollPayPeriodSettingsSchema.safeParse({ payFrequency: "MONTHLY", defaultPayDay: 32 }).success, false);
});

test("monthly pay day clamps safely to each calendar month", () => {
  assert.equal(effectiveMonthlyPayDate("2027-01", 31).toISOString(), "2027-01-31T00:00:00.000Z");
  assert.equal(effectiveMonthlyPayDate("2027-02", 31).toISOString(), "2027-02-28T00:00:00.000Z");
  assert.equal(effectiveMonthlyPayDate("2028-02", 31).toISOString(), "2028-02-29T00:00:00.000Z");
  assert.equal(effectiveMonthlyPayDate("2027-04", 31).toISOString(), "2027-04-30T00:00:00.000Z");
});

test("allowance and deduction setting payloads reject ownership and system flags", () => {
  assert.equal(payrollAllowanceTypeSchema.safeParse({ name: "Field allowance", taxTreatment: "TAXABLE" }).success, true);
  assert.equal(payrollAllowanceTypeSchema.safeParse({ name: "Field allowance", taxTreatment: "TAX_EXEMPT" }).success, true);
  assert.equal(payrollAllowanceTypeSchema.safeParse({ name: "Field allowance", taxTreatment: "TAXABLE", tenantId: "other" }).success, false);
  assert.equal(payrollDeductionTypeSchema.safeParse({ name: "Cooperative dues" }).success, true);
  assert.equal(payrollDeductionTypeSchema.safeParse({ name: "Fake PAYE", category: "STATUTORY" }).success, false);
});

test("tax-exempt additional allowances increase gross but not PAYE base", () => {
  const base = { basic: money(100000), housing: money(0), transport: money(0), otherAllowance: money(0), prorationResumeDate: null, prorationMethod: null } as any;
  const taxable = calculatePayrollPreview({ salary: { ...base, additionalAllowances: [{ name: "Field", amount: 10000, taxable: true }] }, deductions: [], loans: [], period: "2027-01" });
  const exempt = calculatePayrollPreview({ salary: { ...base, additionalAllowances: [{ name: "Field", amount: 10000, taxable: false }] }, deductions: [], loans: [], period: "2027-01" });
  assert.equal(taxable.gross, exempt.gross);
  assert.ok(taxable.paye > exempt.paye);
  assert.equal(taxable.statutoryRuleVersion, "NG-2026-NTA");
});

test("Payroll CSV template is data-free, parser validates quoted values, and exports mitigate formula injection", () => {
  assert.deepEqual(parsePayrollCsv(`${payrollBulkHeaders.join(",")}\r\n"Person, Name",Finance,Engineer,FULL_TIME,ACTIVE,p@example.com,,,,,100,0,0,0`)[1][0], "Person, Name");
  assert.equal(payrollBulkTemplate().split(/\r?\n/).filter(Boolean).length, 1);
  assert.equal(sanitizePayrollCsv("=HYPERLINK('bad')").startsWith("\"'="), true);
  assert.throws(() => parsePayrollCsv('"unterminated'));
});

test("Payroll Payee routes remain inside the shared Payroll module", () => {
  const routes = (payrollRouter as any).stack.filter((layer: any) => layer.route).flatMap((layer: any) => Object.keys(layer.route.methods).map((method) => `${method.toUpperCase()} ${layer.route.path}`));
  for (const route of ["GET /payees", "POST /payees", "POST /payees/bulk", "GET /payees/export", "GET /payees/:payeeId", "PATCH /payees/:payeeId", "PATCH /payees/:payeeId/toggle-payroll", "DELETE /payees/:payeeId", "GET /payees/:payeeId/payment-history", "GET /payees/:payeeId/payment-history/export", "GET /payees/:payeeId/documents", "POST /payees/:payeeId/documents", "GET /payees/:payeeId/documents/:documentId/download"]) assert.ok(routes.includes(route), route);
});

test("new Payee creation accepts only explicit unified type and tax combinations", () => {
  assert.equal(payrollPayeeSchema.safeParse({ type: "PERMANENT", employeeId: "cllllllllllllllllllllllll", taxRegime: "PAYE" }).success, true);
  assert.equal(payrollPayeeSchema.safeParse({ type: "CONTRACT", name: "Example Contractor", monthlyAmount: "100000.25", taxRegime: "WHT" }).success, true);
  assert.equal(payrollPayeeSchema.safeParse({ type: "CONSULTANT", name: "Example Consultant", monthlyAmount: "100000.25", taxRegime: "EXEMPT" }).success, true);
  for (const type of ["CONTRACTOR", "VENDOR", "DIRECTOR", "BOARD_MEMBER"]) assert.equal(payrollPayeeSchema.safeParse({ name: "Legacy Payee", type, monthlyAmount: 100 }).success, false, type);
  assert.equal(payrollPayeeSchema.safeParse({ type: "PERMANENT", employeeId: "cllllllllllllllllllllllll", taxRegime: "WHT" }).success, false);
  assert.equal(payrollPayeeSchema.safeParse({ type: "CONTRACT", name: "Example", monthlyAmount: 100, taxRegime: "EXEMPT" }).success, false);
  assert.equal(payrollPayeeSchema.safeParse({ type: "CONSULTANT", name: "Example", monthlyAmount: 100, taxRegime: "PAYE" }).success, false);
  assert.equal(payrollPayeeSchema.safeParse({ name: "Example Payee", type: "VENDOR", monthlyAmount: "₦100,000" }).success, false);
  assert.equal(payrollPayeeSchema.safeParse({ name: "Example Payee", type: "VENDOR", monthlyAmount: -1 }).success, false);
  assert.equal(payrollPayeeUpdateSchema.safeParse({ isTaxable: false }).success, true);
});

test("Payee list filters combine safely and reject tenant or unsafe sort input", () => {
  assert.equal(payrollPayeesQuerySchema.safeParse({ search: "tech", type: "CONTRACTOR", status: "ACTIVE", lifecycleStatus: "INACTIVE", taxable: "false", sortBy: "amount", sortOrder: "desc", page: 1, limit: 20 }).success, true);
  assert.equal(payrollPayeesQuerySchema.safeParse({ lifecycleStatus: "PENDING" }).success, false);
  assert.equal(payrollPayeesQuerySchema.safeParse({ tenantId: "another-tenant" }).success, false);
  assert.equal(payrollPayeesQuerySchema.safeParse({ sortBy: "accountNumber" }).success, false);
  assert.equal(payrollPayeesQuerySchema.safeParse({ limit: 101 }).success, false);
});

test("R5 derives the two-state client lifecycle without collapsing source status", () => {
  const permanent = (status: string, lifecycleStatus: string, enrolled: boolean) => ({ type: "PERMANENT", deletedAt: null, employee: { status, lifecycleStatus, payrollEnrollment: { isActive: enrolled } } });
  assert.equal(payrollPayeeLifecycleStatus(permanent("ACTIVE", "CONFIRMED", true)), "ACTIVE");
  assert.equal(payrollPayeeLifecycleStatus(permanent("ACTIVE", "CONFIRMED", false)), "INACTIVE");
  for (const status of ["ON_LEAVE", "SUSPENDED", "TERMINATED"]) assert.equal(payrollPayeeLifecycleStatus(permanent(status, "CONFIRMED", true)), "INACTIVE");
  assert.equal(payrollPayeeLifecycleStatus(permanent("ACTIVE", "EXITED", true)), "INACTIVE");
  for (const type of ["CONTRACT", "CONSULTANT"]) {
    assert.equal(payrollPayeeLifecycleStatus({ type, status: "ACTIVE", externalOnPayroll: true, deletedAt: null }), "ACTIVE");
    assert.equal(payrollPayeeLifecycleStatus({ type, status: "ACTIVE", externalOnPayroll: false, deletedAt: null }), "INACTIVE");
    for (const status of ["INACTIVE", "ON_LEAVE", "SUSPENDED"]) assert.equal(payrollPayeeLifecycleStatus({ type, status, externalOnPayroll: true, deletedAt: null }), "INACTIVE");
  }
  assert.equal(payrollPayeeLifecycleStatus({ type: "CONTRACT", status: "ACTIVE", externalOnPayroll: true, deletedAt: new Date() }), "INACTIVE");
});

test("R5 external lifecycle transitions normalize ACTIVE deactivation and preserve detailed inactive states", () => {
  assert.deepEqual(externalPayeeLifecycleTransition("ACTIVE", false), { status: "INACTIVE", externalOnPayroll: false });
  assert.deepEqual(externalPayeeLifecycleTransition("INACTIVE", false), { status: "INACTIVE", externalOnPayroll: false });
  assert.deepEqual(externalPayeeLifecycleTransition("ON_LEAVE", false), { status: "ON_LEAVE", externalOnPayroll: false });
  assert.deepEqual(externalPayeeLifecycleTransition("SUSPENDED", false), { status: "SUSPENDED", externalOnPayroll: false });
  for (const status of ["INACTIVE", "ON_LEAVE", "SUSPENDED"]) assert.deepEqual(externalPayeeLifecycleTransition(status, true), { status: "ACTIVE", externalOnPayroll: true });
});

test("mixed dashboard totals use frozen PayrollRun aggregates without merging PAYE and WHT", () => {
  const permanent = [{ grossPay: money(100000), netPay: money(70000), payeTax: money(10000), pension: money(8000), employerPension: money(10000), nhf: money(2500), nsitf: money(1000) }];
  const totals = payrollMixedRunTotals({ membershipVersion: "UNIFIED_PAYEE_V1", participantCount: 3, permanentEmployeeCount: 1, externalPayeeCount: 2, employeeCount: 1, totalGross: money(300000), totalPaye: money(10000), totalPension: money(8000), totalEmployerPension: money(10000), totalNhf: money(2500), totalLoans: money(0), totalOtherDeductions: money(0), totalNetPay: money(265000), totalWht: money(5000), totalPermanentNetPay: money(70000), totalExternalNetPay: money(195000) }, permanent);
  assert.deepEqual(totals, { employees: 1, participants: 3, permanentEmployees: 1, externalPayees: 2, gross: 300000, netPay: 265000, paye: 10000, wht: 5000, pension: 8000, employerPension: 10000, nhf: 2500, nsitf: 1000, permanentNetPay: 70000, externalNetPay: 195000, loans: 0, otherDeductions: 0 });
});

test("legacy dashboard totals preserve Permanent employee compatibility", () => {
  const permanent = [{ grossPay: money(100000), netPay: money(70000), payeTax: money(10000), pension: money(8000), employerPension: money(10000), nhf: money(2500), nsitf: money(1000) }];
  const totals = payrollMixedRunTotals({ membershipVersion: "LEGACY_EMPLOYEE", participantCount: 0, permanentEmployeeCount: 0, externalPayeeCount: 0, employeeCount: 1, totalGross: money(100000), totalPaye: money(10000), totalPension: money(8000), totalEmployerPension: money(10000), totalNhf: money(2500), totalLoans: money(0), totalOtherDeductions: money(0), totalNetPay: money(70000), totalWht: money(0), totalPermanentNetPay: money(0), totalExternalNetPay: money(0) }, permanent);
  assert.equal(totals.participants, 1); assert.equal(totals.permanentEmployees, 1); assert.equal(totals.externalPayees, 0); assert.equal(totals.netPay, 70000);
});

test("frozen Payee Group distribution includes mixed and ungrouped participants", () => {
  const distribution = payrollGroupDistribution([
    { participantType: "PERMANENT", group: { id: "staff", name: "Permanent Staff" }, cashGross: "100000", netPay: "70000" },
    { participantType: "CONTRACT", group: { id: "contract", name: "Contract Regular" }, cashGross: "100000", netPay: "95000" },
    { participantType: "CONSULTANT", group: null, cashGross: "100000", netPay: "100000" }
  ]);
  assert.equal(distribution.length, 3); assert.deepEqual(distribution.find((row) => row.groupId === null), { groupId: null, groupName: "Ungrouped", participantCount: 1, permanentEmployeeCount: 0, externalPayeeCount: 1, cashGross: 100000, netPay: 100000 });
  assert.equal(distribution.reduce((sum, row) => sum + row.cashGross, 0), 300000);
});

test("accepted reporting excludes rejected and pre-approval revision states", () => {
  assert.deepEqual(payrollAcceptedReportingStatuses, ["APPROVED", "PENDING_DISBURSEMENT", "DISBURSING", "DISBURSED", "PAID"]);
  for (const excluded of ["DRAFT", "PROCESSING", "PENDING_APPROVAL", "REJECTED_FOR_REWORK", "FAILED", "CANCELLED"]) assert.equal((payrollAcceptedReportingStatuses as readonly string[]).includes(excluded), false);
});

test("unified external Payee calculations are Decimal-safe and exclude pension and NHF", () => {
  const contract = calculateUnifiedExternalPayee("CONTRACT", "100000.25");
  assert.equal(contract.taxRegime, "WHT");
  assert.equal(contract.taxAmount.toString(), "5000.01");
  assert.equal(contract.netAmount.toString(), "95000.24");
  assert.equal(contract.employeePension.toString(), "0");
  assert.equal(contract.employerPension.toString(), "0");
  assert.equal(contract.nhf.toString(), "0");
  const consultant = calculateUnifiedExternalPayee("CONSULTANT", "100000.25");
  assert.equal(consultant.taxAmount.toString(), "0");
  assert.equal(consultant.netAmount.toString(), "100000.25");
  assert.doesNotThrow(() => assertUnifiedPayeeTypeTax("CONTRACT", "WHT"));
  assert.throws(() => assertUnifiedPayeeTypeTax("CONTRACT", "EXEMPT"));
});

test("Payee CSV parsing preserves the exact P1 contract and structured values", () => {
  const header = "type,employeeId,name,externalRole,dateOnboarded,status,onPayroll,taxRegime,email,phone,bankName,bankCode,accountNumber,accountName,tin,monthlyAmount";
  const rows = parsePayrollPayeeCsv(Buffer.from(`${header}\r\nCONTRACT,,"Consultant, One",Adviser,2026-10-01,ACTIVE,true,WHT,person@example.com,,Example Bank,058,0123456789,Person One,,100000.25`));
  assert.equal(rows.length, 1);
  assert.equal(rows[0].name, "Consultant, One");
  assert.equal(rows[0].onPayroll, true);
  assert.equal(rows[0].monthlyAmount, 100000.25);
  assert.throws(() => parsePayrollPayeeCsv(Buffer.from("name,type\r\nWrong,CONTRACT")));
});

test("Payee payroll uses Decimal snapshots and taxability without mutating configuration", () => {
  const taxable = calculatePayeePayroll(money("100000.25"), true);
  const nonTaxable = calculatePayeePayroll(money("100000.25"), false);
  assert.equal(taxable.grossAmount.toString(), "100000.25");
  assert.equal(taxable.payeTax.toString(), "10000.025");
  assert.equal(taxable.netAmount.toString(), "90000.225");
  assert.equal(nonTaxable.payeTax.toString(), "0");
  assert.equal(nonTaxable.netAmount.toString(), "100000.25");
});

test("Payee documents validate file signatures instead of MIME labels alone", () => {
  assert.doesNotThrow(() => inspectPayrollPayeeDocument({ mimetype: "application/pdf", buffer: Buffer.from("%PDF-1.7\n") } as Express.Multer.File));
  assert.throws(() => inspectPayrollPayeeDocument({ mimetype: "application/pdf", buffer: Buffer.from("not a PDF") } as Express.Multer.File));
});

test("Pay Run UI routes use explicit workflow endpoints inside Payroll", () => {
  const routes = (payrollRouter as any).stack.filter((layer: any) => layer.route).flatMap((layer: any) => Object.keys(layer.route.methods).map((method) => `${method.toUpperCase()} ${layer.route.path}`));
  for (const route of ["GET /pay-runs/eligibility", "GET /pay-runs", "POST /pay-runs", "GET /pay-runs/:payRunId", "POST /pay-runs/:payRunId/approve", "GET /pay-runs/:payRunId/export"]) assert.ok(routes.includes(route), route);
});

test("Pay Run input validates dates, filters, sorting, and rejects tenant manipulation", () => {
  assert.equal(payrollPayRunCreateSchema.safeParse({ periodLabel: "Monthly payroll", from: "2026-08-01", to: "2026-08-31" }).success, true);
  assert.equal(payrollPayRunCreateSchema.safeParse({ periodLabel: "Monthly payroll", from: "2026-08-31", to: "2026-08-01" }).success, false);
  assert.equal(payrollPayRunEligibilityQuerySchema.safeParse({ from: "2026-08-01", to: "2026-08-31" }).success, true);
  assert.equal(payrollPayRunsQuerySchema.safeParse({ status: "PENDING_APPROVAL", sortBy: "netPay", sortOrder: "desc" }).success, true);
  assert.equal(payrollPayRunsQuerySchema.safeParse({ tenantId: "other-tenant" }).success, false);
  assert.equal(payrollPayRunsQuerySchema.safeParse({ sortBy: "approvedById" }).success, false);
});

test("Review and rework actions follow immutable run states", () => {
  assert.deepEqual(payRunAvailableActions("PENDING_APPROVAL", false), ["REVIEW"]);
  assert.deepEqual(payRunAvailableActions("PENDING_APPROVAL", true), ["REVIEW", "APPROVE", "REJECT_FOR_REWORK"]);
  assert.deepEqual(payRunAvailableActions("REJECTED_FOR_REWORK", true), ["VIEW", "CREATE_REPLACEMENT"]);
  for (const status of ["APPROVED", "PENDING_DISBURSEMENT", "DISBURSED", "PAID", "CANCELLED"]) assert.deepEqual(payRunAvailableActions(status, true), ["VIEW"]);
});

test("Payroll Payslip and Deduction routes remain explicit inside the shared module", () => {
  const routes = (payrollRouter as any).stack.filter((layer: any) => layer.route).flatMap((layer: any) => Object.keys(layer.route.methods).map((method) => `${method.toUpperCase()} ${layer.route.path}`));
  for (const route of ["GET /payslips", "GET /payslips/export", "GET /payslips/:payslipId", "GET /payslips/:payslipId/download", "GET /deductions/loans", "POST /deductions/loans", "GET /deductions/loans/:loanId", "POST /deductions/loans/:loanId/adjust-repayment", "POST /deductions/loans/:loanId/pause", "POST /deductions/loans/:loanId/resume", "POST /deductions/loans/:loanId/close-early", "GET /deductions/loans/:loanId/export", "GET /deductions/custom", "POST /deductions/custom", "DELETE /deductions/custom/:deductionId"]) assert.ok(routes.includes(route), route);
});

test("Payslip UI filters validate year, quarter, month, status and reject identity manipulation", () => {
  assert.equal(payrollPayslipsQuerySchema.safeParse({ year: 2026, quarter: "Q2", month: 5, status: "PAID", search: "Finance" }).success, true);
  assert.equal(payrollPayslipsQuerySchema.safeParse({ quarter: "Q5" }).success, false);
  assert.equal(payrollPayslipsQuerySchema.safeParse({ month: 13 }).success, false);
  assert.equal(payrollPayslipsQuerySchema.safeParse({ tenantId: "other" }).success, false);
});

test("Loan schedule reaches zero without a negative final installment", () => {
  const schedule = buildLoanSchedule(money("1000"), money("300"), new Date("2026-01-01T00:00:00.000Z"));
  assert.equal(schedule.length, 4);
  assert.equal(schedule[3].repayment, 100);
  assert.equal(schedule[3].closingBalance, 0);
  assert.equal(schedule.every((row) => row.closingBalance >= 0), true);
});

test("Loan and custom deduction commands enforce Payroll boundaries", () => {
  assert.equal(payrollCreateLoanSchema.safeParse({ employeeId: "cm1234567890123456789012", purpose: "Advance", principalAmount: 1000, monthlyRepayment: 200, startDate: "2026-09-01" }).success, true);
  assert.equal(payrollCreateLoanSchema.safeParse({ employeeId: "cm1234567890123456789012", purpose: "Advance", principalAmount: 1000, monthlyRepayment: 1200, startDate: "2026-09-01" }).success, false);
  assert.equal(payrollAdjustLoanSchema.safeParse({ monthlyRepayment: 0 }).success, false);
  assert.equal(payrollLoansQuerySchema.safeParse({ status: "PAUSED", search: "employee", sortBy: "outstanding" }).success, true);
  assert.equal(payrollCreateCustomDeductionSchema.safeParse({ employeeId: "cm1234567890123456789012", name: "Recurring deduction", amount: 50 }).success, true);
  assert.equal(payrollCreateCustomDeductionSchema.safeParse({ employeeId: "cm1234567890123456789012", name: "Recurring deduction", amount: -1 }).success, false);
});

test("Payroll Wallet and PAYE routes remain in the shared Payroll module", () => {
  const routes = (payrollRouter as any).stack.filter((layer: any) => layer.route).flatMap((layer: any) => Object.keys(layer.route.methods).map((method) => `${method.toUpperCase()} ${layer.route.path}`));
  for (const route of ["GET /wallet", "POST /wallet/fund", "GET /wallet/transactions", "GET /wallet/transactions/export", "GET /wallet/transactions/:transactionId", "GET /wallet/obligations", "POST /wallet/obligations/:obligationId/pay", "GET /tax/overview", "GET /tax/employees-by-state", "GET /tax/remittances", "GET /tax/remittances/:remittanceId/receipt", "GET /tax/annual-returns", "GET /tax/annual-returns/export", "GET /tax/config"]) assert.ok(routes.includes(route), route);
});

test("wallet arithmetic is Decimal-safe and never reports a negative shortfall", () => {
  assert.equal(walletBalanceAfter("100.10", "20.05", "CREDIT").toString(), "120.15");
  assert.equal(walletBalanceAfter("100.10", "20.05", "DEBIT").toString(), "80.05");
  assert.equal(payrollWalletShortfall("100", "125.55").toString(), "25.55");
  assert.equal(payrollWalletShortfall("200", "125.55").toString(), "0");
});

test("wallet inputs are bounded, source-safe and reject tenant manipulation", () => {
  assert.equal(payrollWalletFundSchema.safeParse({ amount: "100000.25", transferReference: "BANK-REFERENCE-1" }).success, true);
  assert.equal(payrollWalletFundSchema.safeParse({ amount: 0, transferReference: "BANK-REFERENCE-1" }).success, false);
  assert.equal(payrollWalletTransactionsQuerySchema.safeParse({ type: "PAYE_REMITTANCE", direction: "DEBIT", search: "PAYE", page: 1, limit: 20 }).success, true);
  assert.equal(payrollWalletTransactionsQuerySchema.safeParse({ tenantId: "another-tenant" }).success, false);
  assert.equal(payrollWalletTransactionsQuerySchema.safeParse({ type: "ARBITRARY" }).success, false);
});

test("PAYE queries enforce year, period, filters and pagination without tenant input", () => {
  assert.equal(payrollTaxEmployeesQuerySchema.safeParse({ year: 2026, period: "2026-08", state: "Lagos", search: "employee", page: 1, limit: 20 }).success, true);
  assert.equal(payrollTaxRemittancesQuerySchema.safeParse({ year: 2026, status: "OVERDUE" }).success, true);
  assert.equal(payrollTaxAnnualQuerySchema.safeParse({ year: 2026, state: "Lagos" }).success, true);
  assert.equal(payrollTaxEmployeesQuerySchema.safeParse({ year: 1999 }).success, false);
  assert.equal(payrollTaxEmployeesQuerySchema.safeParse({ tenantId: "another-tenant" }).success, false);
});

test("Pension and Reports routes remain inside the shared Payroll module", () => {
  const routes = (payrollRouter as any).stack.filter((layer: any) => layer.route).flatMap((layer: any) => Object.keys(layer.route.methods).map((method) => `${method.toUpperCase()} ${layer.route.path}`));
  for (const route of ["GET /pension/overview", "GET /pension/contributions", "GET /pension/pfas", "GET /pension/remittances", "POST /pension/remittances/:id/remit", "POST /pension/remittances/:id/mark-remitted", "GET /pension/avc", "POST /pension/avc", "POST /pension/avc/:id/pause", "POST /pension/avc/:id/resume", "GET /pension/pfa-transfers", "POST /pension/pfa-transfers", "POST /pension/pfa-transfers/:id/advance", "GET /pension/export", "GET /reports/summary", "GET /reports/department-cost", "GET /reports/monthly-variance", "GET /reports/bank-payment-schedule", "GET /reports/ytd-earnings", "GET /reports/:report/export"]) assert.ok(routes.includes(route), route);
});

test("Pension totals preserve employee, employer and AVC distinctions", () => {
  assert.deepEqual(payrollPensionSnapshotTotals([{ pension: money("80.10"), employerPension: money("100.20"), avcContribution: money("20.30") }, { pension: money("40"), employerPension: money("50"), avcContribution: money("10") }]), { employeeContribution: 120.1, employerContribution: 150.2, avcContribution: 30.3, totalContribution: 300.6 });
});

test("variance classifies increases, decreases, unchanged, new and removed employees", () => {
  assert.equal(payrollVariance("100", "125").changeType, "INCREASE");
  assert.equal(payrollVariance("100", "75").changeType, "DECREASE");
  assert.equal(payrollVariance("100", "100").changeType, "NO_CHANGE");
  assert.equal(payrollVariance(null, "100").changeType, "NEW_EMPLOYEE");
  assert.equal(payrollVariance("100", null).changeType, "REMOVED_EMPLOYEE");
  assert.equal(payrollVariance("100", "125").percentageChange, 25);
});

test("AVC, PFA transfer and report inputs reject unsafe or ambiguous values", () => {
  const employeeId = "cm1234567890123456789012";
  assert.equal(payrollAvcCreateSchema.safeParse({ employeeId, monthlyAmount: "5000.25", startDate: "2026-09-01" }).success, true);
  assert.equal(payrollAvcCreateSchema.safeParse({ employeeId, monthlyAmount: 0, startDate: "2026-09-01" }).success, false);
  assert.equal(payrollPfaTransferCreateSchema.safeParse({ employeeId, currentPfa: "Current PFA", newPfa: "Current PFA" }).success, false);
  assert.equal(payrollPfaTransferAdvanceSchema.safeParse({ nextStatus: "COMPLETED" }).success, true);
  assert.equal(payrollReportsSummaryQuerySchema.safeParse({ year: 2026, period: "2026-09" }).success, true);
  assert.equal(payrollReportsDepartmentQuerySchema.safeParse({ period: "2026-09" }).success, true);
  assert.equal(payrollReportsVarianceQuerySchema.safeParse({ previousPeriod: "2026-08", currentPeriod: "2026-09" }).success, true);
  assert.equal(payrollReportsVarianceQuerySchema.safeParse({ previousPeriod: "2026-09", currentPeriod: "2026-09" }).success, false);
  assert.equal(payrollReportsBankQuerySchema.safeParse({ period: "2026-09", status: "PAID" }).success, true);
  assert.equal(payrollReportsYtdQuerySchema.safeParse({ year: 2026, tenantId: "other" }).success, false);
});
