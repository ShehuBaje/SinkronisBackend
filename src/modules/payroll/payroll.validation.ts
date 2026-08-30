import { z } from "zod";
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
  taxReportUpdateSchema
} from "../common.schemas";

export const generatePayslipParamsSchema = z.object({ id: z.string().min(1) });
export const payrollDashboardQuerySchema = z.object({}).strict();
const payrollMoney = z.coerce.number().finite().min(0).max(1_000_000_000);
const payrollDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
export const payrollEmployeeParamsSchema = z.object({ employeeId: z.string().cuid() }).strict();
export const payrollEmployeeDeductionParamsSchema = z.object({ employeeId: z.string().cuid(), deductionId: z.string().cuid() }).strict();
export const payrollEmployeesQuerySchema = z.object({ page: z.coerce.number().int().min(1).default(1), limit: z.coerce.number().int().min(1).max(100).default(20), search: z.string().trim().max(100).optional(), departmentId: z.string().cuid().optional(), status: z.enum(["ACTIVE", "INACTIVE", "ON_LEAVE", "SUSPENDED", "TERMINATED"]).optional(), employmentType: z.enum(["FULL_TIME", "PART_TIME", "CONTRACT"]).optional(), payrollStatus: z.enum(["ON_PAYROLL", "OFF_PAYROLL"]).optional(), sortBy: z.enum(["name", "department", "gross", "netPay", "status"]).default("name"), sortOrder: z.enum(["asc", "desc"]).default("asc") }).strict();
export const payrollHistoryQuerySchema = z.object({ page: z.coerce.number().int().min(1).default(1), limit: z.coerce.number().int().min(1).max(100).default(20), year: z.coerce.number().int().min(2000).max(2200).optional(), sortOrder: z.enum(["asc", "desc"]).default("desc") }).strict();
export const payrollEnrollmentRemoveSchema = z.object({ reason: z.string().trim().min(3).max(1000).optional() }).strict();
export const payrollSalaryStructureSchema = z.object({ basicSalary: payrollMoney, housingAllowance: payrollMoney.default(0), transportAllowance: payrollMoney.default(0), otherAllowance: payrollMoney.default(0), additionalAllowances: z.array(z.object({ name: z.string().trim().min(2).max(100), amount: payrollMoney, taxable: z.boolean().default(true) }).strict()).max(30).default([]), effectiveFrom: payrollDate.optional(), proration: z.object({ resumeDate: payrollDate.nullable().default(null), method: z.enum(["WORKING_DAYS", "CALENDAR_DAYS"]).nullable().default(null) }).strict().default({ resumeDate: null, method: null }) }).strict();
export const payrollStatutoryProfileSchema = z.object({ taxState: z.string().trim().max(100).nullable().optional(), taxStatus: z.enum(["PAYE", "EXEMPT", "CONTRACTOR"]).default("PAYE"), tin: z.string().trim().max(100).nullable().optional(), pensionPin: z.string().trim().max(100).nullable().optional(), nhfNumber: z.string().trim().max(100).nullable().optional(), pfaName: z.string().trim().max(150).nullable().optional() }).strict();
export const payrollDeductionSchema = z.object({ name: z.string().trim().min(2).max(150), amount: payrollMoney.refine((value) => value > 0), frequency: z.enum(["MONTHLY", "ONE_OFF"]).default("MONTHLY"), effectiveFrom: payrollDate.optional(), effectiveTo: payrollDate.optional() }).strict();
export const payrollLoanSchema = z.object({ purpose: z.string().trim().min(2).max(500), type: z.enum(["RECURRING", "ONE_OFF"]), principal: payrollMoney.refine((value) => value > 0), monthlyRepayment: payrollMoney.optional(), startDate: payrollDate }).strict().superRefine((value, context) => { if (value.type === "RECURRING" && (!value.monthlyRepayment || value.monthlyRepayment > value.principal)) context.addIssue({ code: z.ZodIssueCode.custom, path: ["monthlyRepayment"], message: "Recurring repayment must be greater than zero and no more than principal" }); });
export const payrollBikSchema = z.object({ hmoHealthInsurance: payrollMoney.default(0), airtimeAllowance: payrollMoney.default(0), mealAllowance: payrollMoney.default(0), thirteenthMonthAnnual: payrollMoney.default(0) }).strict();
export const payrollCreateEmployeeSchema = z.object({ fullName: z.string().trim().min(2).max(200), role: z.string().trim().min(2).max(150), departmentId: z.string().cuid().optional(), email: z.string().email(), phone: z.string().trim().max(30).optional(), state: z.string().trim().max(100).optional(), employmentType: z.enum(["FULL_TIME", "PART_TIME", "CONTRACT"]), employeeStatus: z.enum(["ACTIVE", "INACTIVE", "ON_LEAVE", "SUSPENDED"]).default("ACTIVE"), taxStatus: z.enum(["PAYE", "EXEMPT", "CONTRACTOR"]).default("PAYE"), bankName: z.string().trim().max(150).optional(), accountNumber: z.string().trim().regex(/^\d{6,20}$/).optional(), salary: payrollSalaryStructureSchema, enroll: z.boolean().default(false) }).strict();

export {
  loanCreateSchema,
  loanUpdateSchema,
  payslipCreateSchema,
  payslipUpdateSchema,
  payrollRunCreateSchema,
  payrollRunUpdateSchema,
  salaryCreateSchema,
  salaryUpdateSchema,
  taxReportCreateSchema,
  taxReportUpdateSchema
};
