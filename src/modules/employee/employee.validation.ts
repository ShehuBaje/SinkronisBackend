import { z } from "zod";

// The dashboard identity is derived exclusively from authentication context.
export const employeeDashboardQuerySchema = z.object({}).strict();

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
