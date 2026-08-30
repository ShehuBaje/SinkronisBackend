import { z } from "zod";
import { billingModuleKeys, billingPlanKeys, platformSubscriptionStatuses, tenantHealthSortFields } from "./platform-admin.interface";

const optionalDate = z.string().datetime({ offset: true }).transform((value) => new Date(value)).optional();

const normalizeKey = (value: unknown) => typeof value === "string" ? value.trim().toLowerCase().replace(/_/g, "-") : value;
const normalizeStatus = (value: unknown) => {
  if (typeof value !== "string") return value;
  const status = value.trim().toUpperCase();
  return status === "TRIALING" ? "TRIAL" : status;
};
const normalizeSortField = (value: unknown) => {
  if (value === "lastActiveAt") return "lastActiveDate";
  if (value === "mrr") return "monthlyRecurringRevenue";
  return value;
};
const normalizeAllKey = (value: unknown) => typeof value === "string" && value.trim().toUpperCase() === "ALL" ? undefined : normalizeKey(value);
const normalizeAllStatus = (value: unknown) => typeof value === "string" && value.trim().toUpperCase() === "ALL" ? undefined : normalizeStatus(value);

export const platformDashboardQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  activityLimit: z.coerce.number().int().min(1).max(100).default(10),
  search: z.string().trim().max(100).optional(),
  status: z.preprocess(normalizeStatus, z.enum(platformSubscriptionStatuses)).optional(),
  plan: z.preprocess(normalizeKey, z.enum(billingPlanKeys)).optional(),
  module: z.preprocess(normalizeKey, z.enum(billingModuleKeys)).optional(),
  registeredFrom: optionalDate,
  registeredTo: optionalDate,
  revenueMin: z.coerce.number().min(0).optional(),
  revenueMax: z.coerce.number().min(0).optional(),
  sortBy: z.preprocess(normalizeSortField, z.enum(tenantHealthSortFields)).default("organizationName"),
  sortOrder: z.enum(["asc", "desc"]).default("asc")
}).strict().superRefine((value, context) => {
  if (value.registeredFrom && value.registeredTo && value.registeredFrom > value.registeredTo) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["registeredTo"], message: "registeredTo must be on or after registeredFrom" });
  }
  if (value.revenueMin !== undefined && value.revenueMax !== undefined && value.revenueMin > value.revenueMax) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["revenueMax"], message: "revenueMax must be greater than or equal to revenueMin" });
  }
});

export const platformCurrencies = ["NGN", "USD", "GBP"] as const;
export const platformFeatureFlagKeys = ["BETA_ANALYTICS_DASHBOARD", "NEW_INVOICE_EDITOR", "BULK_USER_IMPORT", "AI_POWERED_INSIGHTS", "MULTI_CURRENCY_SUPPORT"] as const;
export const platformEmailTemplateKeys = ["ONBOARDING_WELCOME", "INVOICE_GENERATED", "PLAN_EXPIRY_REMINDER"] as const;

const isIanaTimezone = (value: string) => {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format();
    return value.includes("/");
  } catch {
    return false;
  }
};

export const updatePlatformConfigurationSchema = z.object({
  defaultCurrency: z.enum(platformCurrencies).optional(),
  vatRate: z.coerce.number().finite().min(0).max(100).optional(),
  defaultTimezone: z.string().trim().min(1).max(100).refine(isIanaTimezone, "Invalid IANA timezone").optional(),
  supportEmail: z.string().trim().email().max(254).transform((value) => value.toLowerCase()).optional()
}).strict().refine((value) => Object.keys(value).length > 0, "At least one configuration field is required");

export const updatePlatformPasswordPolicySchema = z.object({
  minimumLength: z.coerce.number().int().min(8).max(128).optional(),
  passwordExpiryDays: z.union([z.coerce.number().int().min(1).max(3650), z.null()]).optional(),
  accountLockoutAttempts: z.coerce.number().int().min(3).max(20).optional(),
  requireUppercase: z.boolean().optional(),
  requireLowercase: z.boolean().optional(),
  requireNumber: z.boolean().optional(),
  requireSpecialCharacter: z.boolean().optional()
}).strict().refine((value) => Object.keys(value).length > 0, "At least one password policy field is required");

export const platformFeatureFlagParamsSchema = z.object({ key: z.enum(platformFeatureFlagKeys) }).strict();
export const updatePlatformFeatureFlagSchema = z.object({ enabled: z.boolean() }).strict();
export const platformEmailTemplateParamsSchema = z.object({ key: z.enum(platformEmailTemplateKeys) }).strict();

const containsDangerousHtml = (value: string) =>
  /<\s*script\b|javascript\s*:|\bon[a-z]+\s*=/i.test(value);

export const updatePlatformEmailTemplateSchema = z.object({
  subject: z.string().trim().min(1).max(200),
  body: z.string().trim().min(1).max(50_000)
}).strict().superRefine((value, context) => {
  if (containsDangerousHtml(value.subject) || containsDangerousHtml(value.body)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "Template contains unsafe HTML content" });
  }
});

export const updateMaintenanceModeSchema = z.object({
  enabled: z.boolean().optional(),
  message: z.string().trim().min(10).max(1000).optional()
}).strict().refine((value) => Object.keys(value).length > 0, "At least one maintenance field is required");

export type PlatformDashboardQuery = z.infer<typeof platformDashboardQuerySchema>;

export const platformTenantParamsSchema = z.object({ tenantId: z.string().min(1) }).strict();

export const platformTenantListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  search: z.string().trim().max(100).optional(),
  plan: z.preprocess(normalizeAllKey, z.enum(billingPlanKeys).optional()),
  status: z.preprocess(normalizeAllStatus, z.enum(platformSubscriptionStatuses).optional()),
  module: z.preprocess(normalizeAllKey, z.enum(billingModuleKeys).optional()),
  sortBy: z.preprocess((value) => {
    if (value === "createdDate") return "createdAt";
    if (value === "lastActive") return "lastActiveAt";
    if (value === "monthlyRecurringRevenue") return "mrr";
    if (value === "numberOfUsers" || value === "userCount") return "totalUsers";
    return value;
  }, z.enum(["organizationName", "createdAt", "lastActiveAt", "mrr", "totalUsers"])).default("organizationName"),
  sortOrder: z.enum(["asc", "desc"]).default("asc")
}).strict();

export type PlatformTenantListQuery = z.infer<typeof platformTenantListQuerySchema>;

export const suspendPlatformTenantSchema = z.object({
  reason: z.string().trim().min(3).max(1000).optional()
}).strict();

const supportedCountry = z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/).refine((code) => {
  try {
    const displayName = new Intl.DisplayNames(["en"], { type: "region" }).of(code);
    return Boolean(displayName && displayName !== code && !/^unknown region$/i.test(displayName));
  } catch {
    return false;
  }
}, "Unsupported ISO country code");

export const createPlatformTenantSchema = z.object({
  companyName: z.string().trim().min(2).max(150),
  adminEmail: z.string().trim().toLowerCase().email(),
  subscriptionPlan: z.preprocess(normalizeKey, z.enum(billingPlanKeys)),
  country: supportedCountry,
  industry: z.string().trim().max(100).optional()
}).strict();

export const platformTenantUserParamsSchema = platformTenantParamsSchema.extend({ userId: z.string().min(1) });
export const platformTenantModuleParamsSchema = platformTenantParamsSchema.extend({ moduleId: z.preprocess(normalizeKey, z.enum(billingModuleKeys)) });

export const platformTenantUsersQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  search: z.string().trim().max(100).optional(),
  status: z.enum(["ALL", "ACTIVE", "INACTIVE", "SUSPENDED", "INVITED"]).default("ALL")
}).strict();

export const platformModuleToggleSchema = z.object({ enabled: z.boolean() }).strict();

export const platformTenantBillingQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  status: z.enum(["ALL", "PAID", "PENDING", "FAILED", "CANCELLED", "REFUNDED"]).default("ALL")
}).strict();

export const overridePlatformTenantPlanSchema = z.object({
  plan: z.preprocess(normalizeKey, z.enum(billingPlanKeys)),
  effectiveDate: z.string().datetime({ offset: true }).transform((value) => new Date(value)).optional(),
  reason: z.string().trim().min(3).max(1000).optional()
}).strict();

export const platformTenantActivityQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25)
}).strict();

export const platformTenantSupportQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  search: z.string().trim().max(100).optional(),
  status: z.enum(["ALL", "OPEN", "IN_PROGRESS", "PENDING", "RESOLVED", "CLOSED"]).default("ALL"),
  priority: z.enum(["ALL", "HIGH", "MEDIUM", "LOW"]).default("ALL"),
  sortOrder: z.enum(["asc", "desc"]).default("desc")
}).strict();

const moneyAmount = z.coerce.number().min(0).max(1_000_000_000).refine(
  (value) => Number.isSafeInteger(Math.round(value * 100)) && Math.abs(value * 100 - Math.round(value * 100)) < 1e-8,
  "Amount supports at most two decimal places"
);

export const platformPricingQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().trim().max(100).optional(),
  status: z.enum(["ALL", "ACTIVE", "INACTIVE", "ARCHIVED"]).default("ALL"),
  pricingModel: z.enum(["ALL", "FIXED", "FIXED_BUNDLE"]).default("ALL"),
  sortBy: z.enum(["name", "activeTenantCount", "monthlyRevenue", "basePrice", "totalEmployees"]).default("name"),
  sortOrder: z.enum(["asc", "desc"]).default("asc")
}).strict();

export const platformPricingModuleParamsSchema = z.object({ moduleId: z.string().trim().min(1).max(191) }).strict();
export const platformPricingPlanParamsSchema = z.object({ planCode: z.enum(["hris", "payroll", "accounting", "all-in-one", "HRIS", "PAYROLL", "ACCOUNTING", "ALL_IN_ONE"]).transform((value) => value.toLowerCase().replaceAll("_", "-")) }).strict();

export const updatePlatformPriceSchema = z.object({
  baseMonthlyPrice: moneyAmount.optional(),
  monthlyPrice: moneyAmount.optional(),
  reason: z.string().trim().min(3).max(1000).default("Platform Admin price update"),
  effectiveAt: z.string().datetime({ offset: true }).transform((value) => new Date(value)).optional(),
  expectedVersion: z.coerce.number().int().min(1).optional()
}).strict().superRefine((value, context) => {
  if (value.baseMonthlyPrice === undefined && value.monthlyPrice === undefined) context.addIssue({ code: z.ZodIssueCode.custom, path: ["baseMonthlyPrice"], message: "baseMonthlyPrice is required" });
  if (value.baseMonthlyPrice !== undefined && value.monthlyPrice !== undefined && value.baseMonthlyPrice !== value.monthlyPrice) context.addIssue({ code: z.ZodIssueCode.custom, path: ["baseMonthlyPrice"], message: "Provide only one price value" });
}).transform((value) => ({ ...value, monthlyPrice: value.baseMonthlyPrice ?? value.monthlyPrice!, effectiveAt: value.effectiveAt ?? new Date() }));

namespace PlatformUsersValidation {
export const platformUserStatuses = ["ALL", "ACTIVE", "INACTIVE"] as const;
export const platformUserSortFields = ["name", "email", "tenantName", "role", "lastActive", "status", "createdAt"] as const;
const allToUndefined = (value: unknown) => typeof value === "string" && value.trim().toUpperCase() === "ALL" ? undefined : value;

export const platformUsersQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().trim().min(2).max(100).optional(),
  tenantId: z.preprocess(allToUndefined, z.string().trim().min(1).max(191).optional()),
  roleId: z.preprocess(allToUndefined, z.string().trim().min(1).max(191).optional()),
  status: z.preprocess((value) => typeof value === "string" ? value.trim().toUpperCase() : value, z.enum(platformUserStatuses)).default("ALL"),
  sortBy: z.enum(platformUserSortFields).default("lastActive"),
  sortOrder: z.enum(["asc", "desc"]).default("desc")
}).strict();

export const platformUserParamsSchema = z.object({ userId: z.string().trim().min(1).max(191) }).strict();
export const impersonatePlatformUserSchema = z.object({ reason: z.string().trim().min(3).max(500) }).strict();
export type PlatformUsersQuery = z.infer<typeof platformUsersQuerySchema>;


}

namespace PlatformSupportValidation {
export const supportTicketPriorities = ["MEDIUM", "HIGH", "CRITICAL"] as const;
export const supportTicketStatuses = ["OPEN", "IN_PROGRESS", "RESOLVED"] as const;

const normalizeEnum = (value: unknown) => typeof value === "string" ? value.trim().toUpperCase() : value;

export const supportTicketListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().trim().min(2).max(100).optional(),
  status: z.preprocess(normalizeEnum, z.enum(supportTicketStatuses).optional())
}).strict();

export const supportTicketParamsSchema = z.object({
  ticketId: z.string().trim().min(1).max(191)
}).strict();

export const createSupportTicketSchema = z.object({
  tenantId: z.string().trim().min(1).max(191),
  subject: z.string().trim().min(3).max(200),
  priority: z.preprocess(normalizeEnum, z.enum(supportTicketPriorities)),
  description: z.string().trim().min(10).max(10_000)
}).strict();

export const assignSupportTicketSchema = z.object({
  assignedToId: z.string().trim().min(1).max(191)
}).strict();

export const updateResolutionNotesSchema = z.object({
  resolutionNotes: z.string().trim().min(1).max(10_000)
}).strict();

export const updateSupportTicketStatusSchema = z.object({
  status: z.preprocess(normalizeEnum, z.enum(supportTicketStatuses))
}).strict();

export type SupportTicketListQuery = z.infer<typeof supportTicketListQuerySchema>;
export type CreateSupportTicketInput = z.infer<typeof createSupportTicketSchema>;
export type SupportTicketStatus = (typeof supportTicketStatuses)[number];


}

namespace PlatformBillingValidation2 {
export const platformInvoiceStatuses = ["PAID", "OVERDUE", "DRAFT"] as const;
export const platformInvoiceSortFields = ["dueDate", "amount", "createdAt", "tenantName"] as const;
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).transform((value) => new Date(`${value}T00:00:00.000Z`));
const period = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Billing period must use YYYY-MM");

const billingDateFilterFields = {
  year: z.coerce.number().int().min(2000).max(2200).optional(),
  month: z.coerce.number().int().min(1).max(12).optional(),
  startDate: isoDate.optional(), endDate: isoDate.optional()
};
const validateDateRange = (value: { startDate?: Date; endDate?: Date }, ctx: z.RefinementCtx) => {
  if (value.startDate && value.endDate && value.startDate > value.endDate) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["endDate"], message: "endDate must be on or after startDate" });
};
export const billingDateFilterSchema = z.object(billingDateFilterFields).strict().superRefine(validateDateRange);

const invoiceListObjectSchema = z.object({ ...billingDateFilterFields,
  page: z.coerce.number().int().min(1).default(1), limit: z.coerce.number().int().min(1).max(100).default(25),
  search: z.string().trim().max(100).optional(), status: z.enum(platformInvoiceStatuses).optional(), tenantId: z.string().trim().min(1).max(191).optional(),
  period: period.optional(), billingPeriod: period.optional(), sortBy: z.enum(platformInvoiceSortFields).default("createdAt"), sortOrder: z.enum(["asc", "desc"]).default("desc")
}).strict();
const validateInvoiceList = (value: { startDate?: Date; endDate?: Date; period?: string; billingPeriod?: string }, context: z.RefinementCtx) => {
  validateDateRange(value, context);
  if (value.period && value.billingPeriod && value.period !== value.billingPeriod) context.addIssue({ code: z.ZodIssueCode.custom, path: ["period"], message: "period and billingPeriod must match when both are supplied" });
};
export const invoiceListQuerySchema = invoiceListObjectSchema.superRefine(validateInvoiceList);

export const invoiceExportQuerySchema = invoiceListObjectSchema.omit({ page: true, limit: true }).superRefine(validateInvoiceList);
export const invoiceParamsSchema = z.object({ invoiceId: z.string().trim().min(1).max(191) }).strict();
export const createPlatformInvoiceSchema = z.object({
  tenantId: z.string().trim().min(1).max(191), billingPeriod: period.optional(), period: period.optional(),
  amount: z.coerce.number().positive().max(1_000_000_000).refine((v) => Number.isSafeInteger(Math.round(v * 100)) && Math.abs(v * 100 - Math.round(v * 100)) < 1e-8, "Amount supports at most two decimal places"),
  currency: z.literal("NGN").default("NGN"), dueDate: isoDate.optional()
}).strict().superRefine((value, context) => {
  if (!value.billingPeriod && !value.period) context.addIssue({ code: z.ZodIssueCode.custom, path: ["period"], message: "period is required" });
  if (value.billingPeriod && value.period && value.billingPeriod !== value.period) context.addIssue({ code: z.ZodIssueCode.custom, path: ["period"], message: "Provide only one billing period" });
}).transform((value) => ({ ...value, billingPeriod: value.billingPeriod ?? value.period! }));

export type InvoiceListQuery = z.infer<typeof invoiceListQuerySchema>;


}

namespace PlatformModulesValidation2 {
const normalizeModule = (value: unknown) => typeof value === "string" ? value.trim().toLowerCase() : value;
const normalizePlan = (value: unknown) => typeof value === "string" ? value.trim().toLowerCase().replace(/_/g, "-") : value;
const allToUndefined = (value: unknown) => typeof value === "string" && value.trim().toUpperCase() === "ALL" ? undefined : value;
export const platformModuleSortFields = ["tenantName", "tenantStatus", "usage", "hrisUsers", "payrollUsers", "accountingUsers", "lastUpdatedAt", "createdAt"] as const;
export const platformModulesQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1), limit: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().trim().min(2).max(100).optional(), tenantId: z.preprocess(allToUndefined, z.string().trim().min(1).max(191).optional()),
  tenantStatus: z.preprocess((value) => typeof value === "string" ? value.trim().toUpperCase() : value, z.enum(["ALL", "ACTIVE", "SUSPENDED"]).default("ALL")),
  module: z.preprocess((value) => normalizeModule(allToUndefined(value)), z.enum(billingModuleKeys).optional()), enabled: z.preprocess(allToUndefined, z.enum(["true", "false"]).transform((value) => value === "true").optional()),
  plan: z.preprocess((value) => normalizePlan(allToUndefined(value)), z.enum(billingPlanKeys).optional()),
  sortBy: z.enum(platformModuleSortFields).default("lastUpdatedAt"), sortOrder: z.enum(["asc", "desc"]).default("desc")
}).strict().superRefine((value, context) => { if (value.enabled !== undefined && !value.module) context.addIssue({ code: z.ZodIssueCode.custom, path: ["module"], message: "module is required when enabled is supplied" }); });
export const platformModuleTenantParamsSchema = z.object({ tenantId: z.string().trim().min(1).max(191) }).strict();
export const platformModuleActionParamsSchema = platformModuleTenantParamsSchema.extend({ module: z.preprocess(normalizeModule, z.enum(billingModuleKeys)) });
export const platformModuleReasonSchema = z.object({ reason: z.string().trim().min(3).max(1000) }).strict();
const updateItem = z.object({ module: z.preprocess(normalizeModule, z.enum(billingModuleKeys)), enabled: z.boolean() }).strict();
export const platformModuleBulkUpdateSchema = z.object({ modules: z.array(updateItem).min(1).max(3), reason: z.string().trim().min(3).max(1000), expectedVersion: z.coerce.number().int().min(1).optional() }).strict().superRefine((value, context) => { const keys = value.modules.map((item) => item.module); if (new Set(keys).size !== keys.length) context.addIssue({ code: z.ZodIssueCode.custom, path: ["modules"], message: "Duplicate module entries are not allowed" }); });
export type PlatformModulesQuery = z.infer<typeof platformModulesQuerySchema>;


}

namespace PlatformAnalyticsValidation2 {
const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD").transform((value) => new Date(`${value}T00:00:00.000Z`));
export const platformAnalyticsQuerySchema = z.object({ from: dateOnly.optional(), to: dateOnly.optional() }).strict().transform((value) => {
  const today = new Date(); const currentDay = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
  const to = value.to ?? currentDay; const from = value.from ?? new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth() - 11, 1));
  return { from, to };
}).superRefine((value, context) => {
  if (value.from > value.to) context.addIssue({ code: z.ZodIssueCode.custom, path: ["to"], message: "to must be on or after from" });
  const monthSpan = (value.to.getUTCFullYear() - value.from.getUTCFullYear()) * 12 + value.to.getUTCMonth() - value.from.getUTCMonth();
  if (monthSpan > 59) context.addIssue({ code: z.ZodIssueCode.custom, path: ["to"], message: "Date range cannot exceed 60 months" });
});
export const analyticsTenantParamsSchema = z.object({ tenantId: z.string().trim().min(1).max(191) }).strict();
export const pageViewSchema = z.object({ path: z.string().trim().startsWith("/").max(500).optional() }).strict();


}

export const platformInvoiceStatuses = PlatformBillingValidation2.platformInvoiceStatuses;
export const platformInvoiceSortFields = PlatformBillingValidation2.platformInvoiceSortFields;
export const billingDateFilterSchema = PlatformBillingValidation2.billingDateFilterSchema;
export const invoiceListQuerySchema = PlatformBillingValidation2.invoiceListQuerySchema;
export const invoiceExportQuerySchema = PlatformBillingValidation2.invoiceExportQuerySchema;
export const invoiceParamsSchema = PlatformBillingValidation2.invoiceParamsSchema;
export const createPlatformInvoiceSchema = PlatformBillingValidation2.createPlatformInvoiceSchema;
export const platformUserStatuses = PlatformUsersValidation.platformUserStatuses;
export const platformUserSortFields = PlatformUsersValidation.platformUserSortFields;
export const platformUsersQuerySchema = PlatformUsersValidation.platformUsersQuerySchema;
export const platformUserParamsSchema = PlatformUsersValidation.platformUserParamsSchema;
export const impersonatePlatformUserSchema = PlatformUsersValidation.impersonatePlatformUserSchema;
export const platformModuleSortFields = PlatformModulesValidation2.platformModuleSortFields;
export const platformModulesQuerySchema = PlatformModulesValidation2.platformModulesQuerySchema;
export const platformModuleTenantParamsSchema = PlatformModulesValidation2.platformModuleTenantParamsSchema;
export const platformModuleActionParamsSchema = PlatformModulesValidation2.platformModuleActionParamsSchema;
export const platformModuleReasonSchema = PlatformModulesValidation2.platformModuleReasonSchema;
export const platformModuleBulkUpdateSchema = PlatformModulesValidation2.platformModuleBulkUpdateSchema;
export const platformAnalyticsQuerySchema = PlatformAnalyticsValidation2.platformAnalyticsQuerySchema;
export const analyticsTenantParamsSchema = PlatformAnalyticsValidation2.analyticsTenantParamsSchema;
export const pageViewSchema = PlatformAnalyticsValidation2.pageViewSchema;
export const supportTicketPriorities = PlatformSupportValidation.supportTicketPriorities;
export const supportTicketStatuses = PlatformSupportValidation.supportTicketStatuses;
export const supportTicketListQuerySchema = PlatformSupportValidation.supportTicketListQuerySchema;
export const supportTicketParamsSchema = PlatformSupportValidation.supportTicketParamsSchema;
export const createSupportTicketSchema = PlatformSupportValidation.createSupportTicketSchema;
export const assignSupportTicketSchema = PlatformSupportValidation.assignSupportTicketSchema;
export const updateResolutionNotesSchema = PlatformSupportValidation.updateResolutionNotesSchema;
export const updateSupportTicketStatusSchema = PlatformSupportValidation.updateSupportTicketStatusSchema;
