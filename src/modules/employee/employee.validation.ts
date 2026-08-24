import { z } from "zod";

// The dashboard identity is derived exclusively from authentication context.
export const employeeDashboardQuerySchema = z.object({}).strict();
export const employeeAttendanceQuerySchema = z.object({
  month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Expected YYYY-MM").optional()
}).strict();
export const employeeAttendanceParamsSchema = z.object({ attendanceId: z.string().trim().min(1).max(191) }).strict();
export const employeeAttendanceDisputeSchema = z.object({
  issueType: z.enum(["MISSING_CLOCK_IN", "MISSING_CLOCK_OUT", "SYSTEM_ERROR", "WRONG_STATUS", "OTHER"]),
  description: z.string().trim().min(10).max(2000),
  claimedClockIn: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Expected HH:mm").optional(),
  claimedClockOut: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Expected HH:mm").optional()
}).strict();
const leaveDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD");
export const employeeLeaveQuerySchema = z.object({
  month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Expected YYYY-MM").optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  status: z.enum(["ALL", "PENDING", "APPROVED", "REJECTED", "CANCELLED"]).default("ALL"),
  leaveType: z.string().trim().min(1).max(100).optional()
}).strict();
export const employeeLeaveRequestSchema = z.object({
  leaveTypeId: z.string().trim().min(1).max(191),
  startDate: leaveDate,
  endDate: leaveDate,
  reason: z.string().trim().min(3).max(2000),
  relieverEmployeeId: z.string().trim().min(1).max(191).optional()
}).strict().refine((value) => value.startDate <= value.endDate, { message: "endDate must not precede startDate", path: ["endDate"] });
export const employeeRelieverQuerySchema = z.object({ search: z.string().trim().min(1).max(100).optional(), limit: z.coerce.number().int().min(1).max(50).default(20) }).strict();
export const employeePayslipsQuerySchema = z.object({ year: z.coerce.number().int().min(2000).max(2200).optional() }).strict();
export const employeePayslipParamsSchema = z.object({ payslipId: z.string().trim().min(1).max(191) }).strict();

const optionalText = (max: number) => z.string().trim().min(1).max(max).nullable().optional();
export const updateEmployeePersonalDetailsSchema = z.object({
  phoneNumber: z.string().trim().regex(/^\+?[1-9]\d{7,14}$/).nullable().optional(),
  personalEmail: z.string().trim().email().max(254).optional(),
  address: optionalText(2000),
  maritalStatus: z.enum(["SINGLE", "MARRIED", "DIVORCED", "WIDOWED", "SEPARATED"]).nullable().optional(),
  nationality: optionalText(100)
}).strict().refine((value) => Object.keys(value).length > 0, "At least one editable personal field is required");

export const employeeDocumentParamsSchema = z.object({ documentId: z.string().cuid() }).strict();
export const bankUpdateRequestSchema = z.object({
  bankCode: z.string().trim().regex(/^[A-Za-z0-9-]{2,20}$/),
  bankName: z.string().trim().min(2).max(150),
  accountNumber: z.string().trim().regex(/^\d{6,20}$/),
  accountName: z.string().trim().min(2).max(150),
  accountType: z.enum(["SAVINGS", "CURRENT"]),
  reason: z.string().trim().min(3).max(1000).optional()
}).strict();
