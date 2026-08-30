import { z } from "zod";

export const stringId = z.string().min(1);
export const optionalText = z.string().trim().min(1).optional();
export const moduleAccessItemSchema = z.enum(["HRIS", "ACCOUNTING", "PAYROLL"]);
export const optionalE164Phone = z
  .string()
  .regex(/^\+[1-9]\d{7,14}$/, "Phone must be a valid E.164 number")
  .optional();
export const money = z.coerce.number().nonnegative();
export const dateValue = z.coerce.date();

export const organizationUpdateSchema = z.object({
  name: optionalText,
  profileImageUrl: z.string().url().optional(),
  email: z.string().email().optional(),
  phone: optionalE164Phone,
  industry: optionalText,
  address: optionalText,
  registrationAddress: optionalText,
  country: optionalText,
  currency: z.string().length(3).optional(),
  taxId: optionalText,
  cacNumber: optionalText,
  website: z.string().url().optional(),
  fiscalYearStart: z.string().regex(/^\d{2}-\d{2}$/, "Fiscal year start must be MM-DD").optional(),
  companySize: z.string().min(2).optional()
});

export const departmentCreateSchema = z.object({
  name: z.string().min(2),
  description: optionalText,
  headEmployeeId: stringId.optional()
});
export const departmentUpdateSchema = departmentCreateSchema.partial();

export const branchCreateSchema = z.object({
  name: z.string().min(2),
  address: z.string().min(3),
  phone: optionalE164Phone
});
export const branchUpdateSchema = branchCreateSchema.partial();

export const workScheduleUpsertSchema = z.object({
  monday: z.boolean(),
  tuesday: z.boolean(),
  wednesday: z.boolean(),
  thursday: z.boolean(),
  friday: z.boolean(),
  saturday: z.boolean(),
  sunday: z.boolean(),
  workStartTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Work start time must be HH:mm"),
  workEndTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Work end time must be HH:mm"),
  breakDurationMinutes: z.coerce.number().int().min(0).max(600)
});

export const teamCreateSchema = z.object({
  departmentId: stringId.optional(),
  name: z.string().min(2),
  description: optionalText
});
export const teamUpdateSchema = teamCreateSchema.partial();

export const employeeCreateSchema = z.object({
  departmentId: stringId.optional(),
  teamId: stringId.optional(),
  employeeNo: z.string().min(1),
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  email: z.string().email(),
  phone: optionalE164Phone,
  jobTitle: optionalText,
  hireDate: dateValue.optional(),
  status: z.enum(["ACTIVE", "ON_LEAVE", "SUSPENDED", "TERMINATED"]).optional(),
  baseSalary: money.optional(),
  bankName: optionalText,
  bankAccountNumber: optionalText,
  pensionPin: optionalText
});
export const employeeUpdateSchema = employeeCreateSchema.partial();

export const roleCreateSchema = z.object({
  name: z.string().min(2),
  description: optionalText,
  permissionKeys: z.array(z.string()).default([])
});
export const roleUpdateSchema = roleCreateSchema.partial();

export const systemConfigCreateSchema = z.object({
  key: z.string().min(1),
  value: z.unknown()
});
export const systemConfigUpdateSchema = systemConfigCreateSchema.partial();

export const leaveCreateSchema = z.object({
  employeeId: stringId,
  type: z.string().min(2),
  startDate: dateValue,
  endDate: dateValue,
  reason: optionalText,
  status: z.enum(["DRAFT", "PENDING", "APPROVED", "REJECTED", "CANCELLED"]).optional()
});
export const leaveUpdateSchema = leaveCreateSchema.partial().extend({
  reviewedBy: stringId.optional(),
  reviewedAt: dateValue.optional()
});

export const appraisalCreateSchema = z.object({
  title: z.string().min(2),
  periodStart: dateValue,
  periodEnd: dateValue,
  status: z.enum(["DRAFT", "OPEN", "CLOSED", "ARCHIVED"]).optional()
});
export const appraisalUpdateSchema = appraisalCreateSchema.partial();

export const conductCreateSchema = z.object({
  employeeId: stringId,
  category: z.string().min(2),
  summary: z.string().min(2),
  details: optionalText,
  incidentDate: dateValue
});
export const conductUpdateSchema = conductCreateSchema.partial();

export const clientCreateSchema = z.object({
  name: z.string().min(2),
  email: z.string().email().optional(),
  phone: optionalE164Phone,
  address: optionalText,
  taxId: optionalText
});
export const clientUpdateSchema = clientCreateSchema.partial();

export const invoiceItemSchema = z.object({
  description: z.string().min(2),
  quantity: money,
  unitPrice: money
});
export const invoiceCreateSchema = z.object({
  clientId: stringId,
  invoiceNo: z.string().min(1),
  issueDate: dateValue,
  dueDate: dateValue.optional(),
  status: z.enum(["DRAFT", "SENT", "PAID", "VOID", "OVERDUE"]).optional(),
  taxAmount: money.default(0),
  notes: optionalText,
  items: z.array(invoiceItemSchema).min(1)
});
export const invoiceUpdateSchema = invoiceCreateSchema.partial();

export const paymentRequestCreateSchema = z.object({
  title: z.string().min(2),
  vendorName: optionalText,
  amount: money,
  currency: z.string().length(3).default("NGN"),
  status: z.enum(["DRAFT", "PENDING", "APPROVED", "REJECTED", "PAID"]).optional(),
  requestedBy: stringId.optional()
});
export const paymentRequestUpdateSchema = paymentRequestCreateSchema.partial().extend({
  approvedBy: stringId.optional(),
  approvedAt: dateValue.optional()
});

export const taxReportCreateSchema = z.object({
  periodStart: dateValue,
  periodEnd: dateValue,
  type: z.string().min(2),
  amount: money,
  dueDate: dateValue.optional(),
  submittedAt: dateValue.optional(),
  reference: optionalText
});
export const taxReportUpdateSchema = taxReportCreateSchema.partial();

export const walletCreateSchema = z.object({
  name: z.string().min(2),
  balance: money.optional(),
  currency: z.string().length(3).default("NGN")
});
export const walletUpdateSchema = walletCreateSchema.partial();

export const disbursementCreateSchema = z.object({
  walletAccountId: stringId,
  beneficiaryName: z.string().min(2),
  amount: money,
  status: z.enum(["PENDING", "PROCESSING", "COMPLETED", "FAILED"]).optional(),
  reference: optionalText
});
export const disbursementUpdateSchema = disbursementCreateSchema.partial();

export const invitationCreateSchema = z.object({
  email: z.string().email(),
  expiresAt: dateValue
});
export const invitationUpdateSchema = z.object({
  status: z.enum(["PENDING", "ACCEPTED", "EXPIRED", "REVOKED"]).optional(),
  acceptedAt: dateValue.optional()
});

export const userManagementAnalyticsQuerySchema = z.object({
  module: moduleAccessItemSchema.optional()
});

export const userManagementUsersQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  search: z.string().optional(),
  role: z.string().optional(),
  status: z.enum(["ACTIVE", "INACTIVE"]).optional(),
  module: moduleAccessItemSchema.optional()
});

export const userManagementUpdateUserSchema = z
  .object({
    roleId: stringId.optional(),
    isActive: z.boolean().optional()
  })
  .refine((payload) => payload.roleId !== undefined || payload.isActive !== undefined, {
    message: "At least one field is required"
  });

export const userManagementInviteSchema = z.object({
  email: z.string().email(),
  roleId: stringId,
  moduleAccess: z.array(moduleAccessItemSchema).min(1)
});

export const userManagementInvitationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  search: z.string().optional(),
  status: z.enum(["PENDING", "EXPIRED"]).optional()
});

export const userGroupTypeSchema = z.preprocess(
  (value) => (typeof value === "string" ? value.toUpperCase() : value),
  z.enum(["DEPARTMENT", "FUNCTION"])
);

export const userManagementGroupQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  search: z.string().optional(),
  type: userGroupTypeSchema.optional()
});

export const userManagementCreateGroupSchema = z.object({
  name: z.string().min(2),
  type: userGroupTypeSchema,
  description: optionalText
});

export const userManagementUpdateGroupSchema = z
  .object({
    name: z.string().min(2).optional(),
    description: optionalText
  })
  .refine((payload) => payload.name !== undefined || payload.description !== undefined, {
    message: "At least one field is required"
  });

export const salaryCreateSchema = z.object({
  employeeId: stringId,
  title: z.string().min(2),
  basic: money,
  housing: money.default(0),
  transport: money.default(0),
  otherAllowance: money.default(0),
  effectiveFrom: dateValue,
  effectiveTo: dateValue.optional()
});
export const salaryUpdateSchema = salaryCreateSchema.partial();

export const payrollRunCreateSchema = z.object({
  name: z.string().min(2),
  periodStart: dateValue,
  periodEnd: dateValue,
  payDate: dateValue.optional(),
  status: z.enum(["DRAFT", "PROCESSING", "PENDING_APPROVAL", "APPROVED", "PENDING_DISBURSEMENT", "DISBURSING", "DISBURSED", "FAILED", "PAID", "CANCELLED"]).optional()
});
export const payrollRunUpdateSchema = payrollRunCreateSchema.partial();

export const payslipCreateSchema = z.object({
  payrollRunId: stringId,
  employeeId: stringId,
  grossPay: money,
  payeTax: money.default(0),
  pension: money.default(0),
  employerPension: money.default(0),
  nhf: money.default(0),
  nsitf: money.default(0),
  deductions: money.default(0),
  netPay: money
});
export const payslipUpdateSchema = payslipCreateSchema.partial();

export const loanCreateSchema = z.object({
  employeeId: stringId,
  amount: money,
  outstanding: money,
  reason: optionalText,
  issuedAt: dateValue
});
export const loanUpdateSchema = loanCreateSchema.partial();
