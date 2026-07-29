import { z } from "zod";
import { permissions } from "../auth/permissions";
import { platformAnnouncementTypes, supportedCurrencies, supportedDateFormats, supportedLanguages, tenantNotificationChannelKeys, tenantNotificationModuleKeys } from "./admin.interface";
import { passesLuhn } from "../billing/billing.rules";
import {
  branchCreateSchema,
  branchUpdateSchema,
  departmentCreateSchema,
  departmentUpdateSchema,
  employeeCreateSchema,
  employeeUpdateSchema,
  organizationUpdateSchema,
  optionalText,
  roleCreateSchema as baseRoleCreateSchema,
  roleUpdateSchema as baseRoleUpdateSchema,
  systemConfigCreateSchema,
  systemConfigUpdateSchema,
  teamCreateSchema,
  teamUpdateSchema,
  userManagementAnalyticsQuerySchema,
  userManagementCreateGroupSchema,
  userManagementGroupQuerySchema,
  userManagementInvitationQuerySchema,
  userManagementInviteSchema,
  userManagementUpdateGroupSchema,
  userManagementUpdateUserSchema,
  userManagementUsersQuerySchema,
  workScheduleUpsertSchema
} from "../common.schemas";

export const actionParamsSchema = z.object({ id: z.string().min(1) });
export const moduleParamsSchema = z.object({ moduleKey: z.enum(["hris", "accounting", "payroll"]) });
export const moduleStatusUpdateSchema = z.object({
  status: z.enum(["ACTIVE", "INACTIVE", "COMING_SOON"])
});

export const billingPlanKeySchema = z.enum(["hris", "payroll", "accounting", "all-in-one"]);

export const myPlanChangeSchema = z.object({
  planKey: billingPlanKeySchema,
  billingCycle: z.enum(["MONTHLY", "YEARLY"]).optional(),
  confirm: z.boolean().default(false),
  paymentReference: z.string().min(3).max(200).optional(),
  automaticRenewal: z.boolean().default(true)
});
export const myPlanPurchaseSchema = myPlanChangeSchema;

export const myPlanAddonParamsSchema = z.object({ moduleKey: z.enum(["hris", "accounting", "payroll"]) });

export const myPlanAddonUpdateSchema = z.object({
  enabled: z.boolean(),
  confirm: z.boolean().default(false),
  paymentReference: z.string().min(3).max(200).optional(),
  automaticRenewal: z.boolean().default(true)
});

export const myPlanInvoiceParamsSchema = z.object({ invoiceId: z.string().min(1) });
export const myPlanChangeParamsSchema = z.object({ changeId: z.string().min(1) });

export const myPlanRenewalNotificationSchema = z.object({
  asOf: z.string().datetime().optional(),
  channels: z.array(z.enum(["EMAIL", "IN_APP", "PUSH"])).min(1).default(["EMAIL", "IN_APP"])
});

export const myPlanPaymentMethodSchema = z.object({
  paymentCardId: z.string().min(1)
});

export const myPlanAddCardSchema = z.object({
  cardNumber: z.string().min(12).max(19).regex(/^[0-9 ]+$/, "Card number must contain digits only"),
  cardHolderName: z.string().min(2).max(120),
  expiryDate: z.string().regex(/^(0[1-9]|1[0-2])\/?([0-9]{2}|[0-9]{4})$/, "Expiry date must be MM/YY or MM/YYYY"),
  cvv: z.string().min(3).max(4).regex(/^[0-9]+$/, "CVV must contain digits only"),
  makeDefault: z.boolean().default(true)
}).refine((value) => passesLuhn(value.cardNumber), { path: ["cardNumber"], message: "Card number is invalid" });

export const myPlanCardParamsSchema = z.object({ cardId: z.string().min(1) });
export const myPlanCardUpdateSchema = z.object({
  cardHolderName: z.string().min(2).max(120).optional(),
  expMonth: z.coerce.number().int().min(1).max(12).optional(),
  expYear: z.coerce.number().int().min(new Date().getFullYear()).max(new Date().getFullYear() + 20).optional(),
  makeDefault: z.boolean().optional()
}).refine((value) => Object.keys(value).length > 0, "At least one field is required");

export const myPlanCancelCardCreationSchema = z.object({
  reason: z.string().min(2).max(160).optional()
});

export const myPlanBillingAddressSchema = z.object({
  companyName: z.string().min(2).max(160),
  billingEmail: z.string().email(),
  address: z.string().min(5).max(500),
  country: z.string().length(2),
  state: z.string().min(1).max(120)
});

export const myPlanLocationOptionsQuerySchema = z.object({
  country: z.string().length(2).optional()
});

export const myPlanBillingHistoryQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  status: z.enum(["paid", "pending", "failed", "cancelled"]).optional(),
  year: z.coerce.number().int().min(2000).max(2100).optional()
});

export const myPlanBillingAnalyticsQuerySchema = z.object({
  year: z.coerce.number().int().min(2000).max(2100).optional()
});

export const myPlanCancelSubscriptionSchema = z.object({
  confirmationText: z.string().optional(),
  confirmCancel: z.boolean().optional(),
  keepPlan: z.boolean().optional()
});

export const notificationChannelParamsSchema = z.object({ channelKey: z.enum(tenantNotificationChannelKeys) });
export const notificationModuleParamsSchema = notificationChannelParamsSchema.extend({ moduleKey: z.enum(tenantNotificationModuleKeys) });
export const notificationCategoryParamsSchema = notificationModuleParamsSchema.extend({ categoryId: z.string().min(1) });
export const notificationToggleSchema = z.object({ enabled: z.boolean() }).strict();
export const announcementParamsSchema = z.object({ announcementId: z.string().min(1) });
export const announcementListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  type: z.enum(platformAnnouncementTypes).optional(),
  readStatus: z.enum(["ALL", "READ", "UNREAD"]).default("ALL"),
  sort: z.enum(["NEWEST", "OLDEST"]).default("NEWEST")
});

const supportedTimeZones = new Set(Intl.supportedValuesOf("timeZone"));
export const localeSettingsSchema = z.object({
  timeZone: z.string().refine((value) => supportedTimeZones.has(value), "Unsupported IANA time zone"),
  language: z.enum(supportedLanguages.map((item) => item.code) as ["en", "fr", "ar"]),
  dateFormat: z.enum(supportedDateFormats),
  currency: z.enum(supportedCurrencies.map((item) => item.code) as ["NGN", "USD", "GBP", "EUR"])
}).strict();
export const localeOptionsQuerySchema = z.object({ search: z.string().trim().max(100).optional(), limit: z.coerce.number().int().min(1).max(500).default(100) });
export const brandingSettingsSchema = z.object({
  accentColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/, "Accent color must be a six-digit hexadecimal value").optional(),
  linkText: z.string().trim().max(80).transform((value) => value.replace(/<[^>]*>/g, "")).nullable().optional()
}).strict().refine((value) => value.accentColor !== undefined || value.linkText !== undefined, "At least one branding field is required");
export const generalSettingsExportParamsSchema = z.object({ exportId: z.string().min(1) });
export const organizationDeletionRequestSchema = z.object({
  confirmationPhrase: z.literal("DELETE ORGANIZATION"),
  password: z.string().min(8),
  reason: z.string().trim().min(3).max(1000).optional()
}).strict();
export const securityPasswordPolicySchema = z.object({
  minPasswordLength: z.coerce.number().int().min(8).max(32),
  passwordExpiryDays: z.coerce.number().int().min(1).max(365),
  lockoutMaxAttempts: z.coerce.number().int().min(3).max(20),
  requireUppercase: z.boolean(),
  requireLowercase: z.boolean(),
  requireNumber: z.boolean(),
  requireSpecialCharacter: z.boolean()
});

export const securityTwoFactorSchema = z.object({
  twoFactorEnabled: z.boolean(),
  enforceTwoFactorForAllUsers: z.boolean(),
  allowAuthenticatorApp: z.boolean(),
  allowSmsOtp: z.boolean(),
  allowEmailOtp: z.boolean()
});

export const securitySessionsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  userId: z.string().min(1).optional(),
  status: z.enum(["ACTIVE", "REVOKED", "ALL"]).default("ACTIVE")
});

export const securityRevokeSessionSchema = z.object({
  reason: z.string().min(2).max(120).optional()
});

export const securityRevokeSessionsBulkSchema = z.object({
  sessionIds: z.array(z.string().min(1)).min(1).max(200),
  reason: z.string().min(2).max(120).optional()
});

export const ipAllowlistToggleSchema = z.object({
  enabled: z.boolean()
});

export const ipAllowlistEntryCreateSchema = z.object({
  value: z.string().min(3).max(120),
  label: z.string().min(1).max(80).optional()
});

export const loginActivityQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  status: z.enum(["SUCCESS", "FAILED", "BLOCKED"]).optional(),
  userId: z.string().min(1).optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional()
});

export const auditLogQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  search: z.string().trim().min(1).max(120).optional(),
  userId: z.string().min(1).optional(),
  action: z.string().min(1).max(120).optional(),
  module: z.string().min(1).max(80).optional(),
  dateFilter: z.enum(["day", "month", "year"]).optional(),
  date: z.string().min(4).max(10).optional()
});
const permissionKeySchema = z.enum(permissions);

export const roleTemplateKeys = ["SYSTEM_ADMIN", "MANAGER", "ACCOUNTANT", "EMPLOYEE"] as const;
export const roleTemplateKeySchema = z.enum(roleTemplateKeys);

export const departmentsTableQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  search: z.string().optional()
});

export const branchesTableQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  search: z.string().optional()
});

export const roleCreateSchema = baseRoleCreateSchema
  .omit({ permissionKeys: true })
  .extend({
    permissionKeys: z.array(permissionKeySchema).default([]),
    templateKey: roleTemplateKeySchema.optional(),
    cloneFromRoleId: z.string().min(1).optional()
  })
  .superRefine((data, ctx) => {
    const configuredSources = [
      data.permissionKeys.length > 0,
      Boolean(data.templateKey),
      Boolean(data.cloneFromRoleId)
    ].filter(Boolean).length;

    if (configuredSources > 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Provide permissionKeys, templateKey, or cloneFromRoleId, not multiple permission sources"
      });
    }
  });

export const roleUpdateSchema = baseRoleUpdateSchema.omit({ permissionKeys: true }).extend({
  permissionKeys: z.array(permissionKeySchema).optional()
});

export const roleCloneSchema = z.object({
  name: z.string().min(2).optional(),
  description: optionalText
});

export {
  branchCreateSchema,
  branchUpdateSchema,
  departmentCreateSchema,
  departmentUpdateSchema,
  employeeCreateSchema,
  employeeUpdateSchema,
  organizationUpdateSchema,
  systemConfigCreateSchema,
  systemConfigUpdateSchema,
  teamCreateSchema,
  teamUpdateSchema,
  userManagementAnalyticsQuerySchema,
  userManagementCreateGroupSchema,
  userManagementGroupQuerySchema,
  userManagementInvitationQuerySchema,
  userManagementInviteSchema,
  userManagementUpdateGroupSchema,
  userManagementUpdateUserSchema,
  userManagementUsersQuerySchema,
  workScheduleUpsertSchema,
};
