import { z } from "zod";
import {
  clientCreateSchema,
  clientUpdateSchema,
  disbursementCreateSchema,
  disbursementUpdateSchema,
  invitationCreateSchema,
  invitationUpdateSchema,
  taxReportCreateSchema,
  taxReportUpdateSchema,
  walletCreateSchema,
  walletUpdateSchema,
} from "../common.schemas";

const page = z.coerce.number().int().min(1).default(1);
const limit = z.coerce.number().int().min(1).max(100).default(20);
const sortOrder = z.enum(["asc", "desc"]).default("desc");
const idParams = z.object({ id: z.string().trim().min(1).max(191) }).strict();
const optionalText = z.string().trim().min(1).max(2000).optional();
const money = z
  .union([
    z.string().regex(/^\d+(\.\d{1,2})?$/),
    z.number().nonnegative().finite(),
  ])
  .transform(String);
const positiveMoney = money.refine(
  (value) => Number(value) > 0,
  "Amount must be greater than zero",
);
const ranged = <T extends z.ZodRawShape>(shape: T) =>
  z
    .object(shape)
    .strict()
    .superRefine((value: any, context) => {
      if (value.fromDate && value.toDate && value.fromDate > value.toDate)
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["toDate"],
          message: "toDate cannot precede fromDate",
        });
    });

export const accountingListQuerySchema = z
  .object({
    search: z.string().trim().max(100).optional(),
    status: z.enum(["ALL", "ACTIVE", "INACTIVE"]).default("ALL"),
    page,
    limit,
    sortBy: z.enum(["createdAt", "name", "status"]).default("createdAt"),
    sortOrder,
  })
  .strict();
export const customerParamsSchema = idParams;
export const customerCreateSchema = z
  .object({
    companyName: z.string().trim().min(2).max(191),
    taxId: optionalText,
    contactPerson: optionalText,
    email: z.string().trim().email().optional(),
    phone: z
      .string()
      .trim()
      .regex(/^\+[1-9]\d{7,14}$/)
      .optional(),
    address: optionalText,
  })
  .strict();
export const customerUpdateSchema = customerCreateSchema
  .partial()
  .extend({ status: z.enum(["ACTIVE", "INACTIVE"]).optional() })
  .strict()
  .refine(
    (value) => Object.keys(value).length > 0,
    "At least one field is required",
  );

export const catalogueListQuerySchema = z
  .object({
    search: z.string().trim().max(100).optional(),
    type: z.enum(["ALL", "ITEM", "PRODUCT", "SERVICE"]).default("ALL"),
    status: z.enum(["ALL", "ACTIVE", "INACTIVE"]).default("ALL"),
    page,
    limit,
    sortBy: z
      .enum(["createdAt", "name", "unitPrice", "type"])
      .default("createdAt"),
    sortOrder,
  })
  .strict();
export const catalogueParamsSchema = idParams;
export const catalogueCreateSchema = z
  .object({
    name: z.string().trim().min(2).max(191),
    type: z.enum(["ITEM", "PRODUCT", "SERVICE"]),
    unitPrice: money,
    unit: z.string().trim().min(1).max(50),
    description: optionalText,
    vatApplicable: z.boolean().default(false),
  })
  .strict();
export const catalogueUpdateSchema = catalogueCreateSchema
  .partial()
  .extend({ status: z.enum(["ACTIVE", "INACTIVE"]).optional() })
  .strict()
  .refine(
    (value) => Object.keys(value).length > 0,
    "At least one field is required",
  );

export const projectListQuerySchema = z
  .object({
    search: z.string().trim().max(100).optional(),
    status: z.enum(["ALL", "ACTIVE", "ON_HOLD", "COMPLETED"]).default("ALL"),
    page,
    limit,
    sortBy: z
      .enum(["createdAt", "name", "value", "startDate", "endDate", "status"])
      .default("createdAt"),
    sortOrder,
  })
  .strict();
export const projectParamsSchema = idParams;
const projectBody = z
  .object({
    name: z.string().trim().min(2).max(191),
    clientId: z.string().trim().min(1).max(191),
    assignedAgentId: z.string().trim().min(1).max(191).nullable().optional(),
    value: money,
    startDate: z.coerce.date(),
    endDate: z.coerce.date().nullable().optional(),
    status: z.enum(["ACTIVE", "ON_HOLD", "COMPLETED"]).default("ACTIVE"),
  })
  .strict();
export const projectCreateSchema = projectBody.superRefine((value, context) => {
  if (value.endDate && value.endDate < value.startDate)
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["endDate"],
      message: "End date cannot precede start date",
    });
});
export const projectUpdateSchema = projectBody
  .partial()
  .strict()
  .superRefine((value, context) => {
    if (!Object.keys(value).length)
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "At least one field is required",
      });
    if (value.startDate && value.endDate && value.endDate < value.startDate)
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["endDate"],
        message: "End date cannot precede start date",
      });
  });

export const invoiceIdParamsSchema = idParams;
export const invoiceLineSchema = z
  .object({
    catalogueItemId: z.string().trim().min(1).optional(),
    description: z.string().trim().min(2).max(1000).optional(),
    quantity: positiveMoney,
    unitPrice: money.optional(),
    vatApplicable: z.boolean().optional(),
  })
  .strict()
  .refine(
    (value) =>
      value.catalogueItemId ||
      (value.description && value.unitPrice !== undefined),
    "Catalogue item or description and unit price are required",
  );
const invoiceBody = z.object({
    clientId: z.string().trim().min(1),
    assignedAgentId: z.string().trim().min(1).nullable().optional(),
    projectId: z.string().trim().min(1).nullable().optional(),
    issueDate: z.coerce.date().optional(),
    dueDate: z.coerce.date(),
    notes: optionalText,
    whtApplicable: z.boolean().default(false),
    whtRate: z.union([z.literal(5), z.literal(10)]).optional(),
    items: z.array(invoiceLineSchema).min(1).max(200),
  }).strict();
export const invoiceCreateSchema = invoiceBody.superRefine((value, context) => {
    if (value.whtApplicable && value.whtRate === undefined)
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["whtRate"], message: "WHT rate is required when WHT is enabled" });
    if (!value.whtApplicable && value.whtRate !== undefined)
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["whtRate"], message: "WHT rate requires WHT to be enabled" });
  const issueDay = new Date(
    (value.issueDate ?? new Date()).toISOString().slice(0, 10),
  );
  if (value.dueDate < issueDay)
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["dueDate"],
      message: "Due date cannot precede issue date",
    });
});
export const invoiceUpdateSchema = invoiceBody
  .partial()
  .strict()
  .refine(
    (value) => Object.keys(value).length > 0,
    "At least one field is required",
  );
export const invoiceListQuerySchema = ranged({
  search: z.string().trim().max(100).optional(),
  clientId: z.string().trim().min(1).optional(),
  agentId: z.string().trim().min(1).optional(),
  projectId: z.string().trim().min(1).optional(),
  status: z
    .enum(["ALL", "DRAFT", "SENT", "PARTIALLY_PAID", "PAID", "OVERDUE", "VOID"])
    .default("ALL"),
  fromDate: z.coerce.date().optional(),
  toDate: z.coerce.date().optional(),
  page,
  limit,
  sortBy: z
    .enum(["issueDate", "dueDate", "total", "createdAt", "status"])
    .default("createdAt"),
  sortOrder,
});
export const invoicePaymentSchema = z
  .object({
    reference: z.string().trim().min(3).max(191),
    amount: positiveMoney,
    paidAt: z.coerce.date().optional(),
    notes: optionalText,
  })
  .strict();

export const agentListQuerySchema = z
  .object({
    search: z.string().trim().max(100).optional(),
    status: z.enum(["ALL", "ACTIVE", "PENDING", "INACTIVE"]).default("ALL"),
    page,
    limit,
  })
  .strict();
export const agentInviteSchema = z
  .object({
    fullName: z.string().trim().min(2).max(191),
    email: z.string().trim().email(),
    phone: z
      .string()
      .trim()
      .regex(/^\+[1-9]\d{7,14}$/)
      .optional(),
    roleId: z.string().trim().min(1),
  })
  .strict();
export const agentBulkInviteSchema = z
  .object({
    entries: z.string().min(3).max(10000),
    roleId: z.string().trim().min(1),
  })
  .strict();
export const agentUpdateSchema = z
  .object({
    fullName: z.string().trim().min(2).max(191).optional(),
    phone: z
      .string()
      .trim()
      .regex(/^\+[1-9]\d{7,14}$/)
      .nullable()
      .optional(),
    roleId: z.string().trim().min(1).optional(),
    status: z.enum(["ACTIVE", "INACTIVE"]).optional(),
  })
  .strict()
  .refine(
    (value) => Object.keys(value).length > 0,
    "At least one field is required",
  );

export const paymentRequestCreateSchema = z
  .object({
    title: z.string().trim().min(2).max(191),
    description: optionalText,
    invoiceId: z.string().trim().min(1).optional(),
    projectId: z.string().trim().min(1).optional(),
    clientId: z.string().trim().min(1).optional(),
    amount: positiveMoney,
  })
  .strict();
export const paymentRequestListQuerySchema = ranged({
  search: z.string().trim().max(100).optional(),
  status: z
    .enum([
      "ALL",
      "DRAFT",
      "PENDING",
      "APPROVED",
      "REJECTED",
      "PAID",
      "COMPLETED",
      "DECLINED",
    ])
    .default("ALL"),
  fromDate: z.coerce.date().optional(),
  toDate: z.coerce.date().optional(),
  page,
  limit,
}).transform((value) => ({
  ...value,
  status:
    value.status === "COMPLETED"
      ? ("PAID" as const)
      : value.status === "DECLINED"
        ? ("REJECTED" as const)
        : value.status,
}));
export const paymentRequestDecisionSchema = z
  .object({ reason: z.string().trim().min(2).max(1000).optional() })
  .strict();
export const paymentRequestDisbursementSchema = z
  .object({
    walletAccountId: z.string().trim().min(1),
    idempotencyKey: z.string().trim().min(8).max(191),
  })
  .strict();

const expenseBodySchema = z.object({
    expenseDate: z.coerce.date(),
    category: z.string().trim().min(2).max(100).optional(),
    categoryId: z.string().trim().min(1).optional(),
    description: z.string().trim().min(2).max(2000),
    amount: positiveMoney,
    receiptReference: z.string().trim().min(1).max(191).optional(),
  }).strict();
export const expenseCreateSchema = expenseBodySchema
  .refine(value => value.category || value.categoryId, "Category or categoryId is required");
export const expenseUpdateSchema = expenseBodySchema
  .partial()
  .strict()
  .refine(
    (value) => Object.keys(value).length > 0,
    "At least one field is required",
  );
export const expenseListQuerySchema = ranged({
  search: z.string().trim().max(100).optional(),
  category: z.string().trim().max(100).optional(),
  fromDate: z.coerce.date().optional(),
  toDate: z.coerce.date().optional(),
  page,
  limit,
  sortBy: z
    .enum(["expenseDate", "amount", "createdAt", "category"])
    .default("expenseDate"),
  sortOrder,
});
export const reminderListQuerySchema = z
  .object({
    filter: z.enum(["ALL", "UNREAD", "UPCOMING", "OVERDUE"]).default("ALL"),
    page,
    limit,
  })
  .strict();
export const reminderConfigurationSchema = z
  .object({
    upcomingDays: z
      .array(z.number().int().min(0).max(365))
      .max(20)
      .transform((items) => [...new Set(items)].sort((a, b) => b - a)),
    overdueIntervals: z
      .array(z.number().int().min(1).max(365))
      .max(20)
      .transform((items) => [...new Set(items)].sort((a, b) => a - b)),
    inAppEnabled: z.boolean(),
    emailEnabled: z.boolean(),
  })
  .strict()
  .refine(
    (value) => value.inAppEnabled || value.emailEnabled,
    "At least one reminder channel must be enabled",
  );

export const accountingReportQuerySchema = ranged({
  search: z.string().trim().max(100).optional(),
  clientId: z.string().trim().min(1).optional(),
  agentId: z.string().trim().min(1).optional(),
  projectId: z.string().trim().min(1).optional(),
  status: z.enum(["ALL", "DRAFT", "SENT", "PARTIALLY_PAID", "PAID", "OVERDUE", "VOID"]).default("ALL"),
  fromDate: z.coerce.date().optional(), toDate: z.coerce.date().optional(),
  page, limit,
  sortBy: z.enum(["issueDate", "dueDate", "total", "createdAt", "status"]).default("createdAt"),
  sortOrder,
  itemServiceId: z.string().trim().min(1).optional(),
  groupBy: z.enum(["CLIENT", "AGENT", "PROJECT"]).optional(),
});
export const walletTransactionQuerySchema = z.object({
  direction: z.enum(["ALL", "INFLOW", "OUTFLOW"]).default("ALL"), page, limit,
}).strict();
export const manualWalletFundingSchema = z.object({
  walletAccountId: z.string().trim().min(1), amount: positiveMoney,
  description: z.string().trim().min(2).max(500),
  externalReference: z.string().trim().min(2).max(191),
}).strict();
export const paystackFundingSchema = z.object({
  walletAccountId: z.string().trim().min(1), amount: positiveMoney,
}).strict();
export const paystackReferenceParamsSchema = z.object({
  reference: z.string().trim().min(8).max(191).regex(/^[A-Za-z0-9._-]+$/),
}).strict();
export const invoiceTemplateCreateSchema = z.object({
  name: z.string().trim().min(2).max(191), paymentTerms: optionalText,
  headerNote: optionalText, footerNote: optionalText,
}).strict();
export const invoiceTemplateUpdateSchema = invoiceTemplateCreateSchema.partial().refine(
  (value) => Object.keys(value).length > 0, "At least one field is required",
);
export const expenseCategoryCreateSchema = z.object({
  name: z.string().trim().min(2).max(100),
  description: z.string().trim().max(1000).optional(),
}).strict();
export const uiReminderSettingsSchema = z.object({
  automaticRemindersEnabled: z.boolean(),
  firstReminderDaysBeforeDue: z.union([z.literal(1), z.literal(3), z.literal(5), z.literal(7), z.literal(14)]),
  overdueReminderFrequency: z.enum(["NEVER", "ONCE", "EVERY_3_DAYS", "EVERY_7_DAYS"]),
  inAppEnabled: z.boolean(), emailEnabled: z.boolean(),
}).strict().refine(v => !v.automaticRemindersEnabled || v.inAppEnabled || v.emailEnabled,
  "At least one channel is required when automatic reminders are enabled");
export const accountingEntityParamsSchema = idParams;

export {
  clientCreateSchema,
  clientUpdateSchema,
  disbursementCreateSchema,
  disbursementUpdateSchema,
  invitationCreateSchema,
  invitationUpdateSchema,
  taxReportCreateSchema,
  taxReportUpdateSchema,
  walletCreateSchema,
  walletUpdateSchema,
};
