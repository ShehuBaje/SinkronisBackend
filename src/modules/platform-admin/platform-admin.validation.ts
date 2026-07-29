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
  industry: z.string().trim().max(100).optional(),
  seatAllocation: z.coerce.number().int().min(1).max(1_000_000).optional()
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
  seatAllocation: z.coerce.number().int().min(1).max(1_000_000).optional(),
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
  pricingModel: z.enum(["ALL", "FLAT_MONTHLY"]).default("ALL"),
  sortBy: z.enum(["name", "activeTenantCount", "monthlyRevenue", "basePrice", "totalEmployees"]).default("name"),
  sortOrder: z.enum(["asc", "desc"]).default("asc")
}).strict();

export const platformPricingModuleParamsSchema = z.object({ moduleId: z.string().trim().min(1).max(191) }).strict();

export const updatePlatformPriceSchema = z.object({
  monthlyPrice: moneyAmount,
  reason: z.string().trim().min(3).max(1000),
  effectiveAt: z.string().datetime({ offset: true }).transform((value) => new Date(value)),
  expectedVersion: z.coerce.number().int().min(1).optional()
}).strict();

const existingFeature = z.object({ featureId: z.string().trim().min(1).max(191) }).strict();
const newFeature = z.object({
  name: z.string().trim().min(2).max(120),
  description: z.string().trim().max(1000).optional(),
  module: z.enum(["hris", "payroll", "accounting"]).optional()
}).strict();

export const createPlatformPricingPlanSchema = z.object({
  name: z.string().trim().min(2).max(120),
  monthlyPrice: moneyAmount,
  description: z.string().trim().min(3).max(2000),
  features: z.array(z.union([existingFeature, newFeature])).min(1).max(100)
}).strict().superRefine((value, context) => {
  const featureIds = value.features.flatMap((feature) => "featureId" in feature ? [feature.featureId] : []);
  if (new Set(featureIds).size !== featureIds.length) context.addIssue({ code: z.ZodIssueCode.custom, path: ["features"], message: "Duplicate feature assignments are not allowed" });
  const names = value.features.flatMap((feature) => "name" in feature ? [feature.name.toLowerCase().replace(/\s+/g, " ")] : []);
  if (new Set(names).size !== names.length) context.addIssue({ code: z.ZodIssueCode.custom, path: ["features"], message: "Duplicate feature names are not allowed" });
});
