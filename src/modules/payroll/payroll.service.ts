import { Prisma } from "@prisma/client";
import { badRequest, conflict, notFound } from "../../core/http-error";
import { env } from "../../config/env";
import { prisma } from "../../core/prisma";
import { getQueueByName, isQueueBackendAvailable, PAYROLL_QUEUE_NAME } from "../../queues";
import { PAYROLL_GENERATE_PAYSLIPS_JOB } from "../../queues/workers";
import {
  loanCreateSchema,
  loanUpdateSchema,
  payslipCreateSchema,
  payslipUpdateSchema,
  payrollRunCreateSchema,
  payrollRunUpdateSchema,
  salaryCreateSchema,
  salaryUpdateSchema,
  taxReportCreateSchema,
  taxReportUpdateSchema,
  payrollCreateEmployeeSchema
} from "./payroll.validation";
import { tenantDateKey, zonedDateTimeToUtc } from "../hris/hris.service";
import type { PayrollDashboardRunTotals } from "./payroll.interface";
import type { AuthUser } from "../../types";
import { createAuditLog } from "../admin/admin.audit";
import { createManagedEmployee } from "../hris/hris.service";

const payrollReportableStatuses = ["APPROVED", "PENDING_DISBURSEMENT", "DISBURSING", "DISBURSED", "PAID"] as const;
const payrollDisbursementPendingStatuses = ["APPROVED", "PENDING_DISBURSEMENT", "DISBURSING"] as const;
const payrollActiveStatuses = ["DRAFT", "PROCESSING", "PENDING_APPROVAL", "APPROVED", "PENDING_DISBURSEMENT", "DISBURSING"] as const;
const zeroDecimal = () => new Prisma.Decimal(0);
const safeTimeZone = (value?: string | null) => { try { const zone = value ?? "Africa/Lagos"; new Intl.DateTimeFormat("en-US", { timeZone: zone }).format(); return zone; } catch { return "Africa/Lagos"; } };
export const shiftPayrollMonth = (month: string, offset: number) => { const [year, value] = month.split("-").map(Number); const shifted = new Date(Date.UTC(year, value - 1 + offset, 1)); return `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, "0")}`; };
export const payrollDashboardMonths = (currentMonth: string) => Array.from({ length: 6 }, (_, index) => shiftPayrollMonth(currentMonth, index - 5));
export const payrollDashboardRunTotals = (payslips: Array<{ grossPay: Prisma.Decimal; netPay: Prisma.Decimal; payeTax: Prisma.Decimal; pension: Prisma.Decimal; employerPension: Prisma.Decimal; nhf: Prisma.Decimal; nsitf: Prisma.Decimal }>): PayrollDashboardRunTotals => {
  const totals = payslips.reduce((result, row) => ({ gross: result.gross.add(row.grossPay), netPay: result.netPay.add(row.netPay), paye: result.paye.add(row.payeTax), pension: result.pension.add(row.pension), employerPension: result.employerPension.add(row.employerPension), nhf: result.nhf.add(row.nhf), nsitf: result.nsitf.add(row.nsitf) }), { gross: zeroDecimal(), netPay: zeroDecimal(), paye: zeroDecimal(), pension: zeroDecimal(), employerPension: zeroDecimal(), nhf: zeroDecimal(), nsitf: zeroDecimal() });
  return { employees: payslips.length, ...Object.fromEntries(Object.entries(totals).map(([key, value]) => [key, Number(value)])) } as PayrollDashboardRunTotals;
};
export const payrollEmployerCost = (payslips: Array<{ grossPay: Prisma.Decimal; employerPension: Prisma.Decimal; nsitf: Prisma.Decimal }>) => Number(payslips.reduce((total, row) => total.add(row.grossPay).add(row.employerPension).add(row.nsitf), zeroDecimal()));
export const statutoryObligationStatus = (input: { submittedAt: Date | null; dueDate: Date | null }, now: Date) => input.submittedAt ? "REMITTED" as const : input.dueDate && input.dueDate < now ? "OVERDUE" as const : "DUE" as const;

const payrollRunProjection = (run: { id: string; name: string; periodStart: Date; status: string; createdAt: Date; payslip: Array<any> }, timeZone: string) => ({ id: run.id, name: run.name, period: tenantDateKey(run.periodStart, timeZone).slice(0, 7), status: run.status, createdAt: run.createdAt, currency: run.payslip.find((row) => row.currency)?.currency ?? null, ...payrollDashboardRunTotals(run.payslip) });

export const getPayrollDashboard = async (organizationId: string, user: AuthUser, now = new Date()) => {
  const [settings, organization] = await Promise.all([prisma.organizationGeneralSettings.findUnique({ where: { organizationId }, select: { timeZone: true, currency: true } }), prisma.organization.findUnique({ where: { id: organizationId }, select: { currency: true } })]);
  const timeZone = safeTimeZone(settings?.timeZone); const currentMonth = tenantDateKey(now, timeZone).slice(0, 7); const months = payrollDashboardMonths(currentMonth);
  const rangeStart = zonedDateTimeToUtc(`${months[0]}-01`, "00:00", timeZone); const nextMonth = shiftPayrollMonth(currentMonth, 1); const rangeEnd = zonedDateTimeToUtc(`${nextMonth}-01`, "00:00", timeZone);
  const currentStart = zonedDateTimeToUtc(`${currentMonth}-01`, "00:00", timeZone);
  const payslipSelect = { grossPay: true, netPay: true, payeTax: true, pension: true, employerPension: true, nhf: true, nsitf: true, currency: true, departmentIdSnapshot: true, departmentNameSnapshot: true } as const;
  const [employeesOnPayroll, historicalRuns, recentRuns, lastRun, pendingApprovalRun, pendingDisbursementRun, currentRun] = await Promise.all([
    prisma.employee.count({ where: { organizationId, status: "ACTIVE", payrollEnrollment: { is: { isActive: true } }, salaryStructures: { some: { effectiveFrom: { lte: now }, OR: [{ effectiveTo: null }, { effectiveTo: { gte: now } }] } } } }),
    prisma.payrollRun.findMany({ where: { organizationId, status: { in: [...payrollReportableStatuses] }, periodEnd: { gte: rangeStart }, periodStart: { lt: rangeEnd } }, include: { payslip: { select: payslipSelect } }, orderBy: { periodEnd: "asc" } }),
    prisma.payrollRun.findMany({ where: { organizationId }, include: { payslip: { select: payslipSelect } }, orderBy: [{ periodEnd: "desc" }, { createdAt: "desc" }], take: 5 }),
    prisma.payrollRun.findFirst({ where: { organizationId, status: { in: [...payrollReportableStatuses] } }, include: { payslip: { select: payslipSelect } }, orderBy: [{ periodEnd: "desc" }, { createdAt: "desc" }] }),
    prisma.payrollRun.findFirst({ where: { organizationId, status: "PENDING_APPROVAL" }, include: { payslip: { select: payslipSelect } }, orderBy: { createdAt: "desc" } }),
    prisma.payrollRun.findFirst({ where: { organizationId, status: { in: [...payrollDisbursementPendingStatuses] } }, include: { payslip: { select: payslipSelect } }, orderBy: [{ periodEnd: "desc" }, { createdAt: "desc" }] }),
    prisma.payrollRun.findFirst({ where: { organizationId, status: { in: [...payrollReportableStatuses] }, periodStart: { lt: rangeEnd }, periodEnd: { gte: currentStart } }, include: { payslip: { select: payslipSelect } }, orderBy: { createdAt: "desc" } })
  ]);
  const currency = currentRun?.payslip.find((row) => row.currency)?.currency ?? settings?.currency ?? organization?.currency ?? "NGN";
  const trend = new Map(months.map((month) => [month, { period: month, gross: zeroDecimal(), netPay: zeroDecimal(), paye: zeroDecimal(), pension: zeroDecimal(), nhf: zeroDecimal() }]));
  for (const run of historicalRuns) { const period = tenantDateKey(run.periodStart, timeZone).slice(0, 7); const bucket = trend.get(period); if (!bucket) continue; const totals = payrollDashboardRunTotals(run.payslip); bucket.gross = bucket.gross.add(totals.gross); bucket.netPay = bucket.netPay.add(totals.netPay); bucket.paye = bucket.paye.add(totals.paye); bucket.pension = bucket.pension.add(totals.pension); bucket.nhf = bucket.nhf.add(totals.nhf); }
  const last = lastRun ? payrollRunProjection(lastRun, timeZone) : null; const current = currentRun ? payrollRunProjection(currentRun, timeZone) : null; const pendingApproval = pendingApprovalRun ? payrollRunProjection(pendingApprovalRun, timeZone) : null; const pendingDisbursement = pendingDisbursementRun ? payrollRunProjection(pendingDisbursementRun, timeZone) : null;
  const departmentMap = new Map<string, { departmentId: string | null; departmentName: string; grossAmount: Prisma.Decimal }>();
  for (const row of lastRun?.payslip ?? []) { const key = row.departmentIdSnapshot ?? `name:${row.departmentNameSnapshot ?? "Unassigned"}`; const value = departmentMap.get(key) ?? { departmentId: row.departmentIdSnapshot, departmentName: row.departmentNameSnapshot ?? "Unassigned", grossAmount: zeroDecimal() }; value.grossAmount = value.grossAmount.add(row.grossPay); departmentMap.set(key, value); }
  const taxReports = lastRun ? await prisma.taxReport.findMany({ where: { organizationId, periodStart: { lte: lastRun.periodEnd }, periodEnd: { gte: lastRun.periodStart }, type: { in: ["PAYE", "PENSION", "NHF", "NSITF"] } }, orderBy: { type: "asc" } }) : [];
  const obligations = taxReports.map((report) => ({ id: report.id, type: report.type, label: report.type, amount: Number(report.amount), dueDate: report.dueDate, status: statutoryObligationStatus(report, now), remittedAt: report.submittedAt }));
  const hasActiveCurrentRun = recentRuns.some((run) => payrollActiveStatuses.includes(run.status as typeof payrollActiveStatuses[number]) && run.periodStart < rangeEnd && run.periodEnd >= currentStart);
  return {
    period: currentMonth, currency,
    summary: { employeesOnPayroll, totalMonthlyCost: { amount: currentRun ? payrollEmployerCost(currentRun.payslip) : 0, currency, period: currentMonth }, lastRunNetPay: last ? { amount: last.netPay, currency: last.currency ?? currency, period: last.period, payRunId: last.id } : null, pendingDisbursement: pendingDisbursement ? { amount: pendingDisbursement.netPay, currency: pendingDisbursement.currency ?? currency, period: pendingDisbursement.period, payRunId: pendingDisbursement.id, status: pendingDisbursement.status } : null },
    pendingApproval: pendingApproval ? { payRunId: pendingApproval.id, period: pendingApproval.period, employees: pendingApproval.employees, totalNet: pendingApproval.netPay, currency: pendingApproval.currency ?? currency, createdAt: pendingApproval.createdAt, status: pendingApproval.status } : null,
    payrollTrend: [...trend.values()].map((item) => ({ period: item.period, gross: Number(item.gross), netPay: Number(item.netPay) })),
    deductionTrend: [...trend.values()].map((item) => ({ period: item.period, paye: Number(item.paye), pension: Number(item.pension), nhf: Number(item.nhf) })),
    departmentCosts: { period: last?.period ?? null, items: [...departmentMap.values()].map((item) => ({ ...item, grossAmount: Number(item.grossAmount) })).sort((a, b) => b.grossAmount - a.grossAmount) },
    statutoryObligations: { period: last?.period ?? null, items: obligations },
    recentPayRuns: recentRuns.map((run) => { const item = payrollRunProjection(run, timeZone); return { id: item.id, period: item.period, employees: item.employees, gross: item.gross, netPay: item.netPay, paye: item.paye, status: item.status }; }),
    actions: { canRunPayroll: user.permissions.includes("payroll:runs:create") && !hasActiveCurrentRun, canViewPayslips: user.permissions.includes("payroll:payslips:view"), canManageDeductions: user.permissions.includes("payroll:statutory:update") }
  };
};

const payrollEmployee = async (organizationId: string, employeeId: string) => {
  const now = new Date(); const employee = await prisma.employee.findFirst({ where: { id: employeeId, organizationId }, include: { department: true, payrollEnrollment: true, payrollStatutoryProfile: true, payrollBik: true, payrollDeductions: { where: { active: true, effectiveFrom: { lte: now }, OR: [{ effectiveTo: null }, { effectiveTo: { gte: now } }] }, orderBy: { createdAt: "desc" } }, loans: { orderBy: { issuedAt: "desc" } }, salaryStructures: { where: { effectiveFrom: { lte: now }, OR: [{ effectiveTo: null }, { effectiveTo: { gte: now } }] }, orderBy: { effectiveFrom: "desc" }, take: 1 } } });
  if (!employee) throw notFound("Payroll employee not found"); return employee;
};
const jsonAllowances = (value: Prisma.JsonValue | null) => Array.isArray(value) ? value.filter((item): item is { name: string; amount: number; taxable?: boolean } => Boolean(item && typeof item === "object" && !Array.isArray(item) && typeof (item as any).name === "string" && Number.isFinite(Number((item as any).amount)))).map((item) => ({ ...item, amount: new Prisma.Decimal(item.amount) })) : [];
const monthDays = (period: string) => new Date(Date.UTC(Number(period.slice(0, 4)), Number(period.slice(5, 7)), 0)).getUTCDate();
export const payrollProrationFactor = (input: { period: string; resumeDate: Date | null; method: string | null; workdays?: ReadonlySet<string> }) => {
  if (!input.resumeDate || !input.method) return new Prisma.Decimal(1); const resume = input.resumeDate.toISOString().slice(0, 10); if (!resume.startsWith(input.period)) return new Prisma.Decimal(resume < `${input.period}-01` ? 1 : 0);
  if (input.method === "CALENDAR_DAYS") return new Prisma.Decimal(monthDays(input.period) - Number(resume.slice(8, 10)) + 1).div(monthDays(input.period));
  const fallback = new Set<string>(); if (!input.workdays) for (let day = 1; day <= monthDays(input.period); day += 1) { const date = `${input.period}-${String(day).padStart(2, "0")}`; const weekday = new Date(`${date}T00:00:00.000Z`).getUTCDay(); if (weekday >= 1 && weekday <= 5) fallback.add(date); } const scheduled = [...(input.workdays ?? fallback)]; if (!scheduled.length) return new Prisma.Decimal(1); return new Prisma.Decimal(scheduled.filter((date) => date >= resume).length).div(scheduled.length);
};
export const calculatePayrollPreview = (input: { salary: { basic: Prisma.Decimal; housing: Prisma.Decimal; transport: Prisma.Decimal; otherAllowance: Prisma.Decimal; additionalAllowances: Prisma.JsonValue | null; prorationResumeDate: Date | null; prorationMethod: string | null } | null; deductions: Array<{ amount: Prisma.Decimal; frequency: string }>; loans: Array<{ outstanding: Prisma.Decimal; monthlyRepayment: Prisma.Decimal | null; loanType: string; status: string }>; period: string; workdays?: ReadonlySet<string> }) => {
  if (!input.salary) return { basicSalary: 0, housingAllowance: 0, transportAllowance: 0, otherAllowance: 0, additionalAllowances: [], gross: 0, paye: 0, employeePension: 0, employerPension: 0, nhf: 0, nsitf: 0, customDeductions: 0, loanDeductions: 0, netPay: 0, employerCost: 0, availability: "SALARY_NOT_CONFIGURED" as const };
  const factor = payrollProrationFactor({ period: input.period, resumeDate: input.salary.prorationResumeDate, method: input.salary.prorationMethod, workdays: input.workdays }); const additional = jsonAllowances(input.salary.additionalAllowances); const basic = input.salary.basic.mul(factor); const housing = input.salary.housing.mul(factor); const transport = input.salary.transport.mul(factor); const other = input.salary.otherAllowance.mul(factor); const additionalTotal = additional.reduce((sum, item) => sum.add(item.amount.mul(factor)), zeroDecimal()); const gross = basic.add(housing).add(transport).add(other).add(additionalTotal);
  // Preserves the current legacy statutory behavior in one preview service until the statutory engine is replaced.
  const paye = gross.mul("0.10"); const employeePension = gross.mul("0.08"); const employerPension = zeroDecimal(); const nhf = zeroDecimal(); const nsitf = zeroDecimal(); const custom = input.deductions.reduce((sum, item) => sum.add(item.amount), zeroDecimal()); const loan = input.loans.filter((item) => item.status === "ACTIVE").reduce((sum, item) => { const configured = item.loanType === "ONE_OFF" ? item.outstanding : item.monthlyRepayment ?? zeroDecimal(); return sum.add(Prisma.Decimal.min(configured, item.outstanding)); }, zeroDecimal()); const net = Prisma.Decimal.max(zeroDecimal(), gross.sub(paye).sub(employeePension).sub(nhf).sub(custom).sub(loan));
  return { basicSalary: Number(basic), housingAllowance: Number(housing), transportAllowance: Number(transport), otherAllowance: Number(other), additionalAllowances: additional.map((item) => ({ name: item.name, amount: Number(item.amount), taxable: item.taxable ?? true })), gross: Number(gross), paye: Number(paye), employeePension: Number(employeePension), employerPension: Number(employerPension), nhf: Number(nhf), nsitf: Number(nsitf), customDeductions: Number(custom), loanDeductions: Number(loan), netPay: Number(net), employerCost: Number(gross.add(employerPension).add(nsitf)), availability: "LEGACY_STATUTORY_PREVIEW" as const };
};
const initials = (first: string, last: string) => `${first[0] ?? ""}${last[0] ?? ""}`.toUpperCase();
const maskIdentifier = (value?: string | null) => value ? `***${value.slice(-4)}` : null;
const payrollPeriod = (now = new Date()) => now.toISOString().slice(0, 7);
const employeePreview = (employee: any, period = payrollPeriod()) => calculatePayrollPreview({ salary: employee.salaryStructures?.[0] ?? null, deductions: employee.payrollDeductions ?? [], loans: employee.loans ?? [], period });
const employeeListItem = (employee: any) => { const preview = employeePreview(employee); return { employeeId: employee.id, employeeCode: employee.employeeNo, fullName: `${employee.firstName} ${employee.lastName}`.trim(), initials: initials(employee.firstName, employee.lastName), role: employee.jobTitle, department: employee.department ? { id: employee.department.id, name: employee.department.name } : null, employmentType: employee.employmentType, employeeStatus: employee.status === "TERMINATED" ? "INACTIVE" : employee.status, payrollStatus: employee.payrollEnrollment?.isActive ? "ON_PAYROLL" : "OFF_PAYROLL", grossPay: preview.gross, netPay: preview.netPay, paye: preview.paye }; };
export const listPayrollEmployees = async (organizationId: string, query: any) => {
  const where: Prisma.EmployeeWhereInput = { organizationId, ...(query.departmentId ? { departmentId: query.departmentId } : {}), ...(query.status ? { status: query.status === "INACTIVE" ? "TERMINATED" : query.status } : {}), ...(query.employmentType ? { employmentType: query.employmentType } : {}), ...(query.payrollStatus ? { payrollEnrollment: query.payrollStatus === "ON_PAYROLL" ? { is: { isActive: true } } : { isNot: { isActive: true } } } : {}), ...(query.search ? { OR: [{ firstName: { contains: query.search } }, { lastName: { contains: query.search } }, { jobTitle: { contains: query.search } }, { employeeNo: { contains: query.search } }] } : {}) };
  const orderBy: Prisma.EmployeeOrderByWithRelationInput = query.sortBy === "department" ? { department: { name: query.sortOrder } } : query.sortBy === "status" ? { status: query.sortOrder } : query.sortBy === "name" ? { firstName: query.sortOrder } : { baseSalary: query.sortOrder };
  const now = new Date(); const include = { department: true, payrollEnrollment: true, payrollDeductions: { where: { active: true, effectiveFrom: { lte: now }, OR: [{ effectiveTo: null }, { effectiveTo: { gte: now } }] } }, loans: { where: { status: "ACTIVE" } }, salaryStructures: { where: { effectiveFrom: { lte: now }, OR: [{ effectiveTo: null }, { effectiveTo: { gte: now } }] }, orderBy: { effectiveFrom: "desc" as const }, take: 1 } };
  const previewSort = query.sortBy === "gross" || query.sortBy === "netPay"; const [rows, total] = await Promise.all([prisma.employee.findMany({ where, include, ...(previewSort ? {} : { orderBy, skip: (query.page - 1) * query.limit, take: query.limit }) }), prisma.employee.count({ where })]); let employees = rows.map(employeeListItem); if (previewSort) { const key = query.sortBy === "gross" ? "grossPay" : "netPay"; employees.sort((a, b) => query.sortOrder === "asc" ? a[key] - b[key] : b[key] - a[key]); employees = employees.slice((query.page - 1) * query.limit, query.page * query.limit); }
  return { employees, pagination: { page: query.page, limit: query.limit, total, totalPages: Math.ceil(total / query.limit) } };
};
export const getPayrollEmployeeDetail = async (organizationId: string, employeeId: string) => {
  const employee = await payrollEmployee(organizationId, employeeId); const preview = employeePreview(employee);
  return { employee: employeeListItem(employee), personalDetails: { employeeCode: employee.employeeNo, email: employee.email, phone: employee.phone, joinDate: employee.hireDate, taxState: employee.payrollStatutoryProfile?.taxState ?? employee.state, taxStatus: employee.payrollStatutoryProfile?.taxStatus ?? null, bank: { bankName: employee.bankName, maskedAccountNumber: employee.bankAccountNumber ? `${"*".repeat(Math.max(0, employee.bankAccountNumber.length - 4))}${employee.bankAccountNumber.slice(-4)}` : null }, tin: maskIdentifier(employee.payrollStatutoryProfile?.tin ?? employee.taxId), pensionPin: maskIdentifier(employee.payrollStatutoryProfile?.pensionPin ?? employee.pensionPin), pfa: employee.payrollStatutoryProfile?.pfaName, nhfNumber: maskIdentifier(employee.payrollStatutoryProfile?.nhfNumber) }, paySummary: { ...preview, employerContributions: { employerPension: preview.employerPension, nsitf: preview.nsitf } }, salaryStructure: employee.salaryStructures[0] ?? null, statutoryProfile: employee.payrollStatutoryProfile ? { ...employee.payrollStatutoryProfile, tin: maskIdentifier(employee.payrollStatutoryProfile.tin), pensionPin: maskIdentifier(employee.payrollStatutoryProfile.pensionPin), nhfNumber: maskIdentifier(employee.payrollStatutoryProfile.nhfNumber) } : null, deductions: employee.payrollDeductions, loans: employee.loans.map((loan) => ({ ...loan, repaid: Number(loan.amount.sub(loan.outstanding)) })), bik: employee.payrollBik ? { ...employee.payrollBik, totalMonthlyBik: Number(employee.payrollBik.hmoHealthInsurance.add(employee.payrollBik.airtimeAllowance).add(employee.payrollBik.mealAllowance)) } : null };
};
export const enrollPayrollEmployee = async (organizationId: string, employeeId: string, user: AuthUser) => { const employee = await payrollEmployee(organizationId, employeeId); if (employee.payrollEnrollment?.isActive) return { employeeId, payrollStatus: "ON_PAYROLL", idempotent: true }; const missingFields = [...(!employee.salaryStructures.length ? ["salaryStructure"] : []), ...(!employee.bankAccountNumber ? ["accountNumber"] : [])]; if (missingFields.length) throw conflict("Payroll profile is incomplete", { code: "PAYROLL_PROFILE_INCOMPLETE", missingFields }); const enrollment = await prisma.payrollEnrollment.upsert({ where: { employeeId }, create: { organizationId, employeeId, enrolledById: user.id }, update: { isActive: true, enrolledAt: new Date(), enrolledById: user.id, removedAt: null, removedById: null, removedReason: null } }); await createAuditLog({ organizationId, actorUserId: user.id, action: "PAYROLL_EMPLOYEE_ENROLLED", resource: "PAYROLL_ENROLLMENT", resourceId: enrollment.id, summary: "Employee added to payroll", metadata: { employeeId } }); return { employeeId, payrollStatus: "ON_PAYROLL", enrolledAt: enrollment.enrolledAt, idempotent: false }; };
export const removePayrollEmployee = async (organizationId: string, employeeId: string, reason: string | undefined, user: AuthUser) => { const employee = await payrollEmployee(organizationId, employeeId); if (!employee.payrollEnrollment?.isActive) return { employeeId, payrollStatus: "OFF_PAYROLL", idempotent: true }; const activeRun = await prisma.payslip.findFirst({ where: { organizationId, employeeId, payrollrun: { status: { in: [...payrollActiveStatuses] } } }, select: { id: true } }); if (activeRun) throw conflict("Employee belongs to an active payroll run"); await prisma.payrollEnrollment.update({ where: { employeeId }, data: { isActive: false, removedAt: new Date(), removedById: user.id, removedReason: reason } }); await createAuditLog({ organizationId, actorUserId: user.id, action: "PAYROLL_EMPLOYEE_REMOVED", resource: "PAYROLL_ENROLLMENT", resourceId: employee.payrollEnrollment.id, summary: "Employee removed from future payroll", metadata: { employeeId, reason: reason ?? null } }); return { employeeId, payrollStatus: "OFF_PAYROLL", idempotent: false }; };
export const updatePayrollSalaryStructure = async (organizationId: string, employeeId: string, input: any, user: AuthUser) => { await payrollEmployee(organizationId, employeeId); const effectiveFrom = input.effectiveFrom ? new Date(`${input.effectiveFrom}T00:00:00.000Z`) : new Date(); const previous = await prisma.salaryStructure.findFirst({ where: { organizationId, employeeId, effectiveFrom: { lte: effectiveFrom }, OR: [{ effectiveTo: null }, { effectiveTo: { gte: effectiveFrom } }] }, orderBy: { effectiveFrom: "desc" } }); const created = await prisma.$transaction(async (tx) => { if (previous && previous.effectiveFrom < effectiveFrom) await tx.salaryStructure.update({ where: { id: previous.id }, data: { effectiveTo: new Date(effectiveFrom.getTime() - 1) } }); if (previous && previous.effectiveFrom.getTime() === effectiveFrom.getTime()) return tx.salaryStructure.update({ where: { id: previous.id }, data: { title: "Monthly Salary", basic: input.basicSalary, housing: input.housingAllowance, transport: input.transportAllowance, otherAllowance: input.otherAllowance, additionalAllowances: input.additionalAllowances, prorationResumeDate: input.proration.resumeDate ? new Date(`${input.proration.resumeDate}T00:00:00.000Z`) : null, prorationMethod: input.proration.method } }); return tx.salaryStructure.create({ data: { organizationId, employeeId, title: "Monthly Salary", basic: input.basicSalary, housing: input.housingAllowance, transport: input.transportAllowance, otherAllowance: input.otherAllowance, additionalAllowances: input.additionalAllowances, prorationResumeDate: input.proration.resumeDate ? new Date(`${input.proration.resumeDate}T00:00:00.000Z`) : null, prorationMethod: input.proration.method, effectiveFrom } }); }); await createAuditLog({ organizationId, actorUserId: user.id, action: "PAYROLL_SALARY_UPDATED", resource: "SALARY_STRUCTURE", resourceId: created.id, summary: "Updated employee salary structure", metadata: { employeeId, effectiveFrom, componentCount: input.additionalAllowances.length } }); return { salaryStructure: created, preview: calculatePayrollPreview({ salary: created, deductions: [], loans: [], period: payrollPeriod() }) }; };
export const updatePayrollStatutoryProfile = async (organizationId: string, employeeId: string, input: any, user: AuthUser) => { await payrollEmployee(organizationId, employeeId); const profile = await prisma.payrollStatutoryProfile.upsert({ where: { employeeId }, create: { organizationId, employeeId, ...input }, update: input }); await createAuditLog({ organizationId, actorUserId: user.id, action: "PAYROLL_STATUTORY_PROFILE_UPDATED", resource: "PAYROLL_STATUTORY_PROFILE", resourceId: profile.id, summary: "Updated employee statutory profile", metadata: { employeeId, changedFields: Object.keys(input) } }); return { ...profile, tin: profile.tin ? `***${profile.tin.slice(-4)}` : null, pensionPin: profile.pensionPin ? `***${profile.pensionPin.slice(-4)}` : null, nhfNumber: profile.nhfNumber ? `***${profile.nhfNumber.slice(-4)}` : null }; };
export const createPayrollDeduction = async (organizationId: string, employeeId: string, input: any, user: AuthUser) => { await payrollEmployee(organizationId, employeeId); const row = await prisma.employeeDeduction.create({ data: { organizationId, employeeId, name: input.name, amount: input.amount, frequency: input.frequency, effectiveFrom: input.effectiveFrom ? new Date(`${input.effectiveFrom}T00:00:00.000Z`) : new Date(), effectiveTo: input.effectiveTo ? new Date(`${input.effectiveTo}T23:59:59.999Z`) : null } }); await createAuditLog({ organizationId, actorUserId: user.id, action: "PAYROLL_DEDUCTION_ADDED", resource: "EMPLOYEE_DEDUCTION", resourceId: row.id, summary: "Added employee custom deduction", metadata: { employeeId, name: input.name } }); return row; };
export const removePayrollDeduction = async (organizationId: string, employeeId: string, deductionId: string, user: AuthUser) => { await payrollEmployee(organizationId, employeeId); const row = await prisma.employeeDeduction.findFirst({ where: { id: deductionId, organizationId, employeeId } }); if (!row) throw notFound("Employee deduction not found"); const updated = await prisma.employeeDeduction.update({ where: { id: row.id }, data: { active: false, effectiveTo: new Date() } }); await createAuditLog({ organizationId, actorUserId: user.id, action: "PAYROLL_DEDUCTION_REMOVED", resource: "EMPLOYEE_DEDUCTION", resourceId: row.id, summary: "Removed employee custom deduction", metadata: { employeeId, name: row.name } }); return { id: updated.id, active: false }; };
export const createPayrollLoan = async (organizationId: string, employeeId: string, input: any, user: AuthUser) => { await payrollEmployee(organizationId, employeeId); const monthlyRepayment = input.type === "ONE_OFF" ? input.principal : input.monthlyRepayment; const row = await prisma.loanAdvance.create({ data: { organizationId, employeeId, amount: input.principal, outstanding: input.principal, reason: input.purpose, loanType: input.type, monthlyRepayment, issuedAt: new Date(`${input.startDate}T00:00:00.000Z`) } }); await createAuditLog({ organizationId, actorUserId: user.id, action: "PAYROLL_LOAN_CREATED", resource: "LOAN_ADVANCE", resourceId: row.id, summary: "Created employee loan or advance", metadata: { employeeId, loanType: input.type } }); return { ...row, purpose: row.reason, principal: row.amount, repaid: zeroDecimal() }; };
export const getPayrollBik = async (organizationId: string, employeeId: string) => { const employee = await payrollEmployee(organizationId, employeeId); const bik = employee.payrollBik; return bik ? { ...bik, totalMonthlyBik: Number(bik.hmoHealthInsurance.add(bik.airtimeAllowance).add(bik.mealAllowance)), annualValue: Number(bik.thirteenthMonthAnnual) } : { employeeId, hmoHealthInsurance: 0, airtimeAllowance: 0, mealAllowance: 0, thirteenthMonthAnnual: 0, totalMonthlyBik: 0, annualValue: 0 }; };
export const updatePayrollBik = async (organizationId: string, employeeId: string, input: any, user: AuthUser) => { await payrollEmployee(organizationId, employeeId); const bik = await prisma.employeeBenefitInKind.upsert({ where: { employeeId }, create: { organizationId, employeeId, ...input }, update: input }); await createAuditLog({ organizationId, actorUserId: user.id, action: "PAYROLL_BIK_UPDATED", resource: "EMPLOYEE_BIK", resourceId: bik.id, summary: "Updated employee benefit-in-kind configuration", metadata: { employeeId, changedFields: Object.keys(input) } }); return getPayrollBik(organizationId, employeeId); };
export const getPayrollEmployeeHistory = async (organizationId: string, employeeId: string, query: any) => { await payrollEmployee(organizationId, employeeId); const start = query.year ? new Date(Date.UTC(query.year, 0, 1)) : undefined; const end = query.year ? new Date(Date.UTC(query.year + 1, 0, 1)) : undefined; const where: Prisma.PayslipWhereInput = { organizationId, employeeId, payrollrun: { status: { in: [...payrollReportableStatuses] }, ...(start && end ? { periodStart: { gte: start, lt: end } } : {}) } }; const [rows, total] = await Promise.all([prisma.payslip.findMany({ where, include: { payrollrun: true }, orderBy: { payrollrun: { periodStart: query.sortOrder } }, skip: (query.page - 1) * query.limit, take: query.limit }), prisma.payslip.count({ where })]); return { history: rows.map((row) => ({ payslipId: row.id, period: row.payrollrun.periodStart.toISOString().slice(0, 7), gross: Number(row.grossPay), netPay: Number(row.netPay), paye: Number(row.payeTax), status: row.payrollrun.status, currency: row.currency })), pagination: { page: query.page, limit: query.limit, total, totalPages: Math.ceil(total / query.limit) } }; };
export const sanitizePayrollCsv = (value: unknown) => { const text = String(value ?? ""); const safe = /^[=+\-@]/.test(text) ? `'${text}` : text; return `"${safe.replaceAll('"', '""')}"`; };
export const exportPayrollEmployees = async (organizationId: string, query: any) => { const result = await listPayrollEmployees(organizationId, { ...query, page: 1, limit: 100 }); const header = ["EmployeeCode", "FullName", "Role", "Department", "EmploymentType", "EmployeeStatus", "PayrollStatus", "GrossPay", "NetPay", "PAYE"]; return `\uFEFF${[header, ...result.employees.map((row) => [row.employeeCode, row.fullName, row.role, row.department?.name, row.employmentType, row.employeeStatus, row.payrollStatus, row.grossPay, row.netPay, row.paye])].map((row) => row.map(sanitizePayrollCsv).join(",")).join("\r\n")}`; };
export const exportPayrollHistory = async (organizationId: string, employeeId: string, query: any) => { const result = await getPayrollEmployeeHistory(organizationId, employeeId, { ...query, page: 1, limit: 100 }); const header = ["Period", "Gross", "NetPay", "PAYE", "Status", "Currency"]; return `\uFEFF${[header, ...result.history.map((row) => [row.period, row.gross, row.netPay, row.paye, row.status, row.currency])].map((row) => row.map(sanitizePayrollCsv).join(",")).join("\r\n")}`; };
const payrollEmployeeCode = () => `PAY-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
export const createPayrollEmployee = async (organizationId: string, input: any, user: AuthUser) => { const names = input.fullName.trim().split(/\s+/); const firstName = names.shift()!; const lastName = names.join(" ") || firstName; const employee = await createManagedEmployee(organizationId, { employeeNo: payrollEmployeeCode(), firstName, lastName, email: input.email, phoneNumber: input.phone, position: input.role, departmentId: input.departmentId, state: input.state, employmentType: input.employmentType, bankName: input.bankName, accountNumber: input.accountNumber, operationalStatus: input.employeeStatus === "INACTIVE" ? "TERMINATED" : input.employeeStatus }, user); await updatePayrollSalaryStructure(organizationId, employee.id, input.salary, user); await updatePayrollStatutoryProfile(organizationId, employee.id, { taxStatus: input.taxStatus, taxState: input.state }, user); if (input.enroll) await enrollPayrollEmployee(organizationId, employee.id, user); await createAuditLog({ organizationId, actorUserId: user.id, action: "PAYROLL_EMPLOYEE_CONFIGURED", resource: "EMPLOYEE", resourceId: employee.id, summary: "Created and configured employee through Payroll" }); return getPayrollEmployeeDetail(organizationId, employee.id); };
export const payrollBulkHeaders = ["Name", "Department", "Role", "EmploymentType", "EmploymentStatus", "Email", "Phone", "State", "BankName", "AccountNumber", "BasicSalary", "HousingAllowance", "TransportAllowance", "OtherAllowance"] as const;
export const payrollBulkTemplate = () => `\uFEFF${payrollBulkHeaders.map(sanitizePayrollCsv).join(",")}\r\n`;
export const parsePayrollCsv = (text: string) => { const rows: string[][] = []; let row: string[] = []; let field = ""; let quoted = false; for (let index = 0; index < text.length; index += 1) { const char = text[index]; if (char === '"') { if (quoted && text[index + 1] === '"') { field += '"'; index += 1; } else quoted = !quoted; } else if (char === "," && !quoted) { row.push(field); field = ""; } else if ((char === "\n" || char === "\r") && !quoted) { if (char === "\r" && text[index + 1] === "\n") index += 1; row.push(field); field = ""; if (row.some((value) => value.trim())) rows.push(row); row = []; } else field += char; } if (quoted) throw badRequest("CSV contains an unterminated quoted value"); if (field || row.length) { row.push(field); if (row.some((value) => value.trim())) rows.push(row); } return rows; };
export const importPayrollEmployees = async (organizationId: string, buffer: Buffer, user: AuthUser) => { if (buffer.length > 5 * 1024 * 1024) throw badRequest("Payroll employee CSV must be no larger than 5MB"); const rows = parsePayrollCsv(buffer.toString("utf8").replace(/^\uFEFF/, "")); if (!rows.length || JSON.stringify(rows[0]) !== JSON.stringify([...payrollBulkHeaders])) throw badRequest("Payroll employee CSV headers do not match the required template"); if (rows.length > 501) throw badRequest("Payroll employee CSV supports at most 500 data rows"); const departments = await prisma.department.findMany({ where: { organizationId }, select: { id: true, name: true } }); const departmentMap = new Map(departments.map((department) => [department.name.toLowerCase(), department.id])); const errors: Array<{ row: number; field: string; message: string }> = []; const inputs = rows.slice(1).map((values, index) => { const record = Object.fromEntries(payrollBulkHeaders.map((header, column) => [header, values[column]?.trim() ?? ""])); const departmentId = record.Department ? departmentMap.get(record.Department.toLowerCase()) : undefined; if (record.Department && !departmentId) errors.push({ row: index + 2, field: "Department", message: "Department does not exist in this tenant" }); const parsed = payrollCreateEmployeeSchema.safeParse({ fullName: record.Name, role: record.Role, departmentId, email: record.Email, phone: record.Phone || undefined, state: record.State || undefined, employmentType: record.EmploymentType, taxStatus: "PAYE", bankName: record.BankName || undefined, accountNumber: record.AccountNumber || undefined, salary: { basicSalary: record.BasicSalary, housingAllowance: record.HousingAllowance || 0, transportAllowance: record.TransportAllowance || 0, otherAllowance: record.OtherAllowance || 0, additionalAllowances: [], proration: { resumeDate: null, method: null } }, enroll: false }); if (!parsed.success) for (const issue of parsed.error.issues) errors.push({ row: index + 2, field: issue.path.join("."), message: issue.message }); return parsed.success ? parsed.data : null; }); const emails = inputs.filter(Boolean).map((input) => input!.email.toLowerCase()); if (new Set(emails).size !== emails.length) errors.push({ row: 0, field: "Email", message: "CSV contains duplicate email addresses" }); const existing = await prisma.employee.findMany({ where: { organizationId, email: { in: emails } }, select: { email: true } }); for (const employee of existing) errors.push({ row: 0, field: "Email", message: `${employee.email} already exists` }); if (errors.length) return { totalRows: rows.length - 1, successful: 0, failed: rows.length - 1, errors }; let successful = 0; for (let index = 0; index < inputs.length; index += 1) { try { await createPayrollEmployee(organizationId, inputs[index]!, user); successful += 1; } catch { errors.push({ row: index + 2, field: "row", message: "Employee could not be created" }); } } await createAuditLog({ organizationId, actorUserId: user.id, action: "PAYROLL_EMPLOYEES_IMPORTED", resource: "EMPLOYEE", summary: `Imported ${successful} Payroll employees`, metadata: { successful, failed: errors.length } }); return { totalRows: inputs.length, successful, failed: errors.length, errors }; };

export const generatePayslips = async (organizationId: string, id: string) => {
  const run = await prisma.payrollRun.findFirst({
    where: { id, organizationId }
  });

  if (!run) throw notFound("Payroll run not found");
  if (run.status !== "DRAFT" && run.status !== "PROCESSING") {
    throw badRequest("Payslips can only be generated for draft or processing payroll runs");
  }

  if (run.status === "DRAFT") {
    await prisma.payrollRun.update({
      where: { id: run.id },
      data: { status: "PROCESSING" }
    });
  }

  const [employees, settings, organization] = await Promise.all([
    prisma.employee.findMany({
      where: { organizationId, status: "ACTIVE", payrollEnrollment: { is: { isActive: true } } },
      include: {
        salaryStructures: {
          where: { effectiveFrom: { lte: run.periodEnd }, OR: [{ effectiveTo: null }, { effectiveTo: { gte: run.periodStart } }] },
          orderBy: { effectiveFrom: "desc" }, take: 1
        },
        loans: true,
        department: { select: { id: true, name: true } }
      }
    }),
    prisma.organizationGeneralSettings.findUnique({ where: { organizationId }, select: { currency: true } }),
    prisma.organization.findUnique({ where: { id: organizationId }, select: { currency: true } })
  ]);
  const currency = settings?.currency ?? organization?.currency ?? "NGN";

  const payslips = await prisma.$transaction(
    employees
      .filter((employee) => employee.salaryStructures.length > 0)
      .map((employee) => {
        const salary = employee.salaryStructures[0]!;
        const grossPay =
          Number(salary.basic) + Number(salary.housing) + Number(salary.transport) + Number(salary.otherAllowance);
        const payeTax = grossPay * 0.1;
        const pension = grossPay * 0.08;
        const loanDeduction = employee.loans.reduce(
          (sum, loan) => sum + Math.min(Number(loan.outstanding), grossPay * 0.05),
          0
        );
        const deductions = payeTax + pension + loanDeduction;
        const earningsSnapshot = [
          { code: "BASIC", name: "Basic", amount: Number(salary.basic) },
          { code: "HOUSING", name: "Housing", amount: Number(salary.housing) },
          { code: "TRANSPORT", name: "Transport", amount: Number(salary.transport) },
          { code: "OTHER_ALLOWANCE", name: "Other allowance", amount: Number(salary.otherAllowance) }
        ].filter((item) => item.amount !== 0);
        const deductionsSnapshot = [
          { code: "PAYE", name: "PAYE Tax", amount: payeTax },
          { code: "PENSION", name: "Pension", amount: pension },
          { code: "LOAN", name: "Loan deduction", amount: loanDeduction }
        ].filter((item) => item.amount !== 0);

        return prisma.payslip.upsert({
          where: {
            payrollRunId_employeeId: {
              payrollRunId: run.id,
              employeeId: employee.id
            }
          },
          update: {
            grossPay,
            payeTax,
            pension,
            deductions,
            netPay: grossPay - deductions,
            currency,
            earningsSnapshot,
            deductionsSnapshot,
            departmentIdSnapshot: employee.department?.id ?? null,
            departmentNameSnapshot: employee.department?.name ?? null
          },
          create: {
            organizationId,
            payrollRunId: run.id,
            employeeId: employee.id,
            grossPay,
            payeTax,
            pension,
            deductions,
            netPay: grossPay - deductions,
            currency,
            earningsSnapshot,
            deductionsSnapshot,
            departmentIdSnapshot: employee.department?.id ?? null,
            departmentNameSnapshot: employee.department?.name ?? null
          }
        });
      })
  );

  return { count: payslips.length, data: payslips };
};

export const enqueuePayslipGeneration = async (organizationId: string, payrollRunId: string, requestedByUserId?: string) => {
  if (env.BACKGROUND_JOBS_MODE === "inline") {
    const result = await generatePayslips(organizationId, payrollRunId);
    return {
      queued: false,
      duplicate: false,
      executionMode: "inline" as const,
      payrollRunId,
      generatedCount: result.count
    };
  }

  if (!isQueueBackendAvailable()) {
    throw badRequest("Payslip generation queue is unavailable because Redis is not connected")
  }

  const run = await prisma.payrollRun.findFirst({
    where: { id: payrollRunId, organizationId },
    select: { id: true, status: true }
  });

  if (!run) throw notFound("Payroll run not found");
  if (run.status !== "DRAFT" && run.status !== "PROCESSING") {
    throw badRequest("Payslips can only be generated for draft or processing payroll runs");
  }

  const payrollQueue = getQueueByName(PAYROLL_QUEUE_NAME);
  const jobId = `${PAYROLL_GENERATE_PAYSLIPS_JOB}:${organizationId}:${payrollRunId}`;
  const existingJob = await payrollQueue.getJob(jobId);

  if (existingJob) {
    return {
      queued: true,
      duplicate: true,
      jobId: String(existingJob.id),
      state: await existingJob.getState()
    };
  }

  const job = await payrollQueue.add(
    PAYROLL_GENERATE_PAYSLIPS_JOB,
    { organizationId, payrollRunId, requestedByUserId },
    {
      jobId,
      attempts: 3,
      backoff: {
        type: "exponential",
        delay: 5000
      },
      removeOnComplete: 100,
      removeOnFail: 200
    }
  );

  return {
    queued: true,
    duplicate: false,
    executionMode: "queue" as const,
    jobId: String(job.id),
    state: await job.getState()
  };
};

export const runsCrudOptions = {
  model: "payrollRun" as const,
  createSchema: payrollRunCreateSchema,
  updateSchema: payrollRunUpdateSchema,
  permission: "payroll:runs:update" as const,
  searchableFields: ["name"],
  include: { payslips: true }
};

export const salaryStructuresCrudOptions = {
  model: "salaryStructure" as const,
  createSchema: salaryCreateSchema,
  updateSchema: salaryUpdateSchema,
  permission: "payroll:salary:update" as const,
  searchableFields: ["title"],
  include: { employee: true }
};

export const statutoryCrudOptions = {
  model: "taxReport" as const,
  createSchema: taxReportCreateSchema,
  updateSchema: taxReportUpdateSchema,
  permission: "payroll:statutory:update" as const,
  searchableFields: ["type", "reference"]
};

export const isMutablePayrollRunStatus = (status: string) => status === "DRAFT" || status === "PROCESSING";
const assertPayslipMutable = async (organizationId: string, payslipId: string) => {
  const payslip = await prisma.payslip.findFirst({ where: { id: payslipId, organizationId }, select: { payrollrun: { select: { status: true } } } });
  if (!payslip) throw notFound("Payslip not found");
  if (!isMutablePayrollRunStatus(payslip.payrollrun.status)) throw conflict("Finalized payslips are immutable");
};

export const payslipsCrudOptions = {
  model: "payslip" as const,
  createSchema: payslipCreateSchema,
  updateSchema: payslipUpdateSchema,
  permission: "payroll:payslips:update" as const,
  include: { employee: true, payrollrun: true },
  beforeCreate: async (data: Record<string, unknown>, req: any) => {
    const run = await prisma.payrollRun.findFirst({ where: { id: String(data.payrollRunId), organizationId: req.organizationId }, select: { status: true } });
    if (!run) throw notFound("Payroll run not found"); if (!isMutablePayrollRunStatus(run.status)) throw conflict("Finalized payroll runs cannot receive new payslips"); return data;
  },
  beforeUpdate: async (data: Record<string, unknown>, req: any) => { await assertPayslipMutable(req.organizationId, String(req.params.id)); return data; },
  beforeDelete: async ({ req }: any) => { await assertPayslipMutable(req.organizationId, String(req.params.id)); }
};

export const loansCrudOptions = {
  model: "loanAdvance" as const,
  createSchema: loanCreateSchema,
  updateSchema: loanUpdateSchema,
  permission: "payroll:loans:update" as const,
  include: { employee: true }
};
