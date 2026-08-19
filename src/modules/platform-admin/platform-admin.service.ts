import { Prisma } from "@prisma/client";
import type { AuthUser } from "../../types";
import bcrypt from "bcryptjs";
import crypto from "node:crypto";
import jwt from "jsonwebtoken";
import { env } from "../../config/env";
import { badRequest, conflict, forbidden, notFound, serviceUnavailable } from "../../core/http-error";
import { prisma } from "../../core/prisma";
import { createAuditLog } from "../admin/admin.audit";
import { forgotPassword } from "../auth/auth.service";
import { sendTenantCheckInEmail } from "../auth/auth.mailer";
import { snapshotTenantModuleUsage } from "../telemetry/telemetry.service";
import { sendPlatformInvoiceReminderEmail } from "./platform-billing.mailer";
import {
  billingModuleKeys,
  billingPlanKeys,
  billingPlans,
  getBillingPlanDefinition,
  moduleLabels,
  type BillingModuleKey,
  type BillingPlanKey
} from "../billing/billing.catalog";
import { getEffectivePlanCatalogue, resolveRecurringPrices, revenueContributionPercentage, sumMoney } from "../billing/pricing.service";
import {
  type PlatformActivityType,
  type PlatformSubscriptionSnapshot,
  type PlatformSubscriptionStatus,
  type PlatformEmailTemplateKey,
  type PlatformFeatureFlagKey
  ,type InvoiceListQuery,
  type PlatformUsersQuery,
  type PlatformModulesQuery,
  type SupportTicketStatus
} from "./platform-admin.interface";
import {
  platformDashboardQuerySchema,
  platformTenantListQuerySchema,
  createPlatformTenantSchema,
  overridePlatformTenantPlanSchema,
  platformModuleToggleSchema,
  platformTenantActivityQuerySchema,
  platformTenantBillingQuerySchema,
  platformTenantSupportQuerySchema,
  platformTenantUsersQuerySchema,
  platformPricingQuerySchema,
  updatePlatformPriceSchema,
  createPlatformPricingPlanSchema,
  suspendPlatformTenantSchema,
  platformEmailTemplateKeys,
  platformFeatureFlagKeys,
  updateMaintenanceModeSchema,
  updatePlatformConfigurationSchema,
  updatePlatformEmailTemplateSchema,
  updatePlatformFeatureFlagSchema,
  updatePlatformPasswordPolicySchema,
  billingDateFilterSchema,
  createPlatformInvoiceSchema,
  invoiceExportQuerySchema,
  invoiceListQuerySchema,
  platformUsersQuerySchema,
  platformModuleBulkUpdateSchema,
  platformModulesQuerySchema,
  platformAnalyticsQuerySchema,
  createSupportTicketSchema,
  supportTicketListQuerySchema,
  updateResolutionNotesSchema,
  updateSupportTicketStatusSchema,
  assignSupportTicketSchema,
  type PlatformDashboardQuery
} from "./platform-admin.validation";

const subscriptionKey = "billing.subscription";
const addOnPrefix = "billing.addons";
const excludedTenantWhere: Prisma.OrganizationWhereInput = {
  status: { not: "ARCHIVED" },
  deletionRequests: { none: { status: "PENDING_PLATFORM_APPROVAL" } },
  users: { none: { isPlatformAdmin: true } }
};

export const defaultPlatformConfiguration = {
  defaultCurrency: "NGN" as const,
  vatRate: 7.5,
  defaultTimezone: "Africa/Lagos",
  supportEmail: "support@sinkronis.ng"
};

export const defaultPlatformPasswordPolicy = {
  minimumLength: 8,
  passwordExpiryDays: 90 as number | null,
  accountLockoutAttempts: 5,
  requireUppercase: true,
  requireLowercase: true,
  requireNumber: true,
  requireSpecialCharacter: false
};

const defaultMaintenance = {
  enabled: false,
  message: "Sinkronis is currently undergoing scheduled maintenance. Please try again shortly.",
  enabledAt: null as string | null,
  enabledById: null as string | null
};

const featureDefinitions: Record<PlatformFeatureFlagKey, { name: string; description: string }> = {
  BETA_ANALYTICS_DASHBOARD: { name: "Beta Analytics Dashboard", description: "Enable the new analytics UI for all tenants." },
  NEW_INVOICE_EDITOR: { name: "New Invoice Editor", description: "Upgrade to the rich-text invoice editor." },
  BULK_USER_IMPORT: { name: "Bulk User Import", description: "Allow CSV import of users from the admin portal." },
  AI_POWERED_INSIGHTS: { name: "AI-Powered Insights", description: "Surface AI-generated performance and billing nudges." },
  MULTI_CURRENCY_SUPPORT: { name: "Multi-Currency Support", description: "Allow tenants to invoice in USD and GBP." }
};

const emailTemplateDefinitions: Record<PlatformEmailTemplateKey, {
  name: string; subject: string; body: string; availableVariables: string[];
}> = {
  ONBOARDING_WELCOME: {
    name: "Onboarding Welcome",
    subject: "Welcome to Sinkronis â€” Let's get started!",
    body: "Hello {{tenantName}}, welcome to Sinkronis. {{adminName}}, your workspace is ready.",
    availableVariables: ["tenantName", "adminName"]
  },
  INVOICE_GENERATED: {
    name: "Invoice Generated",
    subject: "Invoice {{invoiceNumber}} is ready",
    body: "Hello {{tenantName}}, invoice {{invoiceNumber}} has been generated.",
    availableVariables: ["tenantName", "invoiceNumber"]
  },
  PLAN_EXPIRY_REMINDER: {
    name: "Plan Expiry Reminder",
    subject: "Your {{planName}} plan expires on {{expiryDate}}",
    body: "Hello {{tenantName}}, your {{planName}} plan expires on {{expiryDate}}.",
    availableVariables: ["tenantName", "planName", "expiryDate"]
  }
};

const asObject = (value: Prisma.JsonValue | null | undefined): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};

const assertPlatformAdmin = (actor: AuthUser) => {
  if (!actor.isPlatformAdmin || actor.impersonation) throw forbidden("Platform Admin access is required");
};

const getSetting = (key: string) => prisma.platformSetting.findUnique({
  where: { key },
  include: { updatedBy: { select: { id: true, firstName: true, lastName: true } } }
});

const updatedByView = (user: { id: string; firstName: string; lastName: string } | null) =>
  user ? { id: user.id, name: `${user.firstName} ${user.lastName}`.trim() } : null;

const upsertSetting = (key: string, category: string, value: Prisma.InputJsonValue, actorId: string) =>
  prisma.platformSetting.upsert({
    where: { key },
    create: { key, category, value, updatedByUserId: actorId },
    update: { category, value, updatedByUserId: actorId },
    include: { updatedBy: { select: { id: true, firstName: true, lastName: true } } }
  });

const auditSetting = (actor: AuthUser, action: string, key: string, previous: unknown, current: unknown) =>
  createAuditLog({
    organizationId: actor.organizationId,
    actorUserId: actor.id,
    action,
    resource: "PLATFORM_SETTING",
    resourceId: key,
    summary: action.replace(/_/g, " ").toLowerCase(),
    metadata: { key, previous, current } as Prisma.InputJsonValue
  });

export const getPlatformConfigurationValue = async () => {
  const record = await getSetting("PLATFORM_CONFIGURATION");
  return {
    ...defaultPlatformConfiguration,
    ...asObject(record?.value),
    updatedAt: record?.updatedAt ?? null,
    updatedBy: updatedByView(record?.updatedBy ?? null)
  };
};

export const getPlatformConfiguration = async (actor: AuthUser) => {
  assertPlatformAdmin(actor);
  return getPlatformConfigurationValue();
};

export const updatePlatformConfiguration = async (input: unknown, actor: AuthUser) => {
  assertPlatformAdmin(actor);
  const payload = updatePlatformConfigurationSchema.parse(input);
  const previous = await getPlatformConfigurationValue();
  const value = { defaultCurrency: previous.defaultCurrency, vatRate: previous.vatRate, defaultTimezone: previous.defaultTimezone, supportEmail: previous.supportEmail, ...payload };
  const record = await upsertSetting("PLATFORM_CONFIGURATION", "CONFIGURATION", value, actor.id);
  await auditSetting(actor, "PLATFORM_CONFIGURATION_UPDATED", record.key, {
    defaultCurrency: previous.defaultCurrency, vatRate: previous.vatRate,
    defaultTimezone: previous.defaultTimezone, supportEmail: previous.supportEmail
  }, value);
  return { ...value, updatedAt: record.updatedAt, updatedBy: updatedByView(record.updatedBy) };
};

export const getGlobalPasswordPolicy = async () => {
  const record = await getSetting("PLATFORM_PASSWORD_POLICY");
  return { ...defaultPlatformPasswordPolicy, ...asObject(record?.value) };
};

export const getPlatformPasswordPolicy = async (actor: AuthUser) => {
  assertPlatformAdmin(actor);
  const [policy, record] = await Promise.all([getGlobalPasswordPolicy(), getSetting("PLATFORM_PASSWORD_POLICY")]);
  return { ...policy, updatedAt: record?.updatedAt ?? null, updatedBy: updatedByView(record?.updatedBy ?? null) };
};

export const updatePlatformPasswordPolicy = async (input: unknown, actor: AuthUser) => {
  assertPlatformAdmin(actor);
  const payload = updatePlatformPasswordPolicySchema.parse(input);
  const previous = await getGlobalPasswordPolicy();
  const value = { ...previous, ...payload };
  const record = await upsertSetting("PLATFORM_PASSWORD_POLICY", "SECURITY", value, actor.id);
  await auditSetting(actor, "PLATFORM_PASSWORD_POLICY_UPDATED", record.key, previous, value);
  return { ...value, updatedAt: record.updatedAt, updatedBy: updatedByView(record.updatedBy) };
};

const flagSettingKey = (key: PlatformFeatureFlagKey) => `FEATURE_FLAG.${key}`;

export const isPlatformFeatureEnabled = async (key: PlatformFeatureFlagKey) => {
  const record = await getSetting(flagSettingKey(key));
  return asObject(record?.value).enabled === true;
};

const getFeatureFlagsValue = async () => {
  const records = await prisma.platformSetting.findMany({
    where: { key: { in: platformFeatureFlagKeys.map(flagSettingKey) } },
    include: { updatedBy: { select: { id: true, firstName: true, lastName: true } } }
  });
  const map = new Map(records.map((record) => [record.key, record]));
  return platformFeatureFlagKeys.map((key) => {
    const record = map.get(flagSettingKey(key));
    return {
      key, ...featureDefinitions[key], enabled: asObject(record?.value).enabled === true,
      updatedAt: record?.updatedAt ?? null, updatedBy: updatedByView(record?.updatedBy ?? null)
    };
  });
};

export const getPlatformFeatureFlags = async (actor: AuthUser) => {
  assertPlatformAdmin(actor);
  return getFeatureFlagsValue();
};

export const updatePlatformFeatureFlag = async (key: PlatformFeatureFlagKey, input: unknown, actor: AuthUser) => {
  assertPlatformAdmin(actor);
  if (!platformFeatureFlagKeys.includes(key)) throw notFound("Feature flag not found");
  const payload = updatePlatformFeatureFlagSchema.parse(input);
  const previous = await isPlatformFeatureEnabled(key);
  const record = await upsertSetting(flagSettingKey(key), "FEATURE_FLAG", { enabled: payload.enabled }, actor.id);
  if (previous !== payload.enabled) {
    await auditSetting(actor, payload.enabled ? "PLATFORM_FEATURE_FLAG_ENABLED" : "PLATFORM_FEATURE_FLAG_DISABLED", record.key, { enabled: previous }, { enabled: payload.enabled });
  }
  return { key, ...featureDefinitions[key], enabled: payload.enabled, updatedAt: record.updatedAt, updatedBy: updatedByView(record.updatedBy) };
};

const templateSettingKey = (key: PlatformEmailTemplateKey) => `EMAIL_TEMPLATE.${key}`;

export const extractTemplateVariables = (content: string) => {
  const variables: string[] = [];
  const validPlaceholder = /{{\s*([A-Za-z][A-Za-z0-9]*)\s*}}/g;
  const remainder = content.replace(validPlaceholder, (_match, variable: string) => {
    variables.push(variable);
    return "";
  });
  if (remainder.includes("{{") || remainder.includes("}}")) throw badRequest("Template contains a malformed placeholder");
  return [...new Set(variables)];
};

const validateTemplateVariables = (key: PlatformEmailTemplateKey, subject: string, body: string) => {
  const allowed = new Set(emailTemplateDefinitions[key].availableVariables);
  const unsupported = [...extractTemplateVariables(subject), ...extractTemplateVariables(body)].filter((variable) => !allowed.has(variable));
  if (unsupported.length > 0) throw badRequest(`Unsupported template variable: ${[...new Set(unsupported)].join(", ")}`);
};

const getEmailTemplateValue = async (key: PlatformEmailTemplateKey) => {
  const definition = emailTemplateDefinitions[key];
  const record = await getSetting(templateSettingKey(key));
  const stored = asObject(record?.value);
  return {
    key, name: definition.name,
    subject: typeof stored.subject === "string" ? stored.subject : definition.subject,
    body: typeof stored.body === "string" ? stored.body : definition.body,
    availableVariables: definition.availableVariables,
    updatedAt: record?.updatedAt ?? null, updatedBy: updatedByView(record?.updatedBy ?? null)
  };
};

export const getPlatformEmailTemplates = async (actor: AuthUser) => {
  assertPlatformAdmin(actor);
  return Promise.all(platformEmailTemplateKeys.map(getEmailTemplateValue));
};

export const getPlatformEmailTemplate = async (key: PlatformEmailTemplateKey, actor: AuthUser) => {
  assertPlatformAdmin(actor);
  if (!platformEmailTemplateKeys.includes(key)) throw notFound("Email template not found");
  return getEmailTemplateValue(key);
};

export const updatePlatformEmailTemplate = async (key: PlatformEmailTemplateKey, input: unknown, actor: AuthUser) => {
  assertPlatformAdmin(actor);
  if (!platformEmailTemplateKeys.includes(key)) throw notFound("Email template not found");
  const payload = updatePlatformEmailTemplateSchema.parse(input);
  validateTemplateVariables(key, payload.subject, payload.body);
  const previous = await getEmailTemplateValue(key);
  const record = await upsertSetting(templateSettingKey(key), "EMAIL_TEMPLATE", payload, actor.id);
  await auditSetting(actor, "PLATFORM_EMAIL_TEMPLATE_UPDATED", record.key, { subject: previous.subject, body: previous.body }, payload);
  return { key, name: emailTemplateDefinitions[key].name, ...payload, availableVariables: emailTemplateDefinitions[key].availableVariables, updatedAt: record.updatedAt, updatedBy: updatedByView(record.updatedBy) };
};

const escapeTemplateValue = (value: unknown) => String(value ?? "")
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;").replace(/'/g, "&#39;");

export const renderPlatformEmailTemplate = async (key: PlatformEmailTemplateKey, variables: Record<string, unknown>) => {
  const template = await getEmailTemplateValue(key);
  const allowed = new Set(template.availableVariables);
  const render = (content: string) => content.replace(/{{\s*([A-Za-z][A-Za-z0-9]*)\s*}}/g, (_match, variable: string) => {
    if (!allowed.has(variable)) throw badRequest(`Unsupported template variable: ${variable}`);
    if (!(variable in variables)) throw badRequest(`Missing template variable: ${variable}`);
    return escapeTemplateValue(variables[variable]);
  });
  return { subject: render(template.subject), body: render(template.body) };
};

export const getMaintenanceModeValue = async () => {
  const record = await getSetting("PLATFORM_MAINTENANCE");
  const stored = asObject(record?.value);
  return {
    enabled: stored.enabled === true,
    message: typeof stored.message === "string" ? stored.message : defaultMaintenance.message,
    enabledAt: typeof stored.enabledAt === "string" ? stored.enabledAt : null,
    enabledById: typeof stored.enabledById === "string" ? stored.enabledById : null,
    updatedAt: record?.updatedAt ?? null,
    updatedBy: updatedByView(record?.updatedBy ?? null)
  };
};

export const getPlatformMaintenanceMode = async (actor: AuthUser) => {
  assertPlatformAdmin(actor);
  return getMaintenanceModeValue();
};

export const updatePlatformMaintenanceMode = async (input: unknown, actor: AuthUser) => {
  assertPlatformAdmin(actor);
  const payload = updateMaintenanceModeSchema.parse(input);
  const previous = await getMaintenanceModeValue();
  const enabled = payload.enabled ?? previous.enabled;
  const value = {
    enabled,
    message: payload.message ?? previous.message,
    enabledAt: enabled ? (previous.enabledAt ?? new Date().toISOString()) : null,
    enabledById: enabled ? (previous.enabledById ?? actor.id) : null
  };
  const record = await upsertSetting("PLATFORM_MAINTENANCE", "MAINTENANCE", value, actor.id);
  await auditSetting(actor, enabled ? "PLATFORM_MAINTENANCE_ENABLED" : "PLATFORM_MAINTENANCE_DISABLED", record.key, {
    enabled: previous.enabled, message: previous.message
  }, { enabled: value.enabled, message: value.message });
  return { ...value, updatedAt: record.updatedAt, updatedBy: updatedByView(record.updatedBy) };
};

export const getPlatformSettings = async (actor: AuthUser) => {
  assertPlatformAdmin(actor);
  const [configuration, passwordPolicy, featureFlags, emailTemplates, maintenance] = await Promise.all([
    getPlatformConfigurationValue(),
    getPlatformPasswordPolicy(actor),
    getFeatureFlagsValue(),
    Promise.all(platformEmailTemplateKeys.map(getEmailTemplateValue)),
    getMaintenanceModeValue()
  ]);
  return { configuration, passwordPolicy, featureFlags, emailTemplates, maintenance };
};


const managedTenantWhere: Prisma.OrganizationWhereInput = {
  status: { not: "ARCHIVED" },
  users: { none: { isPlatformAdmin: true } }
};

const objectValue = (value: Prisma.JsonValue | null | undefined): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};

const normalizeStatus = (value: unknown): PlatformSubscriptionStatus => {
  const status = typeof value === "string" ? value.toUpperCase() : "TRIAL";
  if (status === "TRIALING") return "TRIAL";
  if (["ACTIVE", "TRIAL", "PENDING", "EXPIRED", "SUSPENDED", "CANCELLED"].includes(status)) {
    return status as PlatformSubscriptionStatus;
  }
  return "PENDING";
};

const dateValue = (value: unknown) => {
  if (typeof value !== "string" && !(value instanceof Date)) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const isActiveAddOn = (value: Prisma.JsonValue) => {
  if (typeof value === "string") return value.toUpperCase() === "ACTIVE";
  return String(objectValue(value).status ?? "").toUpperCase() === "ACTIVE";
};

export const buildSubscriptionSnapshots = async (organizationIds: string[]) => {
  if (!organizationIds.length) return new Map<string, PlatformSubscriptionSnapshot>();
  const configs = await prisma.systemConfig.findMany({
    where: {
      organizationId: { in: organizationIds },
      OR: [
        { key: subscriptionKey },
        { key: { startsWith: `${addOnPrefix}.` } },
        { key: { startsWith: "module." } }
      ]
    },
    select: { organizationId: true, key: true, value: true }
  });
  const configsByOrganization = new Map<string, typeof configs>();
  for (const config of configs) {
    configsByOrganization.set(config.organizationId, [...(configsByOrganization.get(config.organizationId) ?? []), config]);
  }
  const priceComponents = organizationIds.flatMap((organizationId) => {
    const rows = configsByOrganization.get(organizationId) ?? [];
    const subscription = objectValue(rows.find((row) => row.key === subscriptionKey)?.value);
    const rawPlanKey = typeof subscription.planKey === "string" ? subscription.planKey : "hris";
    const plan = getBillingPlanDefinition(rawPlanKey as BillingPlanKey) ?? billingPlans[0];
    const addOns = billingModuleKeys.filter((moduleKey) => {
      if (plan.includedModules.includes(moduleKey)) return false;
      const addOn = rows.find((row) => row.key === `${addOnPrefix}.${moduleKey}.subscription`);
      const moduleStatus = rows.find((row) => row.key === `module.${moduleKey}.status`);
      return Boolean(addOn && isActiveAddOn(addOn.value)) || Boolean(moduleStatus && isActiveAddOn(moduleStatus.value));
    });
    return [
      { organizationId, planKey: plan.key, source: "BASE_PLAN" as const, fallbackMonthlyPrice: plan.monthlyCost },
      ...addOns.map((moduleKey) => {
        const configured = objectValue(rows.find((row) => row.key === `${addOnPrefix}.${moduleKey}.subscription`)?.value);
        return {
          organizationId, planKey: moduleKey, source: "ADD_ON" as const,
          fallbackMonthlyPrice: typeof configured.monthlyCost === "number" ? configured.monthlyCost : getBillingPlanDefinition(moduleKey)!.monthlyCost
        };
      })
    ];
  });
  const resolvedPrices = await resolveRecurringPrices(priceComponents);

  const snapshots = new Map<string, PlatformSubscriptionSnapshot>();
  for (const organizationId of organizationIds) {
    const rows = configsByOrganization.get(organizationId) ?? [];
    const subscriptionRow = rows.find((row) => row.key === subscriptionKey);
    const subscription = objectValue(subscriptionRow?.value);
    const rawPlanKey = typeof subscription.planKey === "string" ? subscription.planKey : "hris";
    const plan = getBillingPlanDefinition(rawPlanKey as BillingPlanKey) ?? billingPlans[0];
    let status = subscriptionRow ? normalizeStatus(subscription.status) : "TRIAL";
    if (status === "PENDING" && dateValue(subscription.paymentVerifiedAt)) status = "ACTIVE";
    const renewalDate = dateValue(subscription.renewalDate);
    if (status === "ACTIVE" && renewalDate && renewalDate < new Date() && subscription.cancelAtPeriodEnd === true) status = "CANCELLED";
    else if (status === "ACTIVE" && renewalDate && renewalDate < new Date()) status = "EXPIRED";
    const addOns = billingModuleKeys.filter((moduleKey) => {
      if (plan.includedModules.includes(moduleKey)) return false;
      const addOn = rows.find((row) => row.key === `${addOnPrefix}.${moduleKey}.subscription`);
      const moduleStatus = rows.find((row) => row.key === `module.${moduleKey}.status`);
      return Boolean(addOn && isActiveAddOn(addOn.value)) || Boolean(moduleStatus && isActiveAddOn(moduleStatus.value));
    });
    const activeModules = [...new Set([...plan.includedModules, ...addOns])] as BillingModuleKey[];
    const basePrice = resolvedPrices.get(`${organizationId}:${plan.key}:BASE_PLAN`) ?? plan.monthlyCost;
    const revenueComponents = [
      { key: plan.key, source: "BASE_PLAN" as const, monthlyRevenue: basePrice },
      ...addOns.map((key) => ({ key, source: "ADD_ON" as const, monthlyRevenue: resolvedPrices.get(`${organizationId}:${key}:ADD_ON`) ?? getBillingPlanDefinition(key)!.monthlyCost }))
    ];
    const monthlyRecurringRevenue = status === "ACTIVE" ? sumMoney(revenueComponents.map((component) => component.monthlyRevenue)) : 0;
    snapshots.set(organizationId, {
      organizationId,
      planKey: plan.key,
      planName: plan.name,
      status,
      renewalDate,
      billingCycle: subscription.billingCycle === "YEARLY" ? "YEARLY" : "MONTHLY",
      activeModules,
      monthlyRecurringRevenue,
      baseMonthlyRecurringRevenue: status === "ACTIVE" ? basePrice : 0,
      revenueComponents: status === "ACTIVE" ? revenueComponents : [],
      seatAllocation: typeof subscription.totalSeats === "number" ? subscription.totalSeats : null
    });
  }
  return snapshots;
};

const loadPlatformTenantSnapshot = async (organizationWhere: Prisma.OrganizationWhereInput = excludedTenantWhere) => {
  const organizations = await prisma.organization.findMany({
    where: organizationWhere,
    select: {
      id: true, name: true, email: true, industry: true, createdAt: true, status: true,
      _count: { select: { users: { where: { isActive: true } }, employees: true, departments: true, branches: true } }
    }
  });
  const organizationIds = organizations.map((organization) => organization.id);
  const [subscriptions, userActivity, unlinkedEmployees] = await Promise.all([
    buildSubscriptionSnapshots(organizationIds),
    prisma.user.groupBy({ by: ["organizationId"], where: { organizationId: { in: organizationIds }, isActive: true }, _max: { lastLoginAt: true }, _count: { id: true } }),
    prisma.employee.groupBy({ by: ["organizationId"], where: { organizationId: { in: organizationIds }, user: null, status: { not: "TERMINATED" } }, _count: { id: true } })
  ]);
  const activityByOrganization = new Map(userActivity.map((row) => [row.organizationId, row._max.lastLoginAt]));
  const activeUsersByOrganization = new Map(userActivity.map((row) => [row.organizationId, row._count.id]));
  const unlinkedEmployeesByOrganization = new Map(unlinkedEmployees.map((row) => [row.organizationId, row._count.id]));
  return { organizations, subscriptions, activityByOrganization, activeUsersByOrganization, unlinkedEmployeesByOrganization };
};
type PlatformTenantSnapshot = Awaited<ReturnType<typeof loadPlatformTenantSnapshot>>;

export const moduleAdoptionFromSnapshot = (
  activeTenants: Array<PlatformSubscriptionSnapshot>,
  totalActiveTenants: number
) => {
  const moduleRows = billingModuleKeys.map((moduleKey) => {
    const tenantCount = activeTenants.filter((subscription) => subscription.activeModules.includes(moduleKey)).length;
    return {
      moduleId: moduleKey,
      moduleName: moduleLabels[moduleKey],
      tenantCount,
      percentageAdoption: totalActiveTenants ? Number(((tenantCount / totalActiveTenants) * 100).toFixed(2)) : 0
    };
  });
  const allInOneCount = activeTenants.filter((subscription) => subscription.planKey === "all-in-one").length;
  return [...moduleRows, {
    moduleId: "all-in-one",
    moduleName: "All-in-One Suite",
    tenantCount: allInOneCount,
    percentageAdoption: totalActiveTenants ? Number(((allInOneCount / totalActiveTenants) * 100).toFixed(2)) : 0
  }];
};

export const getPlatformDashboardAnalytics = async (existingSnapshot?: PlatformTenantSnapshot) => {
  const snapshot = existingSnapshot ?? await loadPlatformTenantSnapshot();
  const activeSubscriptions = [...snapshot.subscriptions.values()].filter((subscription) => subscription.status === "ACTIVE");
  const [activePlatformUsers, employeesWithoutUsers] = await Promise.all([
    prisma.user.count({ where: { isActive: true, OR: [{ isPlatformAdmin: true }, { organization: { is: excludedTenantWhere } }] } }),
    prisma.employee.count({ where: { organizationId: { in: snapshot.organizations.map((organization) => organization.id) }, user: null, status: { not: "TERMINATED" } } })
  ]);
  const activeModuleCount = activeSubscriptions.reduce((total, subscription) => total + subscription.activeModules.length, 0);
  return {
    currency: "NGN",
    totalTenants: snapshot.organizations.length,
    activeTenants: activeSubscriptions.length,
    totalUsers: activePlatformUsers + employeesWithoutUsers,
    platformMrr: activeSubscriptions.reduce((total, subscription) => total + subscription.monthlyRecurringRevenue, 0),
    averageModulesPerTenant: activeSubscriptions.length ? Number((activeModuleCount / activeSubscriptions.length).toFixed(2)) : 0
  };
};

export const lastSixCalendarMonths = (now = new Date()) => Array.from({ length: 6 }, (_, index) => {
  const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (5 - index), 1));
  return { date, month: date.toLocaleString("en-US", { month: "long", timeZone: "UTC" }), year: date.getUTCFullYear(), key: `${date.getUTCFullYear()}-${date.getUTCMonth()}` };
});

export const getPlatformRevenueTrend = async () => {
  const months = lastSixCalendarMonths();
  const start = months[0].date;
  const rows = await prisma.billingHistory.findMany({
    where: { billedAt: { gte: start }, status: { in: ["paid", "PAID", "completed", "COMPLETED", "success", "SUCCESS"] } },
    select: { amount: true, billedAt: true, metadata: true }
  });
  const revenue = new Map<string, number>();
  for (const row of rows) {
    const metadata = objectValue(row.metadata);
    const monthlyEquivalent = String(metadata.billingCycle ?? "").toUpperCase() === "YEARLY" ? Number(row.amount) / 12 : Number(row.amount);
    const key = `${row.billedAt.getUTCFullYear()}-${row.billedAt.getUTCMonth()}`;
    revenue.set(key, (revenue.get(key) ?? 0) + monthlyEquivalent);
  }
  return {
    currency: "NGN",
    months: months.map((month) => ({ month: month.month, year: month.year, monthlyRevenue: Number((revenue.get(month.key) ?? 0).toFixed(2)) }))
  };
};

export const getPlatformModuleAdoption = async (existingSnapshot?: PlatformTenantSnapshot) => {
  const snapshot = existingSnapshot ?? await loadPlatformTenantSnapshot();
  const active = [...snapshot.subscriptions.values()].filter((subscription) => subscription.status === "ACTIVE");
  return { denominator: "ACTIVE_TENANTS", totalActiveTenants: active.length, modules: moduleAdoptionFromSnapshot(active, active.length) };
};

const classifyActivity = (action: string, summary: string): PlatformActivityType => {
  const text = `${action} ${summary}`.toUpperCase();
  if (text.includes("DATA_EXPORT")) return "DATA_EXPORT_REQUESTED";
  if (text.includes("DELETION_REQUEST")) return "ACCOUNT_DELETION_REQUESTED";
  if (text.includes("BRANDING")) return "BRANDING_UPDATED";
  if (text.includes("INVIT")) return "USER_INVITED";
  if (text.includes("USER_REMOVED") || text.includes("STAFF_DELETED")) return "USER_REMOVED";
  if (text.includes("PAYMENT") && text.includes("FAIL")) return "PAYMENT_FAILED";
  if (text.includes("PAYMENT") || text.includes("BILLING")) return "PAYMENT_COMPLETED";
  if (text.includes("MODULE") && (text.includes("ADD") || text.includes("PURCHAS"))) return "MODULE_PURCHASED";
  if (text.includes("SUBSCRIPTION") && text.includes("CANCEL")) return "SUBSCRIPTION_CANCELLED";
  if (text.includes("SUBSCRIPTION") && text.includes("RENEW")) return "SUBSCRIPTION_RENEWED";
  if (text.includes("PLAN") || text.includes("UPGRADE")) return "SUBSCRIPTION_UPGRADED";
  if (text.includes("ORGANIZATION") && text.includes("DELET")) return "ORGANIZATION_DELETED";
  if (text.includes("ORGANIZATION") && text.includes("CREAT")) return "ORGANIZATION_CREATED";
  return "OTHER";
};

const activitySeverity = (eventType: PlatformActivityType) =>
  eventType === "PAYMENT_FAILED" || eventType === "ORGANIZATION_DELETED" ? "CRITICAL" :
    eventType === "SUBSCRIPTION_CANCELLED" || eventType === "ACCOUNT_DELETION_REQUESTED" ? "WARNING" : "INFO";

const getPlatformRecentActivity = async (activityLimit: number) => {
  const where: Prisma.AuditLogWhereInput = { organization: { is: { users: { none: { isPlatformAdmin: true } } } } };
  const candidates = await prisma.auditLog.findMany({
    where,
    include: { organization: { select: { id: true, name: true } }, actorUser: { select: { id: true, firstName: true, lastName: true, email: true } } },
    orderBy: { createdAt: "desc" },
    take: activityLimit
  });
  const mapped = candidates.map((activity) => {
    const eventType = classifyActivity(activity.action, activity.summary);
    return {
      activityId: activity.id, eventType, description: activity.summary,
      organization: { id: activity.organization.id, name: activity.organization.name },
      initiatedBy: activity.actorUser ? { id: activity.actorUser.id, name: `${activity.actorUser.firstName} ${activity.actorUser.lastName}`, email: activity.actorUser.email } : null,
      timestamp: activity.createdAt, severity: activitySeverity(eventType)
    };
  });
  return mapped;
};

const getPlatformTenantHealth = (query: PlatformDashboardQuery, snapshot: PlatformTenantSnapshot) => {
  let rows = snapshot.organizations.map((organization) => {
    const subscription = snapshot.subscriptions.get(organization.id)!;
    const status = organization.status === "SUSPENDED" ? "SUSPENDED" : subscription.status;
    return {
      organizationId: organization.id,
      organizationName: organization.name,
      currentPlan: { key: subscription.planKey, name: subscription.planName },
      userCount: organization._count.users + (snapshot.unlinkedEmployeesByOrganization.get(organization.id) ?? 0),
      activeModules: subscription.activeModules.map((key) => ({ key, name: moduleLabels[key] })),
      lastActiveDate: snapshot.activityByOrganization.get(organization.id) ?? null,
      monthlyRecurringRevenue: status === "ACTIVE" ? subscription.monthlyRecurringRevenue : 0,
      currency: "NGN",
      subscriptionStatus: status,
      registrationDate: organization.createdAt
    };
  });
  if (query.search) rows = rows.filter((row) => row.organizationName.toLowerCase().includes(query.search!.toLowerCase()));
  if (query.plan) rows = rows.filter((row) => row.currentPlan.key === query.plan);
  if (query.status) rows = rows.filter((row) => row.subscriptionStatus === query.status);
  if (query.module) rows = rows.filter((row) => row.activeModules.some((module) => module.key === query.module));
  if (query.registeredFrom) rows = rows.filter((row) => row.registrationDate >= query.registeredFrom!);
  if (query.registeredTo) rows = rows.filter((row) => row.registrationDate <= query.registeredTo!);
  if (query.revenueMin !== undefined) rows = rows.filter((row) => row.monthlyRecurringRevenue >= query.revenueMin!);
  if (query.revenueMax !== undefined) rows = rows.filter((row) => row.monthlyRecurringRevenue <= query.revenueMax!);
  const direction = query.sortOrder === "asc" ? 1 : -1;
  rows.sort((left, right) => {
    const leftValue = query.sortBy === "organizationName" ? left.organizationName.toLowerCase() : query.sortBy === "userCount" ? left.userCount :
      query.sortBy === "monthlyRecurringRevenue" ? left.monthlyRecurringRevenue : query.sortBy === "registrationDate" ? left.registrationDate.getTime() :
        query.sortBy === "lastActiveDate" ? left.lastActiveDate?.getTime() ?? 0 : left.subscriptionStatus;
    const rightValue = query.sortBy === "organizationName" ? right.organizationName.toLowerCase() : query.sortBy === "userCount" ? right.userCount :
      query.sortBy === "monthlyRecurringRevenue" ? right.monthlyRecurringRevenue : query.sortBy === "registrationDate" ? right.registrationDate.getTime() :
        query.sortBy === "lastActiveDate" ? right.lastActiveDate?.getTime() ?? 0 : right.subscriptionStatus;
    return (leftValue < rightValue ? -1 : leftValue > rightValue ? 1 : 0) * direction;
  });
  const total = rows.length;
  const start = (query.page - 1) * query.limit;
  return {
    data: rows.slice(start, start + query.limit),
    pagination: { page: query.page, limit: query.limit, total, totalPages: Math.ceil(total / query.limit) },
    metadata: { currency: "NGN", filters: { search: query.search ?? null, plan: query.plan ?? null, status: query.status ?? null, module: query.module ?? null, registeredFrom: query.registeredFrom ?? null, registeredTo: query.registeredTo ?? null, revenueMin: query.revenueMin ?? null, revenueMax: query.revenueMax ?? null }, sorting: { sortBy: query.sortBy, sortOrder: query.sortOrder } }
  };
};

const moduleBadges = (subscription: PlatformSubscriptionSnapshot) =>
  subscription.activeModules.map((key) => ({ id: key, key: key.toUpperCase(), name: moduleLabels[key] }));

const buildTenantRows = (snapshot: PlatformTenantSnapshot) => snapshot.organizations.map((organization) => {
  const subscription = snapshot.subscriptions.get(organization.id)!;
  const status = organization.status === "SUSPENDED" ? "SUSPENDED" : subscription.status;
  const totalUsers = organization._count.users + (snapshot.unlinkedEmployeesByOrganization.get(organization.id) ?? 0);
  return {
    organizationId: organization.id,
    organizationName: organization.name,
    companyEmail: organization.email,
    industry: organization.industry,
    currentPlan: { key: subscription.planKey, name: subscription.planName },
    activeModules: moduleBadges(subscription),
    totalUsers,
    monthlyRecurringRevenue: status === "ACTIVE" ? subscription.baseMonthlyRecurringRevenue : 0,
    currency: "NGN",
    subscriptionStatus: status,
    lastActiveAt: snapshot.activityByOrganization.get(organization.id) ?? null,
    createdAt: organization.createdAt,
    actions: [
      { key: "VIEW", method: "GET", href: `/platform-admin/tenants/${organization.id}`, enabled: true },
      { key: "SUSPEND", method: "PATCH", href: `/platform-admin/tenants/${organization.id}/suspend`, enabled: status !== "SUSPENDED" }
    ]
  };
});

export const getPlatformTenants = async (queryInput: unknown, platformAdmin: AuthUser) => {
  assertPlatformAdmin(platformAdmin);
  const query = platformTenantListQuerySchema.parse(queryInput);
  const snapshot = await loadPlatformTenantSnapshot(excludedTenantWhere);
  let rows = buildTenantRows(snapshot);
  if (query.search) {
    const search = query.search.toLowerCase();
    rows = rows.filter((row) => [row.organizationName, row.companyEmail ?? "", row.industry ?? ""].some((value) => value.toLowerCase().includes(search)));
  }
  if (query.plan) rows = rows.filter((row) => row.currentPlan.key === query.plan);
  if (query.status) rows = rows.filter((row) => row.subscriptionStatus === query.status);
  if (query.module) rows = rows.filter((row) => row.activeModules.some((module) => module.id === query.module));
  const direction = query.sortOrder === "asc" ? 1 : -1;
  rows.sort((left, right) => {
    const leftValue = query.sortBy === "organizationName" ? left.organizationName.toLowerCase() :
      query.sortBy === "createdAt" ? left.createdAt.getTime() :
        query.sortBy === "lastActiveAt" ? left.lastActiveAt?.getTime() ?? 0 :
          query.sortBy === "mrr" ? left.monthlyRecurringRevenue : left.totalUsers;
    const rightValue = query.sortBy === "organizationName" ? right.organizationName.toLowerCase() :
      query.sortBy === "createdAt" ? right.createdAt.getTime() :
        query.sortBy === "lastActiveAt" ? right.lastActiveAt?.getTime() ?? 0 :
          query.sortBy === "mrr" ? right.monthlyRecurringRevenue : right.totalUsers;
    return (leftValue < rightValue ? -1 : leftValue > rightValue ? 1 : 0) * direction;
  });
  const total = rows.length;
  const start = (query.page - 1) * query.limit;
  return {
    data: rows.slice(start, start + query.limit),
    pagination: {
      page: query.page, limit: query.limit, total, totalPages: Math.ceil(total / query.limit),
      hasPreviousPage: query.page > 1, hasNextPage: query.page * query.limit < total
    },
    metadata: { currency: "NGN", filters: { search: query.search ?? null, plan: query.plan ?? null, status: query.status ?? null, module: query.module ?? null }, sorting: { sortBy: query.sortBy, sortOrder: query.sortOrder } }
  };
};

export const getPlatformTenantSummary = async (tenantId: string, platformAdmin: AuthUser) => {
  assertPlatformAdmin(platformAdmin);
  const snapshot = await loadPlatformTenantSnapshot({ id: tenantId, ...managedTenantWhere });
  const organization = snapshot.organizations[0];
  if (!organization) throw notFound("Tenant not found");
  const subscription = snapshot.subscriptions.get(organization.id)!;
  const subscriptionStatus = organization.status === "SUSPENDED" ? "SUSPENDED" : subscription.status;
  const activeUsers = snapshot.activeUsersByOrganization.get(organization.id) ?? 0;
  const totalUsers = activeUsers + (snapshot.unlinkedEmployeesByOrganization.get(organization.id) ?? 0);
  const lastLoginDate = snapshot.activityByOrganization.get(organization.id) ?? null;
  const daysSinceLastLogin = lastLoginDate ? Math.max(0, Math.floor((Date.now() - lastLoginDate.getTime()) / 86_400_000)) : null;
  return {
    organization: {
      organizationId: organization.id, organizationName: organization.name, companyEmail: organization.email,
      industry: organization.industry, currentPlan: { key: subscription.planKey, name: subscription.planName }, subscriptionStatus
    },
    summary: {
      totalUsers, activeUsers, seatAllocation: subscription.seatAllocation, seatsUsed: activeUsers,
      activeModules: moduleBadges(subscription),
      monthlyRecurringRevenue: subscriptionStatus === "ACTIVE" ? subscription.baseMonthlyRecurringRevenue : 0,
      currency: "NGN", lastLoginDate, daysSinceLastLogin
    }
  };
};

export const suspendPlatformTenant = async (tenantId: string, body: unknown, platformAdmin: AuthUser) => {
  assertPlatformAdmin(platformAdmin);
  const payload = suspendPlatformTenantSchema.parse(body);
  const tenant = await prisma.organization.findFirst({ where: { id: tenantId, ...managedTenantWhere }, select: { id: true, name: true, status: true } });
  if (!tenant) throw notFound("Tenant not found");
  if (tenant.status === "SUSPENDED") throw badRequest("Tenant is already suspended", { errorCode: "INVALID_TENANT_STATE" });
  const suspendedAt = new Date();
  const [updated, sessions] = await prisma.$transaction([
    prisma.organization.update({ where: { id: tenant.id }, data: { status: "SUSPENDED", suspendedAt, suspensionReason: payload.reason, suspendedByUserId: platformAdmin.id } }),
    prisma.userSession.updateMany({ where: { organizationId: tenant.id, revokedAt: null }, data: { revokedAt: suspendedAt, revokeReason: payload.reason ? `Tenant suspended: ${payload.reason}` : "Tenant suspended by Platform Admin", isCurrent: false } })
  ]);
  await createAuditLog({
    organizationId: tenant.id, actorUserId: platformAdmin.id, action: "PLATFORM_TENANT_SUSPENDED",
    resource: "ORGANIZATION", resourceId: tenant.id, summary: `Suspended tenant ${tenant.name}`,
    metadata: { reason: payload.reason ?? null, suspendedAt: suspendedAt.toISOString(), invalidatedSessions: sessions.count }
  });
  return {
    organizationId: updated.id, organizationName: updated.name, status: "SUSPENDED",
    suspensionReason: updated.suspensionReason, suspendedAt: updated.suspendedAt,
    suspendedByUserId: updated.suspendedByUserId, invalidatedSessions: sessions.count
  };
};

const slugifyTenant = (value: string) => value.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "tenant";
const nextTenantSlug = async (tx: Prisma.TransactionClient, companyName: string) => {
  const base = slugifyTenant(companyName); let slug = base; let suffix = 1;
  while (await tx.organization.findUnique({ where: { slug }, select: { id: true } })) slug = `${base}-${++suffix}`;
  return slug;
};

export const createPlatformTenant = async (body: unknown, platformAdmin: AuthUser) => {
  assertPlatformAdmin(platformAdmin);
  const payload = createPlatformTenantSchema.parse(body);
  const [companyExists, emailExists] = await Promise.all([
    prisma.organization.findFirst({ where: { name: payload.companyName }, select: { id: true } }),
    prisma.user.findFirst({ where: { email: payload.adminEmail }, select: { id: true } })
  ]);
  if (companyExists) throw badRequest("Company name already exists", { errorCode: "DUPLICATE_COMPANY_NAME" });
  if (emailExists) throw badRequest("Admin email already exists", { errorCode: "DUPLICATE_ADMIN_EMAIL" });
  const plan = getBillingPlanDefinition(payload.subscriptionPlan)!;
  const currentPlanPrice = (await getEffectivePlanCatalogue()).find((item) => item.key === plan.key)?.monthlyPrice ?? plan.monthlyCost;
  const now = new Date(); const renewalDate = new Date(now); renewalDate.setMonth(renewalDate.getMonth() + 1);
  const temporaryPasswordHash = await bcrypt.hash(crypto.randomBytes(32).toString("hex"), 12);
  const created = await prisma.$transaction(async (tx) => {
    const slug = await nextTenantSlug(tx, payload.companyName);
    const organization = await tx.organization.create({ data: { name: payload.companyName, slug, email: payload.adminEmail, country: payload.country, industry: payload.industry, status: "ACTIVE", currency: "NGN" } });
    const role = await tx.role.create({ data: { organizationId: organization.id, name: "Owner", description: "Tenant organization owner", isSystem: true } });
    const tenantPermissions = await tx.permission.findMany({ where: { key: { not: { startsWith: "platform:" } } }, select: { id: true } });
    await tx.rolePermission.createMany({ data: tenantPermissions.map((permission) => ({ roleId: role.id, permissionId: permission.id })), skipDuplicates: true });
    const [firstName, ...lastParts] = payload.adminEmail.split("@")[0].split(/[._-]+/).filter(Boolean);
    const admin = await tx.user.create({ data: { organizationId: organization.id, roleId: role.id, email: payload.adminEmail, firstName: firstName || "Tenant", lastName: lastParts.join(" ") || "Admin", passwordHash: temporaryPasswordHash, isActive: true } });
    await tx.organizationGeneralSettings.create({ data: { organizationId: organization.id, currency: "NGN", timeZone: "Africa/Lagos", language: "en", dateFormat: "DD/MM/YYYY" } });
    await tx.systemConfig.create({ data: { organizationId: organization.id, key: subscriptionKey, value: { planKey: plan.key, status: "ACTIVE", billingCycle: "MONTHLY", currency: "NGN", renewalDate: renewalDate.toISOString(), activatedAt: now.toISOString(), paymentVerifiedAt: now.toISOString(), automaticRenewal: true, cancelAtPeriodEnd: false, ...(payload.seatAllocation ? { totalSeats: payload.seatAllocation } : {}) } } });
    await tx.systemConfig.createMany({ data: billingModuleKeys.map((moduleKey) => ({ organizationId: organization.id, key: `module.${moduleKey}.status`, value: plan.includedModules.includes(moduleKey) ? "ACTIVE" : "INACTIVE" })) });
    return { organization, admin };
  });
  await createAuditLog({ organizationId: created.organization.id, actorUserId: platformAdmin.id, action: "PLATFORM_TENANT_CREATED", resource: "ORGANIZATION", resourceId: created.organization.id, summary: `Created tenant ${created.organization.name}`, metadata: { planKey: plan.key, adminEmail: created.admin.email, country: payload.country } });
  const invitation = await forgotPassword({ email: created.admin.email, organizationSlug: created.organization.slug });
  return {
    organizationId: created.organization.id, companyName: created.organization.name, slug: created.organization.slug,
    admin: { userId: created.admin.id, email: created.admin.email, invitationStatus: "PASSWORD_SETUP_SENT" },
    subscription: { planKey: plan.key, planName: plan.name, status: "ACTIVE", monthlyCost: currentPlanPrice, renewalDate },
    activeModules: plan.includedModules.map((key) => ({ id: key, name: moduleLabels[key] })),
    country: created.organization.country, createdAt: created.organization.createdAt,
    onboarding: { delivery: "PASSWORD_RESET_EMAIL", expiresInSeconds: invitation.expiresInSeconds }
  };
};

export const activatePlatformTenant = async (tenantId: string, platformAdmin: AuthUser) => {
  assertPlatformAdmin(platformAdmin);
  const tenant = await prisma.organization.findFirst({ where: { id: tenantId, ...managedTenantWhere }, select: { id: true, name: true, status: true } });
  if (!tenant) throw notFound("Tenant not found");
  if (tenant.status !== "SUSPENDED") throw badRequest("Only a suspended tenant can be activated", { errorCode: "INVALID_TENANT_STATE" });
  const updated = await prisma.organization.update({ where: { id: tenant.id }, data: { status: "ACTIVE", suspendedAt: null, suspensionReason: null, suspendedByUserId: null } });
  await createAuditLog({ organizationId: tenant.id, actorUserId: platformAdmin.id, action: "PLATFORM_TENANT_ACTIVATED", resource: "ORGANIZATION", resourceId: tenant.id, summary: `Activated tenant ${tenant.name}` });
  return { organizationId: updated.id, organizationName: updated.name, status: updated.status, activatedAt: updated.updatedAt };
};

export const getPlatformTenantCompleteDetails = async (tenantId: string, platformAdmin: AuthUser) => {
  const summary = await getPlatformTenantSummary(tenantId, platformAdmin);
  const organization = await prisma.organization.findFirst({ where: { id: tenantId, ...managedTenantWhere }, select: { id: true, name: true, email: true, industry: true, country: true, createdAt: true, updatedAt: true } });
  if (!organization) throw notFound("Tenant not found");
  return { ...summary, organization: { ...summary.organization, country: organization.country, createdAt: organization.createdAt, updatedAt: organization.updatedAt, monthlyRecurringRevenue: summary.summary.monthlyRecurringRevenue } };
};

export const getPlatformTenantOverview = async (tenantId: string, platformAdmin: AuthUser) => {
  const summary = await getPlatformTenantSummary(tenantId, platformAdmin);
  const record = await prisma.organization.findFirst({
    where: { id: tenantId, ...managedTenantWhere },
    select: { name: true, industry: true, email: true, phone: true, website: true, country: true, address: true, taxId: true, cacNumber: true, profileImageUrl: true, generalSettings: { select: { timeZone: true, currency: true, dateFormat: true, language: true, logoUrl: true } } }
  });
  if (!record) throw notFound("Tenant not found");
  return {
    analytics: { totalUsers: summary.summary.totalUsers, activeUsers: summary.summary.activeUsers, activeModules: summary.summary.activeModules, currentSubscription: summary.organization.currentPlan, monthlyRecurringRevenue: summary.summary.monthlyRecurringRevenue, currency: "NGN" },
    aboutCompany: {
      companyName: record.name, industry: record.industry, companyEmail: record.email, phoneNumber: record.phone,
      website: record.website, country: record.country, address: record.address, taxIdentificationNumber: record.taxId,
      businessRegistrationNumber: record.cacNumber, timezone: record.generalSettings?.timeZone ?? null,
      currency: record.generalSettings?.currency ?? "NGN", dateFormat: record.generalSettings?.dateFormat ?? null,
      language: record.generalSettings?.language ?? null, logo: record.generalSettings?.logoUrl ?? record.profileImageUrl
    }
  };
};

export const getPlatformTenantUsers = async (tenantId: string, queryInput: unknown, platformAdmin: AuthUser) => {
  assertPlatformAdmin(platformAdmin); await getPlatformTenantSummary(tenantId, platformAdmin);
  const query = platformTenantUsersQuerySchema.parse(queryInput);
  const organization = await prisma.organization.findUniqueOrThrow({ where: { id: tenantId }, select: { status: true } });
  const suspended = organization.status === "SUSPENDED";
  const includeUsers = query.status === "ALL" || (suspended ? query.status === "SUSPENDED" : query.status === "ACTIVE" || query.status === "INACTIVE");
  const includeInvitations = query.status === "ALL" || query.status === "INVITED";
  const userWhere: Prisma.UserWhereInput = {
    organizationId: tenantId,
    ...(query.search ? { OR: [{ email: { contains: query.search } }, { firstName: { contains: query.search } }, { lastName: { contains: query.search } }] } : {}),
    ...(!suspended && query.status === "ACTIVE" ? { isActive: true } : {}),
    ...(!suspended && query.status === "INACTIVE" ? { isActive: false } : {})
  };
  const invitationWhere: Prisma.AgentInvitationWhereInput = { organizationId: tenantId, status: "PENDING", ...(query.search ? { email: { contains: query.search } } : {}) };
  const take = query.page * query.limit;
  const [totalUsers, userTotal, invitationTotal, users, invitations] = await Promise.all([
    prisma.user.count({ where: { organizationId: tenantId } }),
    includeUsers ? prisma.user.count({ where: userWhere }) : Promise.resolve(0),
    includeInvitations ? prisma.agentInvitation.count({ where: invitationWhere }) : Promise.resolve(0),
    includeUsers ? prisma.user.findMany({ where: userWhere, include: { role: { select: { name: true } } }, orderBy: { createdAt: "desc" }, take }) : Promise.resolve([]),
    includeInvitations ? prisma.agentInvitation.findMany({ where: invitationWhere, include: { role: { select: { name: true } } }, orderBy: { createdAt: "desc" }, take }) : Promise.resolve([])
  ]);
  const rows = [
    ...users.map((user) => ({ userId: user.id, fullName: `${user.firstName} ${user.lastName}`.trim(), email: user.email, role: user.role.name, lastActive: user.lastLoginAt, accountStatus: suspended ? "SUSPENDED" : user.isActive ? "ACTIVE" : "INACTIVE", recordType: "USER", createdAt: user.createdAt })),
    ...invitations.map((invitation) => ({ userId: invitation.id, fullName: null, email: invitation.email, role: invitation.role?.name ?? null, lastActive: null, accountStatus: "INVITED", recordType: "INVITATION", createdAt: invitation.createdAt }))
  ].sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime());
  const total = userTotal + invitationTotal; const start = (query.page - 1) * query.limit;
  return {
    totalUsers,
    data: rows.slice(start, start + query.limit).map(({ createdAt: _createdAt, ...row }) => row),
    pagination: { page: query.page, limit: query.limit, total, totalPages: Math.ceil(total / query.limit), hasPreviousPage: query.page > 1, hasNextPage: query.page * query.limit < total }
  };
};

export const deactivatePlatformTenantUser = async (tenantId: string, userId: string, platformAdmin: AuthUser) => {
  assertPlatformAdmin(platformAdmin);
  const user = await prisma.user.findFirst({ where: { id: userId, organizationId: tenantId }, select: { id: true, email: true, isActive: true } });
  if (!user) throw notFound("User not found");
  if (!user.isActive) throw badRequest("User is already inactive", { errorCode: "INVALID_USER_STATE" });
  const now = new Date();
  const [updated, sessions] = await prisma.$transaction([
    prisma.user.update({ where: { id: user.id }, data: { isActive: false } }),
    prisma.userSession.updateMany({ where: { userId: user.id, revokedAt: null }, data: { revokedAt: now, isCurrent: false, revokeReason: "Deactivated by Platform Admin" } })
  ]);
  await createAuditLog({ organizationId: tenantId, actorUserId: platformAdmin.id, action: "PLATFORM_USER_DEACTIVATED", resource: "USER", resourceId: user.id, summary: `Deactivated user ${user.email}`, metadata: { invalidatedSessions: sessions.count } });
  return { userId: updated.id, email: updated.email, status: "INACTIVE", invalidatedSessions: sessions.count };
};

export const resetPlatformTenantUserPassword = async (tenantId: string, userId: string, platformAdmin: AuthUser) => {
  assertPlatformAdmin(platformAdmin);
  const user = await prisma.user.findFirst({ where: { id: userId, organizationId: tenantId, isActive: true }, include: { organization: { select: { slug: true } } } });
  if (!user) throw notFound("Active user not found");
  const reset = await forgotPassword({ email: user.email, organizationSlug: user.organization.slug });
  await createAuditLog({ organizationId: tenantId, actorUserId: platformAdmin.id, action: "PLATFORM_PASSWORD_RESET_TRIGGERED", resource: "USER", resourceId: user.id, summary: `Triggered password reset for ${user.email}` });
  return { userId: user.id, email: user.email, delivery: "EMAIL_OTP", expiresInSeconds: reset.expiresInSeconds };
};

export const getPlatformTenantModules = async (tenantId: string, platformAdmin: AuthUser) => {
  assertPlatformAdmin(platformAdmin);
  const subscriptions = await buildSubscriptionSnapshots([tenantId]); const subscription = subscriptions.get(tenantId);
  if (!subscription || !(await prisma.organization.findFirst({ where: { id: tenantId, ...managedTenantWhere }, select: { id: true } }))) throw notFound("Tenant not found");
  const plan = getBillingPlanDefinition(subscription.planKey)!;
  return { currentPlan: { key: plan.key, name: plan.name }, modules: billingModuleKeys.map((key) => ({ moduleId: key, moduleName: moduleLabels[key], status: subscription.activeModules.includes(key) ? "ACTIVE" : "INACTIVE", includedInPlan: plan.includedModules.includes(key), canDisable: !plan.includedModules.includes(key) })) };
};

export const togglePlatformTenantModule = async (tenantId: string, moduleId: BillingModuleKey, body: unknown, platformAdmin: AuthUser) => {
  assertPlatformAdmin(platformAdmin); const payload = platformModuleToggleSchema.parse(body);
  return setPlatformTenantModule(tenantId, moduleId, payload.enabled, "Platform tenant module toggle", platformAdmin);
};

export const getPlatformTenantBilling = async (tenantId: string, queryInput: unknown, platformAdmin: AuthUser) => {
  assertPlatformAdmin(platformAdmin); const query = platformTenantBillingQuerySchema.parse(queryInput);
  const subscription = (await buildSubscriptionSnapshots([tenantId])).get(tenantId);
  if (!subscription || !(await prisma.organization.findFirst({ where: { id: tenantId, ...managedTenantWhere }, select: { id: true } }))) throw notFound("Tenant not found");
  const where: Prisma.BillingHistoryWhereInput = { organizationId: tenantId, ...(query.status !== "ALL" ? { status: { in: [query.status, query.status.toLowerCase()] } } : {}) };
  const [total, invoices] = await prisma.$transaction([prisma.billingHistory.count({ where }), prisma.billingHistory.findMany({ where, orderBy: { billedAt: "desc" }, skip: (query.page - 1) * query.limit, take: query.limit } )]);
  return {
    currentSubscription: { currentPlan: { key: subscription.planKey, name: subscription.planName }, monthlyCost: subscription.monthlyRecurringRevenue, billingCycle: subscription.billingCycle, renewalDate: subscription.renewalDate, subscriptionStatus: subscription.status, currency: "NGN" },
    invoices: invoices.map((invoice) => ({ invoiceId: invoice.id, billingPeriod: objectValue(invoice.metadata).billingPeriod ?? invoice.billedAt.toISOString().slice(0, 7), amount: Number(invoice.amount), paymentStatus: invoice.status.toUpperCase(), invoiceDate: invoice.billedAt, invoiceIdentifier: invoice.id })),
    pagination: { page: query.page, limit: query.limit, total, totalPages: Math.ceil(total / query.limit), hasPreviousPage: query.page > 1, hasNextPage: query.page * query.limit < total }
  };
};

export const overridePlatformTenantPlan = async (tenantId: string, body: unknown, platformAdmin: AuthUser) => {
  assertPlatformAdmin(platformAdmin); const payload = overridePlatformTenantPlanSchema.parse(body);
  const current = (await buildSubscriptionSnapshots([tenantId])).get(tenantId); if (!current) throw notFound("Tenant not found");
  const selected = getBillingPlanDefinition(payload.plan)!; if (selected.key === current.planKey) throw badRequest("Tenant is already on the selected plan", { errorCode: "DUPLICATE_OPERATION" });
  const selectedMonthlyPrice = (await getEffectivePlanCatalogue()).find((item) => item.key === selected.key)?.monthlyPrice ?? selected.monthlyCost;
  const effectiveDate = payload.effectiveDate ?? new Date(); const existing = await prisma.systemConfig.findUnique({ where: { organizationId_key: { organizationId: tenantId, key: subscriptionKey } } });
  const value = objectValue(existing?.value); const previousMonthlyCost = current.monthlyRecurringRevenue;
  await prisma.$transaction([
    prisma.systemConfig.upsert({ where: { organizationId_key: { organizationId: tenantId, key: subscriptionKey } }, create: { organizationId: tenantId, key: subscriptionKey, value: { planKey: selected.key, status: "ACTIVE", billingCycle: "MONTHLY", currency: "NGN", renewalDate: new Date(effectiveDate.getTime() + 30 * 86_400_000).toISOString(), totalSeats: payload.seatAllocation } }, update: { value: { ...value, planKey: selected.key, status: "ACTIVE", ...(payload.seatAllocation ? { totalSeats: payload.seatAllocation } : {}), planOverriddenAt: effectiveDate.toISOString(), planOverriddenBy: platformAdmin.id } } }),
    ...billingModuleKeys.map((key) => prisma.systemConfig.upsert({ where: { organizationId_key: { organizationId: tenantId, key: `module.${key}.status` } }, create: { organizationId: tenantId, key: `module.${key}.status`, value: selected.includedModules.includes(key) ? "ACTIVE" : "INACTIVE" }, update: { value: selected.includedModules.includes(key) ? "ACTIVE" : "INACTIVE" } })),
    prisma.billingNotification.create({ data: { organizationId: tenantId, type: `PLAN_OVERRIDE_${effectiveDate.getTime()}`, renewalDate: current.renewalDate ?? effectiveDate, scheduledFor: effectiveDate, channels: ["EMAIL", "IN_APP"], status: "PENDING" } })
  ]);
  await createAuditLog({ organizationId: tenantId, actorUserId: platformAdmin.id, action: "PLATFORM_PLAN_OVERRIDDEN", resource: "SUBSCRIPTION", resourceId: tenantId, summary: `Overrode plan from ${current.planName} to ${selected.name}`, metadata: { fromPlan: current.planKey, toPlan: selected.key, reason: payload.reason ?? null, effectiveDate: effectiveDate.toISOString() } });
  return { currentPlan: { key: current.planKey, name: current.planName }, selectedPlan: { key: selected.key, name: selected.name }, previousMonthlyCost, newMonthlyCost: selectedMonthlyPrice, effectiveDate, billingImpact: selectedMonthlyPrice - previousMonthlyCost, currency: "NGN" };
};

export const getPlatformTenantActivity = async (tenantId: string, queryInput: unknown, platformAdmin: AuthUser) => {
  assertPlatformAdmin(platformAdmin); await getPlatformTenantSummary(tenantId, platformAdmin);
  const query = platformTenantActivityQuerySchema.parse(queryInput); const take = query.page * query.limit;
  const [auditTotal, authTotal, audits, authEvents] = await Promise.all([
    prisma.auditLog.count({ where: { organizationId: tenantId } }), prisma.authEvent.count({ where: { organizationId: tenantId } }),
    prisma.auditLog.findMany({ where: { organizationId: tenantId }, include: { actorUser: { select: { id: true, firstName: true, lastName: true, email: true } } }, orderBy: { createdAt: "desc" }, take }),
    prisma.authEvent.findMany({ where: { organizationId: tenantId }, include: { user: { select: { id: true, firstName: true, lastName: true, email: true } } }, orderBy: { occurredAt: "desc" }, take })
  ]);
  const rows = [
    ...audits.map((entry) => ({ activityId: entry.id, eventType: entry.action, description: entry.summary, performedBy: entry.actorUser ? { id: entry.actorUser.id, name: `${entry.actorUser.firstName} ${entry.actorUser.lastName}`, email: entry.actorUser.email } : null, timestamp: entry.createdAt, ipAddress: objectValue(entry.metadata).ipAddress ?? null })),
    ...authEvents.map((entry) => ({ activityId: entry.id, eventType: entry.eventType, description: entry.reasonCode ? `${entry.eventType}: ${entry.reasonCode}` : entry.eventType, performedBy: entry.user ? { id: entry.user.id, name: `${entry.user.firstName} ${entry.user.lastName}`, email: entry.user.email } : entry.emailAttempted ? { id: null, name: null, email: entry.emailAttempted } : null, timestamp: entry.occurredAt, ipAddress: entry.ipAddress }))
  ].sort((left, right) => right.timestamp.getTime() - left.timestamp.getTime());
  const total = auditTotal + authTotal; const start = (query.page - 1) * query.limit;
  return { data: rows.slice(start, start + query.limit), pagination: { page: query.page, limit: query.limit, total, totalPages: Math.ceil(total / query.limit), hasPreviousPage: query.page > 1, hasNextPage: query.page * query.limit < total } };
};

export const getPlatformTenantSupportTickets = async (tenantId: string, queryInput: unknown, platformAdmin: AuthUser) => {
  assertPlatformAdmin(platformAdmin); await getPlatformTenantSummary(tenantId, platformAdmin);
  const query = platformTenantSupportQuerySchema.parse(queryInput);
  const where: Prisma.SupportTicketWhereInput = {
    organizationId: tenantId,
    ...(query.search ? { OR: [{ ticketNumber: { contains: query.search } }, { subject: { contains: query.search } }] } : {}),
    ...(query.status !== "ALL" ? { status: query.status } : {}),
    ...(query.priority !== "ALL" ? { priority: query.priority } : {})
  };
  const [total, tickets] = await prisma.$transaction([
    prisma.supportTicket.count({ where }),
    prisma.supportTicket.findMany({ where, include: { assignedTo: { select: { id: true, firstName: true, lastName: true, email: true } } }, orderBy: { updatedAt: query.sortOrder }, skip: (query.page - 1) * query.limit, take: query.limit })
  ]);
  return {
    data: tickets.map((ticket) => ({ ticketId: ticket.id, ticketNumber: ticket.ticketNumber, subject: ticket.subject, priority: ticket.priority, status: ticket.status, assignedTo: ticket.assignedTo ? { id: ticket.assignedTo.id, name: `${ticket.assignedTo.firstName} ${ticket.assignedTo.lastName}`, email: ticket.assignedTo.email } : null, updatedAt: ticket.updatedAt })),
    pagination: { page: query.page, limit: query.limit, total, totalPages: Math.ceil(total / query.limit), hasPreviousPage: query.page > 1, hasNextPage: query.page * query.limit < total }
  };
};

export const impersonatePlatformTenantAdmin = async (tenantId: string, platformAdmin: AuthUser, requestMeta?: { ipAddress?: string | null; userAgent?: string | null }) => {
  assertPlatformAdmin(platformAdmin);
  const tenant = await prisma.organization.findFirst({ where: { id: tenantId, ...managedTenantWhere, status: "ACTIVE" }, select: { id: true, name: true } });
  if (!tenant) throw notFound("Active tenant not found");
  const tenantAdmin = await prisma.user.findFirst({ where: { organizationId: tenant.id, isActive: true, role: { isSystem: true, name: "Owner" } }, orderBy: { createdAt: "asc" }, select: { id: true, email: true, organizationId: true } });
  if (!tenantAdmin) throw notFound("Active Tenant Admin not found");
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000);
  const session = await prisma.platformImpersonationSession.create({ data: { organizationId: tenant.id, platformAdminUserId: platformAdmin.id, tenantAdminUserId: tenantAdmin.id, expiresAt, ipAddress: requestMeta?.ipAddress, userAgent: requestMeta?.userAgent } });
  const accessToken = jwt.sign({ organizationId: tenant.id, purpose: "platform-impersonation", impersonationSessionId: session.id, platformAdminUserId: platformAdmin.id }, env.JWT_ACCESS_SECRET, { subject: tenantAdmin.id, expiresIn: "15m" });
  await createAuditLog({ organizationId: tenant.id, actorUserId: platformAdmin.id, action: "PLATFORM_IMPERSONATION_STARTED", resource: "IMPERSONATION_SESSION", resourceId: session.id, summary: `Started impersonation of ${tenantAdmin.email}`, metadata: { expiresAt: expiresAt.toISOString() } });
  return { impersonationSessionId: session.id, tenant: { organizationId: tenant.id, organizationName: tenant.name }, impersonatedUser: { userId: tenantAdmin.id, email: tenantAdmin.email }, accessToken, tokenType: "Bearer", expiresAt, impersonated: true };
};

export const exitPlatformTenantImpersonation = async (currentUser: AuthUser) => {
  if (!currentUser.impersonation) throw forbidden("An active impersonation session is required");
  const session = await prisma.platformImpersonationSession.findFirst({ where: { id: currentUser.impersonation.sessionId, platformAdminUserId: currentUser.impersonation.platformAdminUserId, tenantAdminUserId: currentUser.id, status: "ACTIVE", endedAt: null }, include: { platformAdmin: { select: { id: true, organizationId: true, isPlatformAdmin: true, isActive: true } }, organization: { select: { id: true } } } });
  if (!session || !session.platformAdmin.isPlatformAdmin || !session.platformAdmin.isActive) throw forbidden("Impersonation session cannot be exited");
  const endedAt = new Date();
  const ended = await prisma.platformImpersonationSession.updateMany({ where: { id: session.id, status: "ACTIVE", endedAt: null }, data: { status: "ENDED", endedAt } });
  if (ended.count !== 1) throw conflict("Impersonation session has already ended", { errorCode: "IMPERSONATION_ALREADY_ENDED" });
  const accessToken = jwt.sign({ organizationId: session.platformAdmin.organizationId }, env.JWT_ACCESS_SECRET, { subject: session.platformAdmin.id, expiresIn: env.JWT_ACCESS_EXPIRES_IN as jwt.SignOptions["expiresIn"] });
  await createAuditLog({ organizationId: session.organizationId, actorUserId: session.platformAdmin.id, action: "PLATFORM_IMPERSONATION_ENDED", resource: "IMPERSONATION_SESSION", resourceId: session.id, summary: "Ended Platform Admin impersonation session" });
  return { impersonationSessionId: session.id, endedAt, accessToken, tokenType: "Bearer", impersonated: false };
};

type PricingRequestMeta = { ipAddress?: string | null; requestId?: string | null };
const normalizePlanName = (value: string) => value.trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const planKeyFromName = (value: string) => normalizePlanName(value).replace(/\s+/g, "-");
const loadPricingAnalytics = async () => {
  const [snapshot, catalogue] = await Promise.all([
    loadPlatformTenantSnapshot(excludedTenantWhere),
    getEffectivePlanCatalogue()
  ]);
  const activeSubscriptions = [...snapshot.subscriptions.values()].filter((subscription) => subscription.status === "ACTIVE");
  const organizationIds = activeSubscriptions.map((subscription) => subscription.organizationId);
  const employeeCounts = organizationIds.length
    ? await prisma.employee.groupBy({ by: ["organizationId"], where: { organizationId: { in: organizationIds }, status: { not: "TERMINATED" } }, _count: { id: true } })
    : [];
  const employeesByOrganization = new Map(employeeCounts.map((row) => [row.organizationId, row._count.id]));
  const totalRevenue = sumMoney(activeSubscriptions.map((subscription) => subscription.monthlyRecurringRevenue));
  const rows = catalogue.map((plan) => {
    const subscribers = activeSubscriptions.filter((subscription) =>
      subscription.revenueComponents.some((component) => component.key === plan.key)
    );
    const monthlyRevenue = sumMoney(subscribers.flatMap((subscription) =>
      subscription.revenueComponents.filter((component) => component.key === plan.key).map((component) => component.monthlyRevenue)
    ));
    const totalEmployees = subscribers.reduce((total, subscription) => total + (employeesByOrganization.get(subscription.organizationId) ?? 0), 0);
    return {
      id: plan.id, key: plan.key, name: plan.name, description: plan.description,
      activeTenantCount: subscribers.length, monthlyPrice: plan.monthlyPrice,
      features: plan.features, monthlyRevenue, currency: "NGN", pricingModel: plan.pricingModel,
      status: plan.status, updatedAt: plan.updatedAt, totalEmployees,
      revenueContributionPercentage: revenueContributionPercentage(monthlyRevenue, totalRevenue),
      rowVersion: plan.rowVersion, includedModules: plan.includedModules
    };
  });
  const totalEmployees = [...new Set(activeSubscriptions.map((subscription) => subscription.organizationId))]
    .reduce((total, organizationId) => total + (employeesByOrganization.get(organizationId) ?? 0), 0);
  return { snapshot, activeSubscriptions, catalogue, rows, totalRevenue, totalEmployees };
};

export const getPlatformPricingOverview = async (queryInput: unknown, platformAdmin: AuthUser) => {
  assertPlatformAdmin(platformAdmin);
  const query = platformPricingQuerySchema.parse(queryInput);
  const analytics = await loadPricingAnalytics();
  const revenueByKey = new Map(analytics.rows.map((row) => [row.key, row.monthlyRevenue]));
  const overview = {
    totalRevenue: analytics.totalRevenue,
    moduleRevenue: {
      hris: revenueByKey.get("hris") ?? 0,
      accounting: revenueByKey.get("accounting") ?? 0,
      payroll: revenueByKey.get("payroll") ?? 0
    },
    allInOneRevenue: revenueByKey.get("all-in-one") ?? 0,
    totalActiveTenants: new Set(analytics.activeSubscriptions.map((subscription) => subscription.organizationId)).size,
    totalActiveSubscriptions: analytics.activeSubscriptions.reduce((total, subscription) => total + subscription.revenueComponents.length, 0),
    currency: "NGN"
  };
  let distribution = [...analytics.rows];
  if (query.search) distribution = distribution.filter((row) => row.name.toLowerCase().includes(query.search!.toLowerCase()));
  if (query.status !== "ALL") distribution = distribution.filter((row) => row.status === query.status);
  if (query.pricingModel !== "ALL") distribution = distribution.filter((row) => row.pricingModel === query.pricingModel);
  distribution.sort((left, right) => {
    const leftValue = query.sortBy === "name" ? left.name.toLowerCase() : query.sortBy === "activeTenantCount" ? left.activeTenantCount : query.sortBy === "monthlyRevenue" ? left.monthlyRevenue : query.sortBy === "basePrice" ? left.monthlyPrice : left.totalEmployees;
    const rightValue = query.sortBy === "name" ? right.name.toLowerCase() : query.sortBy === "activeTenantCount" ? right.activeTenantCount : query.sortBy === "monthlyRevenue" ? right.monthlyRevenue : query.sortBy === "basePrice" ? right.monthlyPrice : right.totalEmployees;
    const comparison = leftValue < rightValue ? -1 : leftValue > rightValue ? 1 : 0;
    return query.sortOrder === "asc" ? comparison : -comparison;
  });
  const total = distribution.length; const start = (query.page - 1) * query.limit;
  const items = distribution.slice(start, start + query.limit).map((row) => ({
    id: row.id, key: row.key, name: row.name, basePricePerMonth: row.monthlyPrice,
    totalEmployees: row.totalEmployees, activeTenants: row.activeTenantCount,
    activeTenantTotal: row.activeTenantCount, monthlyRevenue: row.monthlyRevenue,
    monthlyRevenueTotal: row.monthlyRevenue, revenueContributionPercentage: row.revenueContributionPercentage,
    currency: "NGN", status: row.status, pricingModel: row.pricingModel
  }));
  const pagination = { page: query.page, limit: query.limit, total, totalPages: Math.ceil(total / query.limit), hasPreviousPage: query.page > 1, hasNextPage: query.page * query.limit < total };
  return {
    overview,
    modules: analytics.rows,
    subscriptionDistribution: {
      items,
      summary: {
        totalActiveTenants: overview.totalActiveTenants,
        totalEmployees: analytics.totalEmployees,
        totalMonthlyRevenue: analytics.totalRevenue,
        currency: "NGN"
      },
      pagination
    },
    plans: analytics.catalogue.map((plan) => ({
      planId: plan.id,
      key: plan.key,
      planName: plan.name,
      monthlyPrice: plan.monthlyPrice,
      currency: "NGN",
      description: plan.description,
      features: plan.features,
      includedModules: plan.includedModules,
      status: plan.status,
      pricingModel: plan.pricingModel,
      createdAt: plan.createdAt,
      updatedAt: plan.updatedAt,
      rowVersion: plan.rowVersion
    }))
  };
};

const identifySubscribedComponents = async (planKey: string) => {
  const configs = await prisma.systemConfig.findMany({
    where: { OR: [{ key: subscriptionKey }, { key: `${addOnPrefix}.${planKey}.subscription` }] },
    select: { organizationId: true, key: true, value: true }
  });
  return configs.flatMap((config) => {
    const value = objectValue(config.value);
    if (config.key === subscriptionKey && value.planKey === planKey && normalizeStatus(value.status) === "ACTIVE") {
      return [{ organizationId: config.organizationId, source: "BASE_PLAN", renewalDate: dateValue(value.renewalDate) }];
    }
    if (config.key !== subscriptionKey && isActiveAddOn(config.value)) {
      return [{ organizationId: config.organizationId, source: "ADD_ON", renewalDate: dateValue(value.renewalDate) }];
    }
    return [];
  });
};

export const updatePlatformModulePrice = async (moduleId: string, body: unknown, platformAdmin: AuthUser, requestMeta?: PricingRequestMeta) => {
  assertPlatformAdmin(platformAdmin);
  const payload = updatePlatformPriceSchema.parse(body);
  const plan = await prisma.billingProductPlan.findFirst({ where: { OR: [{ id: moduleId }, { key: moduleId }] }, include: { prices: { orderBy: { version: "desc" }, take: 1 } } });
  if (!plan) throw notFound("Module or plan not found");
  const latest = plan.prices[0];
  if (!latest) throw badRequest("Plan has no price history", { errorCode: "PRICE_HISTORY_MISSING" });
  const now = new Date();
  if (payload.effectiveAt.getTime() < now.getTime() - 5 * 60 * 1000) throw badRequest("effectiveAt cannot be backdated", { errorCode: "INVALID_EFFECTIVE_DATE" });
  if (latest.effectiveAt > now) throw conflict("A future price change is already scheduled", { errorCode: "PRICE_CHANGE_ALREADY_SCHEDULED", priceVersionId: latest.id });
  if (payload.effectiveAt <= latest.effectiveAt) throw badRequest("effectiveAt must be later than the latest price version", { errorCode: "INVALID_EFFECTIVE_DATE" });
  if (Number(latest.monthlyPrice) === payload.monthlyPrice) throw badRequest("New price must differ from the current price", { errorCode: "DUPLICATE_PRICE" });
  const [subscribers, existingAgreements] = await Promise.all([
    identifySubscribedComponents(plan.key),
    prisma.subscriptionPriceAgreement.findMany({
      where: { planId: plan.id, startsAt: { lte: now }, OR: [{ endsAt: null }, { endsAt: { gt: now } }] },
      select: { organizationId: true, source: true }
    })
  ]);
  const lockedSubscribers = new Set(existingAgreements.map((agreement) => `${agreement.organizationId}:${agreement.source}`));
  const subscribersWithoutAgreement = subscribers.filter((subscriber) => !lockedSubscribers.has(`${subscriber.organizationId}:${subscriber.source}`));
  const result = await prisma.$transaction(async (tx) => {
    const updated = await tx.billingProductPlan.updateMany({
      where: { id: plan.id, rowVersion: payload.expectedVersion ?? plan.rowVersion },
      data: { rowVersion: { increment: 1 } }
    });
    if (updated.count !== 1) throw conflict("Pricing was changed by another request; reload and retry", { errorCode: "PRICE_VERSION_CONFLICT" });
    await tx.billingPriceVersion.update({ where: { id: latest.id }, data: { endsAt: payload.effectiveAt } });
    const price = await tx.billingPriceVersion.create({
      data: {
        planId: plan.id, monthlyPrice: new Prisma.Decimal(payload.monthlyPrice), currency: "NGN",
        effectiveAt: payload.effectiveAt, reason: payload.reason, changedByUserId: platformAdmin.id,
        version: latest.version + 1
      }
    });
    if (subscribersWithoutAgreement.length) await tx.subscriptionPriceAgreement.createMany({
      data: subscribersWithoutAgreement.map((subscriber) => ({
        organizationId: subscriber.organizationId, planId: plan.id, priceVersionId: latest.id,
        source: subscriber.source, monthlyPrice: latest.monthlyPrice, currency: "NGN",
        startsAt: now, endsAt: subscriber.renewalDate
      })),
      skipDuplicates: true
    });
    return price;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  await createAuditLog({
    organizationId: platformAdmin.organizationId, actorUserId: platformAdmin.id,
    action: payload.effectiveAt > now ? "PRICE_CHANGE_SCHEDULED" : "MODULE_PRICE_CHANGED",
    resource: "BILLING_PRODUCT_PLAN", resourceId: plan.id, summary: `Changed ${plan.name} monthly price`,
    metadata: {
      oldPrice: Number(latest.monthlyPrice), newPrice: payload.monthlyPrice, currency: "NGN",
      effectiveAt: payload.effectiveAt.toISOString(), reason: payload.reason,
      priceVersionId: result.id, previousVersionId: latest.id,
      ipAddress: requestMeta?.ipAddress ?? null, requestId: requestMeta?.requestId ?? null
    }
  });
  return {
    planId: plan.id, key: plan.key, name: plan.name, oldPrice: Number(latest.monthlyPrice),
    newPrice: payload.monthlyPrice, currency: "NGN", effectiveAt: payload.effectiveAt,
    reason: payload.reason, changedBy: platformAdmin.id, changedAt: result.createdAt,
    priceVersionId: result.id, status: payload.effectiveAt > now ? "SCHEDULED" : "ACTIVE",
    rowVersion: plan.rowVersion + 1
  };
};

export const createPlatformPricingPlan = async (body: unknown, platformAdmin: AuthUser, requestMeta?: PricingRequestMeta) => {
  assertPlatformAdmin(platformAdmin);
  const payload = createPlatformPricingPlanSchema.parse(body);
  const normalizedName = normalizePlanName(payload.name);
  const planKey = planKeyFromName(payload.name);
  if (await prisma.billingProductPlan.findFirst({ where: { OR: [{ normalizedName }, { key: planKey }] }, select: { id: true } })) {
    throw conflict("Plan name already exists", { errorCode: "DUPLICATE_PLAN_NAME" });
  }
  const requestedIds = payload.features.flatMap((feature) => "featureId" in feature ? [feature.featureId] : []);
  const existingFeatures = requestedIds.length ? await prisma.billingFeature.findMany({ where: { id: { in: requestedIds }, status: "ACTIVE" } }) : [];
  if (existingFeatures.length !== requestedIds.length) throw badRequest("One or more referenced features do not exist", { errorCode: "FEATURE_NOT_FOUND" });
  const created = await prisma.$transaction(async (tx) => {
    const plan = await tx.billingProductPlan.create({
      data: {
        key: planKey, name: payload.name.trim(), normalizedName,
        description: payload.description, status: "ACTIVE", pricingModel: "FLAT_MONTHLY",
        isSystem: false, createdByUserId: platformAdmin.id
      }
    });
    const featureIds = [...requestedIds];
    for (const feature of payload.features) {
      if (!("name" in feature)) continue;
      const featureNormalizedName = normalizePlanName(feature.name);
      const existing = await tx.billingFeature.findFirst({ where: { moduleKey: feature.module ?? null, normalizedName: featureNormalizedName } });
      const record = existing ?? await tx.billingFeature.create({
        data: {
          key: `${plan.key}-${planKeyFromName(feature.name)}`, name: feature.name.trim(),
          normalizedName: featureNormalizedName, description: feature.description,
          moduleKey: feature.module ?? null, status: "ACTIVE"
        }
      });
      featureIds.push(record.id);
    }
    await tx.billingPlanFeature.createMany({ data: featureIds.map((featureId) => ({ planId: plan.id, featureId })), skipDuplicates: false });
    const price = await tx.billingPriceVersion.create({
      data: {
        planId: plan.id, monthlyPrice: new Prisma.Decimal(payload.monthlyPrice), currency: "NGN",
        effectiveAt: new Date(), reason: "Initial plan price", changedByUserId: platformAdmin.id, version: 1
      }
    });
    return { plan, price, featureIds };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  await createAuditLog({
    organizationId: platformAdmin.organizationId, actorUserId: platformAdmin.id,
    action: "PLAN_CREATED", resource: "BILLING_PRODUCT_PLAN", resourceId: created.plan.id,
    summary: `Created subscription plan ${created.plan.name}`,
    metadata: {
      monthlyPrice: payload.monthlyPrice, currency: "NGN", featureIds: created.featureIds,
      ipAddress: requestMeta?.ipAddress ?? null, requestId: requestMeta?.requestId ?? null
    }
  });
  return (await getEffectivePlanCatalogue()).find((plan) => plan.id === created.plan.id)!;
};

export const getPlatformDashboard = async (queryInput: unknown, platformAdmin: AuthUser) => {
  const query = platformDashboardQuerySchema.parse(queryInput);
  if (!platformAdmin.isPlatformAdmin) throw forbidden("Platform Admin access is required");
  const snapshot = await loadPlatformTenantSnapshot();
  const [analytics, revenueTrend, moduleAdoption, recentActivity, tenantHealth] = await Promise.all([
    getPlatformDashboardAnalytics(snapshot),
    getPlatformRevenueTrend(),
    getPlatformModuleAdoption(snapshot),
    getPlatformRecentActivity(query.activityLimit),
    Promise.resolve(getPlatformTenantHealth(query, snapshot))
  ]);
  return {
    analytics,
    revenueTrend,
    moduleAdoption,
    recentActivity,
    tenantHealth: { records: tenantHealth.data, pagination: tenantHealth.pagination, metadata: tenantHealth.metadata },
    metadata: { generatedAt: new Date(), currency: "NGN", activityLimit: query.activityLimit }
  };
};

namespace PlatformBillingService {
const REMINDER_COOLDOWN_MS = 24 * 60 * 60 * 1000;
const assertAdmin = (user: AuthUser) => { if (!user.isPlatformAdmin) throw forbidden("Platform Admin access is required"); };
const endExclusive = (date: Date) => new Date(date.getTime() + 86_400_000);
const planLabel = (key: string) => ({ hris: "HRIS", payroll: "PAYROLL", accounting: "ACCOUNTING", "all-in-one": "ALL_IN_ONE" }[key] ?? key.toUpperCase());
const toInvoice = (row: any) => ({ id: row.id, invoiceNumber: row.invoiceNumber, tenantId: row.organizationId, tenantName: row.organization.name, billingPeriod: row.billingPeriod, amount: Number(row.amount), currency: row.currency, status: row.status, invoiceDate: row.invoiceDate, dueDate: row.dueDate, createdAt: row.createdAt, updatedAt: row.updatedAt });
const refreshOverdueInvoices = () => prisma.platformInvoice.updateMany({ where: { status: "DRAFT", dueDate: { lt: new Date() } }, data: { status: "OVERDUE" } });

const periodBounds = (query: { year?: number; month?: number; startDate?: Date; endDate?: Date }) => {
  if (query.startDate || query.endDate) return { start: query.startDate, end: query.endDate ? endExclusive(query.endDate) : undefined };
  if (query.year && query.month) return { start: new Date(Date.UTC(query.year, query.month - 1, 1)), end: new Date(Date.UTC(query.year, query.month, 1)) };
  if (query.year) return { start: new Date(Date.UTC(query.year, 0, 1)), end: new Date(Date.UTC(query.year + 1, 0, 1)) };
  if (query.month) throw badRequest("month requires year", { errorCode: "INVALID_DATE_FILTER" });
  return {};
};

const invoiceWhere = (q: Omit<InvoiceListQuery, "page" | "limit">): Prisma.PlatformInvoiceWhereInput => {
  const dates = periodBounds(q);
  return {
    ...(q.status ? { status: q.status } : {}), ...(q.tenantId ? { organizationId: q.tenantId } : {}), ...(q.billingPeriod ? { billingPeriod: q.billingPeriod } : {}),
    ...(dates.start || dates.end ? { createdAt: { ...(dates.start ? { gte: dates.start } : {}), ...(dates.end ? { lt: dates.end } : {}) } } : {}),
    ...(q.search ? { OR: [{ id: { contains: q.search } }, { invoiceNumber: { contains: q.search } }, { organization: { is: { OR: [{ name: { contains: q.search } }, { email: { contains: q.search } }] } } }] } : {})
  };
};

export const listPlatformInvoices = async (input: unknown, user: AuthUser) => {
  assertAdmin(user); const q = invoiceListQuerySchema.parse(input); await refreshOverdueInvoices(); const where = invoiceWhere(q);
  const orderBy: Prisma.PlatformInvoiceOrderByWithRelationInput = q.sortBy === "tenantName" ? { organization: { name: q.sortOrder } } : { [q.sortBy]: q.sortOrder };
  const [total, rows] = await prisma.$transaction([prisma.platformInvoice.count({ where }), prisma.platformInvoice.findMany({ where, include: { organization: { select: { name: true } } }, orderBy, skip: (q.page - 1) * q.limit, take: q.limit })]);
  const totalPages = Math.ceil(total / q.limit);
  return { data: rows.map(toInvoice), pagination: { page: q.page, limit: q.limit, total, totalPages, hasNextPage: q.page < totalPages, hasPreviousPage: q.page > 1 } };
};

export const getBillingAnalytics = async (input: unknown, user: AuthUser) => {
  assertAdmin(user); const q = billingDateFilterSchema.parse(input); await refreshOverdueInvoices(); const now = new Date(); const dates = periodBounds(q);
  const periodStart = dates.start ?? new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const periodEnd = dates.end ?? new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  const [organizations, overdue, configs] = await Promise.all([
    prisma.organization.findMany({ where: { status: { not: "ARCHIVED" }, users: { none: { isPlatformAdmin: true } } }, select: { id: true } }),
    prisma.platformInvoice.aggregate({ where: { status: "OVERDUE" }, _sum: { amount: true } }),
    prisma.systemConfig.findMany({ where: { key: "billing.subscription" }, select: { organizationId: true, value: true } })
  ]);
  const snapshots = await buildSubscriptionSnapshots(organizations.map((o) => o.id));
  const mrr = [...snapshots.values()].reduce((sum, s) => sum + (s.status === "ACTIVE" ? s.monthlyRecurringRevenue : 0), 0);
  let starting = 0, churned = 0;
  const eligibleIds = new Set(organizations.map((organization) => organization.id));
  for (const row of configs) {
    if (!eligibleIds.has(row.organizationId)) continue;
    const value = row.value && typeof row.value === "object" && !Array.isArray(row.value) ? row.value as Record<string, unknown> : {};
    const activatedAt = new Date(String(value.activatedAt ?? "1970-01-01"));
    const endedRaw = value.cancelledAt ?? value.expiredAt ?? ((value.status === "CANCELLED" || value.status === "EXPIRED") ? value.renewalDate : undefined);
    const endedAt = endedRaw ? new Date(String(endedRaw)) : null;
    if (activatedAt < periodStart && (!endedAt || endedAt >= periodStart)) starting++;
    if (endedAt && endedAt >= periodStart && endedAt < periodEnd) churned++;
  }
  return { mrr, arr: mrr * 12, totalOverdueAmount: Number(overdue._sum.amount ?? 0), churnRate: starting ? Number(((churned / starting) * 100).toFixed(2)) : 0, currency: "NGN", period: { startDate: periodStart, endDateExclusive: periodEnd }, formulas: { mrr: "Sum of monthly recurring revenue for ACTIVE eligible tenant subscriptions", arr: "MRR Ã— 12", totalOverdueAmount: "Sum of OVERDUE platform invoice amounts", churnRate: "Subscriptions cancelled or expired during period Ã· active subscribed tenants at period start Ã— 100" } };
};

export const getRevenueByPlan = async (input: unknown, user: AuthUser) => {
  assertAdmin(user); const q = billingDateFilterSchema.parse(input); const bounds = periodBounds(q); const now = new Date();
  const start = bounds.start ?? new Date(Date.UTC(now.getUTCFullYear(), 0, 1)); const end = bounds.end ?? new Date(Date.UTC(now.getUTCFullYear() + 1, 0, 1));
  const rows = await prisma.platformInvoice.groupBy({ by: ["billingPeriod", "planKey"], where: { status: "PAID", paidAt: { gte: start, lt: end } }, _sum: { amount: true } });
  const output = new Map<string, any>();
  for (let cursor = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1)); cursor < end; cursor.setUTCMonth(cursor.getUTCMonth() + 1)) {
    const month = cursor.toISOString().slice(0, 7); output.set(month, { month, plans: { HRIS: 0, PAYROLL: 0, ACCOUNTING: 0, ALL_IN_ONE: 0 }, totalRevenue: 0 });
  }
  for (const row of rows) { const item = output.get(row.billingPeriod); if (!item || !billingPlanKeys.includes(row.planKey as BillingPlanKey)) continue; const amount = Number(row._sum.amount ?? 0); item.plans[planLabel(row.planKey)] += amount; item.totalRevenue += amount; }
  return [...output.values()];
};

export const createPlatformInvoice = async (input: unknown, user: AuthUser) => {
  assertAdmin(user); const body = createPlatformInvoiceSchema.parse(input);
  const tenant = await prisma.organization.findFirst({ where: { id: body.tenantId, status: { in: ["ACTIVE", "SUSPENDED"] }, users: { none: { isPlatformAdmin: true } }, deletionRequests: { none: { status: "PENDING_PLATFORM_APPROVAL" } } }, select: { id: true, name: true } });
  if (!tenant) throw notFound("Tenant not found or is not eligible for invoicing");
  const snapshots = await buildSubscriptionSnapshots([tenant.id]); const planKey = snapshots.get(tenant.id)?.planKey;
  if (!planKey) throw badRequest("Tenant has no valid subscription plan", { errorCode: "INVALID_SUBSCRIPTION" });
  const dueDate = body.dueDate ?? new Date(`${body.billingPeriod}-01T00:00:00.000Z`); if (!body.dueDate) dueDate.setUTCMonth(dueDate.getUTCMonth() + 1, 7);
  try {
    const row = await prisma.platformInvoice.create({ data: { invoiceNumber: `SINV-${body.billingPeriod.replace("-", "")}-${crypto.randomBytes(5).toString("hex").toUpperCase()}`, organizationId: tenant.id, billingPeriod: body.billingPeriod, planKey, amount: new Prisma.Decimal(body.amount), currency: "NGN", dueDate, createdByUserId: user.id }, include: { organization: { select: { name: true } } } });
    await createAuditLog({ organizationId: tenant.id, actorUserId: user.id, action: "PLATFORM_INVOICE_CREATED", resource: "PLATFORM_INVOICE", resourceId: row.id, summary: `Created platform invoice ${row.invoiceNumber}` });
    return toInvoice(row);
  } catch (error) { if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") throw conflict("An invoice already exists for this tenant and billing period", { errorCode: "DUPLICATE_INVOICE" }); throw error; }
};

export const sendInvoiceReminder = async (id: string, user: AuthUser) => {
  assertAdmin(user); const invoice = await prisma.platformInvoice.findUnique({ where: { id }, include: { organization: { select: { id: true, name: true, email: true } }, reminderAttempts: { orderBy: { attemptedAt: "desc" }, take: 1 } } });
  if (!invoice) throw notFound("Invoice not found"); if (!invoice.organization) throw notFound("Tenant not found"); if (invoice.status === "PAID") throw conflict("Invoice is already paid", { errorCode: "INVOICE_PAID" });
  const latest = invoice.reminderAttempts[0]; if (latest && latest.attemptedAt > new Date(Date.now() - REMINDER_COOLDOWN_MS)) throw conflict("Reminder cooldown is still active", { errorCode: "REMINDER_COOLDOWN", retryAfter: new Date(latest.attemptedAt.getTime() + REMINDER_COOLDOWN_MS) });
  if (!invoice.organization.email) throw badRequest("Tenant has no billing email", { errorCode: "TENANT_EMAIL_MISSING" });
  const attempt = await prisma.platformInvoiceReminder.create({ data: { invoiceId: id, triggeredByUserId: user.id, status: "PENDING" } });
  try { await sendPlatformInvoiceReminderEmail({ to: invoice.organization.email, tenantName: invoice.organization.name, invoiceNumber: invoice.invoiceNumber, amount: Number(invoice.amount), dueDate: invoice.dueDate }); await prisma.platformInvoiceReminder.update({ where: { id: attempt.id }, data: { status: "SENT", deliveredAt: new Date() } }); await createAuditLog({ organizationId: invoice.organizationId, actorUserId: user.id, action: "PLATFORM_INVOICE_REMINDER_SENT", resource: "PLATFORM_INVOICE", resourceId: id, summary: `Sent reminder for ${invoice.invoiceNumber}` }); return { invoiceId: id, reminderId: attempt.id, status: "SENT", sentAt: new Date() }; }
  catch { await prisma.platformInvoiceReminder.update({ where: { id: attempt.id }, data: { status: "FAILED", errorMessage: "Notification delivery failed" } }); await createAuditLog({ organizationId: invoice.organizationId, actorUserId: user.id, action: "PLATFORM_INVOICE_REMINDER_FAILED", resource: "PLATFORM_INVOICE", resourceId: id, summary: `Reminder delivery failed for ${invoice.invoiceNumber}` }); throw serviceUnavailable("Invoice reminder delivery failed"); }
};

const pdfEscape = (v: unknown) => String(v ?? "").replace(/[^\x20-\x7E]/g, " ").replace(/[\\()]/g, "\\$&");
export const downloadPlatformInvoice = async (id: string, user: AuthUser) => {
  assertAdmin(user); const row = await prisma.platformInvoice.findUnique({ where: { id }, include: { organization: { select: { name: true, email: true, phone: true, address: true } } } }); if (!row) throw notFound("Invoice not found");
  const lines = [env.APP_NAME, "PLATFORM SUBSCRIPTION INVOICE", `Invoice: ${row.invoiceNumber}`, `Invoice ID: ${row.id}`, `Tenant: ${row.organization.name}`, `Contact: ${row.organization.email ?? "N/A"} ${row.organization.phone ?? ""}`, `Address: ${row.organization.address ?? "N/A"}`, `Billing period: ${row.billingPeriod}`, `Invoice date: ${row.invoiceDate.toISOString().slice(0, 10)}`, `Due date: ${row.dueDate.toISOString().slice(0, 10)}`, `Amount: ${row.currency} ${Number(row.amount).toFixed(2)}`, `Status: ${row.status}`, "Payment instructions: Contact the Sinkronis billing team for approved payment channels."];
  const stream = `BT /F1 12 Tf 50 790 Td ${lines.map((line, i) => `${i ? "0 -28 Td " : ""}(${pdfEscape(line)}) Tj`).join(" ")} ET`; const objects = ["<< /Type /Catalog /Pages 2 0 R >>", "<< /Type /Pages /Kids [3 0 R] /Count 1 >>", "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 842] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>", `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"];
  let pdf = "%PDF-1.4\n", offset = pdf.length; const offsets = [0]; objects.forEach((o, i) => { offsets.push(offset); const part = `${i + 1} 0 obj\n${o}\nendobj\n`; pdf += part; offset += Buffer.byteLength(part); }); const xref = offset; pdf += `xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map((o) => `${String(o).padStart(10, "0")} 00000 n `).join("\n")}\ntrailer << /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  await createAuditLog({ organizationId: row.organizationId, actorUserId: user.id, action: "PLATFORM_INVOICE_DOWNLOADED", resource: "PLATFORM_INVOICE", resourceId: id, summary: `Downloaded ${row.invoiceNumber}` }); return { buffer: Buffer.from(pdf), filename: `${row.invoiceNumber}.pdf` };
};

const CSV_EXPORT_BATCH_SIZE = 500;
const CSV_HEADERS = ["Invoice ID", "Invoice number", "Tenant", "Billing period", "Amount", "Currency", "Status", "Due date", "Created date"];

export const sanitizeCsvCell = (value: unknown) => {
  let text = String(value ?? "").replace(/\r?\n/g, " ");
  if (/^[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
};

const csvLine = (values: unknown[]) => `${values.map(sanitizeCsvCell).join(",")}\r\n`;

export const exportPlatformInvoices = async (input: unknown, user: AuthUser) => {
  assertAdmin(user);
  const query = invoiceExportQuerySchema.parse(input);
  await refreshOverdueInvoices();
  const where = invoiceWhere(query as any);
  const primaryOrder: Prisma.PlatformInvoiceOrderByWithRelationInput = query.sortBy === "tenantName"
    ? { organization: { name: query.sortOrder } }
    : { [query.sortBy]: query.sortOrder };
  const orderBy: Prisma.PlatformInvoiceOrderByWithRelationInput[] = [primaryOrder, { id: query.sortOrder }];
  const select = {
    id: true, invoiceNumber: true, billingPeriod: true, amount: true, currency: true,
    status: true, dueDate: true, createdAt: true, organization: { select: { name: true } }
  } satisfies Prisma.PlatformInvoiceSelect;

  // Fetch the first batch before response headers are committed so initial
  // database failures still use the standard JSON error response.
  const firstBatch = await prisma.platformInvoice.findMany({ where, select, orderBy, take: CSV_EXPORT_BATCH_SIZE });
  const chunks = async function* () {
    let rows = firstBatch;
    let recordCount = 0;
    yield `\uFEFF${csvLine(CSV_HEADERS)}`;
    while (rows.length) {
      yield rows.map((row) => csvLine([
        row.id, row.invoiceNumber, row.organization.name, row.billingPeriod,
        Number(row.amount).toFixed(2), row.currency, row.status,
        row.dueDate.toISOString(), row.createdAt.toISOString()
      ])).join("");
      recordCount += rows.length;
      if (rows.length < CSV_EXPORT_BATCH_SIZE) break;
      rows = await prisma.platformInvoice.findMany({
        where, select, orderBy, take: CSV_EXPORT_BATCH_SIZE,
        cursor: { id: rows[rows.length - 1].id }, skip: 1
      });
    }
    await createAuditLog({
      organizationId: user.organizationId, actorUserId: user.id,
      action: "PLATFORM_INVOICES_EXPORTED", resource: "PLATFORM_INVOICE",
      summary: `Exported ${recordCount} platform invoice records`, metadata: { recordCount, streaming: true }
    });
  };
  return { chunks: chunks(), filename: `platform-invoices-${new Date().toISOString().slice(0, 10)}.csv` };
};

export const getBillingOverview = async (input: unknown, user: AuthUser) => {
  const query = invoiceListQuerySchema.parse(input);
  const dateFilters = { year: query.year, month: query.month, startDate: query.startDate, endDate: query.endDate };
  const [analytics, revenueByPlan, invoices] = await Promise.all([getBillingAnalytics(dateFilters, user), getRevenueByPlan(dateFilters, user), listPlatformInvoices(query, user)]);
  return { analytics, revenueByPlan, invoices };
};


}

namespace PlatformUsersService {
const RESET_COOLDOWN_MS = 5 * 60 * 1000;
const IMPERSONATION_TTL_MS = 15 * 60 * 1000;
const assertPlatformAdmin = (user: AuthUser) => { if (!user.isPlatformAdmin) throw forbidden("Platform Admin access is required"); };
const includedOrganizationWhere: Prisma.OrganizationWhereInput = { status: { not: "ARCHIVED" }, deletionRequests: { none: { status: "COMPLETED" } }, users: { none: { isPlatformAdmin: true } } };

const searchWhere = (search?: string): Prisma.UserWhereInput => {
  if (!search) return {};
  const tokens = search.split(/\s+/).filter(Boolean).slice(0, 5);
  return { AND: tokens.map((token) => ({ OR: [{ firstName: { contains: token } }, { lastName: { contains: token } }, { email: { contains: token } }] })) };
};

const commonWhere = (query: PlatformUsersQuery, includeStatus = true): Prisma.UserWhereInput => {
  const now = new Date();
  const loginEligible: Prisma.UserWhereInput = { isActive: true, organization: { is: { ...includedOrganizationWhere, status: "ACTIVE" } }, OR: [{ lockedUntil: null }, { lockedUntil: { lte: now } }] };
  return { AND: [
    { organization: { is: includedOrganizationWhere } },
    ...(query.tenantId ? [{ organizationId: query.tenantId }] : []),
    ...(query.roleId ? [{ roleId: query.roleId }] : []),
    searchWhere(query.search),
    ...(includeStatus && query.status === "ACTIVE" ? [loginEligible] : []),
    ...(includeStatus && query.status === "INACTIVE" ? [{ NOT: loginEligible }] : [])
  ] };
};

const validateReferences = async (query: PlatformUsersQuery) => {
  const [tenant, role] = await Promise.all([
    query.tenantId ? prisma.organization.findFirst({ where: { id: query.tenantId, ...includedOrganizationWhere }, select: { id: true } }) : null,
    query.roleId ? prisma.role.findUnique({ where: { id: query.roleId }, select: { id: true, organizationId: true } }) : null
  ]);
  if (query.tenantId && !tenant) throw notFound("Tenant not found");
  if (query.roleId && !role) throw notFound("Role not found");
  if (query.tenantId && role && role.organizationId !== query.tenantId) throw badRequest("Role does not belong to the selected tenant", { errorCode: "INVALID_ROLE_FILTER" });
};

const orderByFor = (query: PlatformUsersQuery): Prisma.UserOrderByWithRelationInput[] => {
  const last = { id: query.sortOrder } as Prisma.UserOrderByWithRelationInput;
  switch (query.sortBy) {
    case "name": return [{ firstName: query.sortOrder }, { lastName: query.sortOrder }, last];
    case "tenantName": return [{ organization: { name: query.sortOrder } }, last];
    case "role": return [{ role: { name: query.sortOrder } }, last];
    case "lastActive": return [{ lastLoginAt: { sort: query.sortOrder, nulls: "last" } }, last];
    case "status": return [{ isActive: query.sortOrder }, last];
    default: return [{ [query.sortBy]: query.sortOrder }, last];
  }
};

export const platformUserRowStatus = (user: { isActive: boolean; lockedUntil: Date | null; organization: { status: string } }, now = new Date()) => {
  if (!user.isActive) return "INACTIVE";
  if (user.organization.status === "SUSPENDED") return "SUSPENDED";
  if (user.lockedUntil && user.lockedUntil > now) return "LOCKED";
  return "ACTIVE";
};

export const effectivePlatformUserModules = (permissionKeys: string[], activeTenantModules: Set<string>) => {
  const permitted = new Set(permissionKeys.flatMap((key) => {
    const module = key.split(":", 1)[0].toLowerCase();
    return ["hris", "payroll", "accounting"].includes(module) ? [module] : [];
  }));
  return [...permitted].filter((module) => activeTenantModules.has(module)).map((module) => module.toUpperCase());
};

const loadActiveTenantModules = async (organizationIds: string[]) => {
  const snapshots = await buildSubscriptionSnapshots(organizationIds);
  const result = new Map<string, Set<string>>();
  for (const id of organizationIds) {
    const subscription = snapshots.get(id);
    result.set(id, new Set(subscription?.status === "ACTIVE" ? subscription.activeModules : []));
  }
  return result;
};

export const getPlatformUserAnalytics = async (user: AuthUser) => {
  assertPlatformAdmin(user); const now = new Date();
  const where: Prisma.UserWhereInput = { organization: { is: includedOrganizationWhere } };
  const [totalUsers, activeUsers] = await prisma.$transaction([
    prisma.user.count({ where }),
    prisma.user.count({ where: { ...where, isActive: true, organization: { is: { ...includedOrganizationWhere, status: "ACTIVE" } }, OR: [{ lockedUntil: null }, { lockedUntil: { lte: now } }] } })
  ]);
  return { totalUsers, activeUsers, inactiveUsers: totalUsers - activeUsers };
};

export const getPlatformUsers = async (input: unknown, user: AuthUser) => {
  assertPlatformAdmin(user); const query = platformUsersQuerySchema.parse(input); await validateReferences(query);
  const where = commonWhere(query); const [analytics, total, users] = await Promise.all([
    getPlatformUserAnalytics(user), prisma.user.count({ where }),
    prisma.user.findMany({ where, orderBy: orderByFor(query), skip: (query.page - 1) * query.limit, take: query.limit, select: {
      id: true, firstName: true, lastName: true, email: true, isActive: true, lockedUntil: true,
      lastLoginAt: true, createdAt: true, updatedAt: true, isPlatformAdmin: true,
      organizationId: true, organization: { select: { name: true, status: true } },
      role: { select: { id: true, name: true, permissions: { select: { permission: { select: { key: true } } } } } }
    } })
  ]);
  const modules = await loadActiveTenantModules([...new Set(users.map((entry) => entry.organizationId))]);
  const totalPages = Math.ceil(total / query.limit);
  return {
    analytics,
    users: users.map((entry) => ({
      id: entry.id, name: `${entry.firstName} ${entry.lastName}`.trim(), email: entry.email,
      tenant: { id: entry.organizationId, name: entry.organization.name }, role: { id: entry.role.id, name: entry.role.name },
      moduleAccess: effectivePlatformUserModules(entry.role.permissions.map((item) => item.permission.key), modules.get(entry.organizationId) ?? new Set()),
      lastActive: entry.lastLoginAt, status: platformUserRowStatus(entry), createdAt: entry.createdAt, updatedAt: entry.updatedAt,
      actions: { canDeactivate: entry.isActive && entry.id !== user.id, canResetPassword: entry.isActive && !entry.isPlatformAdmin, canImpersonate: entry.isActive && !entry.isPlatformAdmin && entry.organization.status === "ACTIVE" }
    })),
    pagination: { currentPage: query.page, pageSize: query.limit, totalPages, totalRecords: total, hasNextPage: query.page < totalPages, hasPreviousPage: query.page > 1 },
    appliedFilters: { search: query.search ?? null, tenantId: query.tenantId ?? null, roleId: query.roleId ?? null, status: query.status, sortBy: query.sortBy, sortOrder: query.sortOrder }
  };
};

export const getPlatformUserFilterOptions = async (user: AuthUser) => {
  assertPlatformAdmin(user);
  const [tenants, roles] = await Promise.all([
    prisma.organization.findMany({ where: includedOrganizationWhere, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    prisma.role.findMany({ where: { organization: { is: includedOrganizationWhere } }, select: { id: true, name: true, organizationId: true }, orderBy: [{ name: "asc" }, { organizationId: "asc" }] })
  ]);
  return { tenants, roles, statuses: ["ACTIVE", "INACTIVE"] };
};

export const deactivatePlatformUser = async (targetUserId: string, user: AuthUser) => {
  assertPlatformAdmin(user); if (targetUserId === user.id) throw conflict("You cannot deactivate your own account", { errorCode: "SELF_DEACTIVATION_BLOCKED" });
  const now = new Date();
  const result = await prisma.$transaction(async (tx) => {
    const target = await tx.user.findUnique({ where: { id: targetUserId }, select: { id: true, organizationId: true, email: true, isActive: true, isPlatformAdmin: true } });
    if (!target) throw notFound("User not found"); if (!target.isActive) throw conflict("User is already inactive", { errorCode: "USER_ALREADY_INACTIVE" });
    if (target.isPlatformAdmin && await tx.user.count({ where: { isPlatformAdmin: true, isActive: true } }) <= 1) throw conflict("The last active Platform Administrator cannot be deactivated", { errorCode: "LAST_PLATFORM_ADMIN" });
    const updated = await tx.user.updateMany({ where: { id: target.id, isActive: true }, data: { isActive: false } });
    if (updated.count !== 1) throw conflict("User state changed; reload and retry", { errorCode: "USER_STATE_CONFLICT" });
    const revoked = await tx.userSession.updateMany({ where: { userId: target.id, revokedAt: null }, data: { revokedAt: now, revokeReason: "PLATFORM_ADMIN_DEACTIVATION", isCurrent: false } });
    await tx.platformImpersonationSession.updateMany({ where: { tenantAdminUserId: target.id, status: "ACTIVE", endedAt: null }, data: { status: "REVOKED", endedAt: now } });
    return { ...target, revokedSessions: revoked.count };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  await createAuditLog({ organizationId: result.organizationId, actorUserId: user.id, action: "PLATFORM_USER_DEACTIVATED", resource: "USER", resourceId: result.id, summary: "Deactivated platform user", metadata: { revokedSessions: result.revokedSessions, result: "SUCCESS" } });
  return { id: result.id, status: "INACTIVE", deactivatedAt: now, revokedSessions: result.revokedSessions };
};

export const resetPlatformUserPassword = async (targetUserId: string, user: AuthUser) => {
  assertPlatformAdmin(user); const now = new Date(); const cutoff = new Date(now.getTime() - RESET_COOLDOWN_MS);
  const target = await prisma.user.findUnique({ where: { id: targetUserId }, include: { organization: { select: { id: true, name: true, slug: true, status: true } } } });
  if (!target) throw notFound("User not found"); if (!target.isActive || target.organization.status !== "ACTIVE") throw conflict("User is not eligible for password reset", { errorCode: "USER_NOT_ELIGIBLE" });
  if (target.isPlatformAdmin) throw conflict("Protected Platform Administrator accounts must use the normal account-recovery flow", { errorCode: "PROTECTED_ACCOUNT" });
  const claimed = await prisma.user.updateMany({ where: { id: target.id, isActive: true, OR: [{ passwordResetRequestedAt: null }, { passwordResetRequestedAt: { lte: cutoff } }] }, data: { passwordResetRequestedAt: now } });
  if (claimed.count !== 1) throw conflict("Password reset cooldown is still active", { errorCode: "PASSWORD_RESET_COOLDOWN", retryAfterSeconds: Math.ceil(RESET_COOLDOWN_MS / 1000) });
  let reset: Awaited<ReturnType<typeof forgotPassword>>;
  try { reset = await forgotPassword({ email: target.email, organizationSlug: target.organization.slug }); }
  catch {
    await prisma.user.updateMany({ where: { id: target.id, passwordResetRequestedAt: now }, data: { passwordResetRequestedAt: null } });
    await prisma.passwordResetOtp.updateMany({ where: { userId: target.id, consumedAt: null }, data: { consumedAt: new Date() } });
    await createAuditLog({ organizationId: target.organizationId, actorUserId: user.id, action: "PLATFORM_PASSWORD_RESET_FAILED", resource: "USER", resourceId: target.id, summary: "Password reset delivery failed", metadata: { result: "FAILED", reason: "DELIVERY_FAILURE" } });
    throw serviceUnavailable("Password reset delivery failed");
  }
  const revoked = await prisma.userSession.updateMany({ where: { userId: target.id, revokedAt: null }, data: { revokedAt: now, revokeReason: "PLATFORM_ADMIN_PASSWORD_RESET", isCurrent: false } });
  await createAuditLog({ organizationId: target.organizationId, actorUserId: user.id, action: "PLATFORM_PASSWORD_RESET_INITIATED", resource: "USER", resourceId: target.id, summary: "Initiated secure password reset", metadata: { expiresInSeconds: reset.expiresInSeconds, revokedSessions: revoked.count, result: "SUCCESS" } });
  return { userId: target.id, message: "Password reset instructions sent", expiresInSeconds: reset.expiresInSeconds, revokedSessions: revoked.count };
};

export const impersonatePlatformUser = async (targetUserId: string, reason: string, user: AuthUser, meta?: { ipAddress?: string | null; userAgent?: string | null }) => {
  assertPlatformAdmin(user); if (user.impersonation) throw conflict("Nested impersonation is not permitted", { errorCode: "NESTED_IMPERSONATION" });
  const target = await prisma.user.findUnique({ where: { id: targetUserId }, include: { organization: { select: { id: true, name: true, status: true } } } });
  if (!target) throw notFound("User not found");
  const fail = async (message: string, code: string) => { await createAuditLog({ organizationId: target.organizationId, actorUserId: user.id, action: "PLATFORM_IMPERSONATION_FAILED", resource: "USER", resourceId: target.id, summary: "User impersonation rejected", metadata: { result: "FAILED", reason: code } }); throw conflict(message, { errorCode: code }); };
  if (target.isPlatformAdmin) return fail("Platform Administrator accounts cannot be impersonated", "PROTECTED_ACCOUNT");
  if (!target.isActive || target.organization.status !== "ACTIVE") return fail("User is not eligible for impersonation", "USER_NOT_ELIGIBLE");
  const expiresAt = new Date(Date.now() + IMPERSONATION_TTL_MS);
  let session;
  try {
    session = await prisma.$transaction(async (tx) => {
      await tx.platformImpersonationSession.updateMany({ where: { platformAdminUserId: user.id, status: "ACTIVE", expiresAt: { lte: new Date() } }, data: { status: "EXPIRED", endedAt: new Date() } });
      if (await tx.platformImpersonationSession.count({ where: { platformAdminUserId: user.id, status: "ACTIVE", endedAt: null, expiresAt: { gt: new Date() } } })) throw conflict("An impersonation session is already active", { errorCode: "IMPERSONATION_ALREADY_ACTIVE" });
      return tx.platformImpersonationSession.create({ data: { organizationId: target.organizationId, platformAdminUserId: user.id, tenantAdminUserId: target.id, expiresAt, ipAddress: meta?.ipAddress, userAgent: meta?.userAgent } });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  } catch (error) {
    await createAuditLog({ organizationId: target.organizationId, actorUserId: user.id, action: "PLATFORM_IMPERSONATION_FAILED", resource: "USER", resourceId: target.id, summary: "User impersonation failed", metadata: { result: "FAILED", reason: "ACTIVE_SESSION_OR_CONCURRENCY_CONFLICT" } });
    throw error;
  }
  const accessToken = jwt.sign({ organizationId: target.organizationId, purpose: "platform-impersonation", impersonationSessionId: session.id, platformAdminUserId: user.id }, env.JWT_ACCESS_SECRET, { subject: target.id, expiresIn: "15m" });
  await createAuditLog({ organizationId: target.organizationId, actorUserId: user.id, action: "PLATFORM_IMPERSONATION_STARTED", resource: "IMPERSONATION_SESSION", resourceId: session.id, summary: "Started user impersonation", metadata: { targetUserId: target.id, reason, expiresAt: expiresAt.toISOString(), ipAddress: meta?.ipAddress ?? null, userAgent: meta?.userAgent ?? null, result: "SUCCESS" } });
  return { impersonationSessionId: session.id, tenant: { id: target.organizationId, name: target.organization.name }, impersonatedUser: { id: target.id, name: `${target.firstName} ${target.lastName}`.trim(), email: target.email }, accessToken, tokenType: "Bearer", expiresAt, impersonated: true, banner: `You are impersonating ${target.firstName} ${target.lastName} from ${target.organization.name}.` };
};


}

namespace PlatformModulesService {
type ModuleRow = { id: string; name: string; email: string | null; status: string; createdAt: Date; planKey: string | null; hrisEnabled: number; payrollEnabled: number; accountingEnabled: number; hrisUsers: bigint; payrollUsers: bigint; accountingUsers: bigint; lastUpdatedAt: Date | null; updatedByUserId: string | null; version: number; totalRecords: bigint };
const assertAdmin = (user: AuthUser) => { if (!user.isPlatformAdmin) throw forbidden("Platform Admin access is required"); };
const activeJson = (alias: string) => Prisma.sql`UPPER(JSON_UNQUOTE(${Prisma.raw(alias)}.value)) = 'ACTIVE'`;
const eligibleTenantSql = Prisma.sql`o.status <> 'ARCHIVED' AND NOT EXISTS (SELECT 1 FROM User pa WHERE pa.organizationId = o.id AND pa.isPlatformAdmin = true) AND NOT EXISTS (SELECT 1 FROM OrganizationDeletionRequest odr WHERE odr.organizationId = o.id AND odr.status = 'PENDING_PLATFORM_APPROVAL')`;

const queryClauses = (query: PlatformModulesQuery) => {
  const clauses: Prisma.Sql[] = [eligibleTenantSql];
  if (query.search) clauses.push(Prisma.sql`(o.id LIKE ${`%${query.search}%`} OR o.name LIKE ${`%${query.search}%`} OR o.email LIKE ${`%${query.search}%`})`);
  if (query.tenantId) clauses.push(Prisma.sql`o.id = ${query.tenantId}`);
  if (query.tenantStatus !== "ALL") clauses.push(Prisma.sql`o.status = ${query.tenantStatus}`);
  if (query.plan) clauses.push(Prisma.sql`JSON_UNQUOTE(JSON_EXTRACT(sub.value, '$.planKey')) = ${query.plan}`);
  if (query.module && query.enabled !== undefined) {
    const alias = ({ hris: "mh", payroll: "mp", accounting: "ma" } as const)[query.module];
    clauses.push(query.enabled ? activeJson(alias) : Prisma.sql`(${Prisma.raw(alias)}.id IS NULL OR NOT (${activeJson(alias)}))`);
  } else if (query.module) {
    const alias = ({ hris: "mh", payroll: "mp", accounting: "ma" } as const)[query.module];
    clauses.push(activeJson(alias));
  }
  return clauses;
};

const baseJoins = Prisma.sql`
  LEFT JOIN SystemConfig sub ON sub.organizationId = o.id AND sub.key = 'billing.subscription'
  LEFT JOIN SystemConfig mh ON mh.organizationId = o.id AND mh.key = 'module.hris.status'
  LEFT JOIN SystemConfig mp ON mp.organizationId = o.id AND mp.key = 'module.payroll.status'
  LEFT JOIN SystemConfig ma ON ma.organizationId = o.id AND ma.key = 'module.accounting.status'
  LEFT JOIN User u ON u.organizationId = o.id AND u.isActive = true AND (u.lockedUntil IS NULL OR u.lockedUntil <= CURRENT_TIMESTAMP(3))
  LEFT JOIN RolePermission rp ON rp.roleId = u.roleId
  LEFT JOIN Permission p ON p.id = rp.permissionId`;

const orderSql = (query: PlatformModulesQuery) => ({
  tenantName: Prisma.raw("o.name"), tenantStatus: Prisma.raw("o.status"), usage: Prisma.raw("usage"),
  hrisUsers: Prisma.raw("hrisUsers"), payrollUsers: Prisma.raw("payrollUsers"), accountingUsers: Prisma.raw("accountingUsers"),
  lastUpdatedAt: Prisma.raw("lastUpdatedAt"), createdAt: Prisma.raw("o.createdAt")
}[query.sortBy]);

export const moduleUsageTotal = (counts: { hrisUsers: number; payrollUsers: number; accountingUsers: number }) => counts.hrisUsers + counts.payrollUsers + counts.accountingUsers;

const loadRows = async (query: PlatformModulesQuery) => {
  const clauses = queryClauses(query); const offset = (query.page - 1) * query.limit; const direction = query.sortOrder === "asc" ? Prisma.raw("ASC") : Prisma.raw("DESC");
  return prisma.$queryRaw<ModuleRow[]>(Prisma.sql`
    SELECT o.id, o.name, o.email, o.status, o.createdAt,
      JSON_UNQUOTE(JSON_EXTRACT(sub.value, '$.planKey')) planKey,
      ${activeJson("mh")} hrisEnabled, ${activeJson("mp")} payrollEnabled, ${activeJson("ma")} accountingEnabled,
      COUNT(DISTINCT CASE WHEN o.status = 'ACTIVE' AND ${activeJson("mh")} AND UPPER(JSON_UNQUOTE(JSON_EXTRACT(sub.value, '$.status'))) = 'ACTIVE' AND p.key LIKE 'hris:%' THEN u.id END) hrisUsers,
      COUNT(DISTINCT CASE WHEN o.status = 'ACTIVE' AND ${activeJson("mp")} AND UPPER(JSON_UNQUOTE(JSON_EXTRACT(sub.value, '$.status'))) = 'ACTIVE' AND p.key LIKE 'payroll:%' THEN u.id END) payrollUsers,
      COUNT(DISTINCT CASE WHEN o.status = 'ACTIVE' AND ${activeJson("ma")} AND UPPER(JSON_UNQUOTE(JSON_EXTRACT(sub.value, '$.status'))) = 'ACTIVE' AND p.key LIKE 'accounting:%' THEN u.id END) accountingUsers,
      GREATEST(COALESCE(mh.updatedAt, '1970-01-01'), COALESCE(mp.updatedAt, '1970-01-01'), COALESCE(ma.updatedAt, '1970-01-01')) lastUpdatedAt,
      COALESCE(mh.updatedByUserId, mp.updatedByUserId, ma.updatedByUserId) updatedByUserId,
      GREATEST(COALESCE(mh.rowVersion, 1), COALESCE(mp.rowVersion, 1), COALESCE(ma.rowVersion, 1)) version,
      (COUNT(DISTINCT CASE WHEN o.status = 'ACTIVE' AND UPPER(JSON_UNQUOTE(JSON_EXTRACT(sub.value, '$.status')))='ACTIVE' AND ${activeJson("mh")} AND p.key LIKE 'hris:%' THEN u.id END) + COUNT(DISTINCT CASE WHEN o.status = 'ACTIVE' AND UPPER(JSON_UNQUOTE(JSON_EXTRACT(sub.value, '$.status')))='ACTIVE' AND ${activeJson("mp")} AND p.key LIKE 'payroll:%' THEN u.id END) + COUNT(DISTINCT CASE WHEN o.status = 'ACTIVE' AND UPPER(JSON_UNQUOTE(JSON_EXTRACT(sub.value, '$.status')))='ACTIVE' AND ${activeJson("ma")} AND p.key LIKE 'accounting:%' THEN u.id END)) usage,
      COUNT(*) OVER() totalRecords
    FROM Organization o ${baseJoins}
    WHERE ${Prisma.join(clauses, " AND ")}
    GROUP BY o.id, o.name, o.email, o.status, o.createdAt, sub.value, mh.value, mp.value, ma.value, mh.updatedAt, mp.updatedAt, ma.updatedAt, mh.updatedByUserId, mp.updatedByUserId, ma.updatedByUserId, mh.rowVersion, mp.rowVersion, ma.rowVersion
    ORDER BY ${orderSql(query)} ${direction}, o.id ${direction}
    LIMIT ${query.limit} OFFSET ${offset}`);
};

const mapRow = (row: ModuleRow) => {
  const counts = { hris: Number(row.hrisUsers), payroll: Number(row.payrollUsers), accounting: Number(row.accountingUsers) };
  const enabled = { hris: Boolean(row.hrisEnabled), payroll: Boolean(row.payrollEnabled), accounting: Boolean(row.accountingEnabled) };
  return { id: row.id, name: row.name, email: row.email, status: row.status, plan: row.planKey, modules: billingModuleKeys.map((module) => ({ module: module.toUpperCase(), enabled: enabled[module], activeUserCount: enabled[module] ? counts[module] : 0 })), enabledModules: billingModuleKeys.filter((module) => enabled[module]).map((module) => module.toUpperCase()), disabledModules: billingModuleKeys.filter((module) => !enabled[module]).map((module) => module.toUpperCase()), usage: moduleUsageTotal({ hrisUsers: counts.hris, payrollUsers: counts.payroll, accountingUsers: counts.accounting }), uniqueActiveUsers: null, lastUpdatedAt: row.lastUpdatedAt, updatedByUserId: row.updatedByUserId, createdAt: row.createdAt, version: row.version };
};

export const getPlatformModuleAnalytics = async (user: AuthUser) => {
  assertAdmin(user);
  const rows = await prisma.$queryRaw<Array<{ module: string; tenantCount: bigint; activeUserCount: bigint }>>(Prisma.sql`
    SELECT module_data.module, COUNT(DISTINCT CASE WHEN module_data.enabled=1 THEN module_data.organizationId END) tenantCount, COUNT(DISTINCT module_data.userId) activeUserCount FROM (
      SELECT 'HRIS' module, o.id organizationId, IF(${activeJson("mc")} AND o.status='ACTIVE' AND UPPER(JSON_UNQUOTE(JSON_EXTRACT(sub.value, '$.status')))='ACTIVE', 1, 0) enabled,
        CASE WHEN ${activeJson("mc")} AND o.status='ACTIVE' AND UPPER(JSON_UNQUOTE(JSON_EXTRACT(sub.value, '$.status')))='ACTIVE' AND u.isActive=true AND (u.lockedUntil IS NULL OR u.lockedUntil <= CURRENT_TIMESTAMP(3)) AND p.key LIKE 'hris:%' THEN u.id END userId
      FROM Organization o LEFT JOIN SystemConfig sub ON sub.organizationId=o.id AND sub.key='billing.subscription' LEFT JOIN SystemConfig mc ON mc.organizationId=o.id AND mc.key='module.hris.status' LEFT JOIN User u ON u.organizationId=o.id LEFT JOIN RolePermission rp ON rp.roleId=u.roleId LEFT JOIN Permission p ON p.id=rp.permissionId WHERE ${eligibleTenantSql}
      UNION ALL SELECT 'PAYROLL', o.id, IF(${activeJson("mc")} AND o.status='ACTIVE' AND UPPER(JSON_UNQUOTE(JSON_EXTRACT(sub.value, '$.status')))='ACTIVE', 1, 0), CASE WHEN ${activeJson("mc")} AND o.status='ACTIVE' AND UPPER(JSON_UNQUOTE(JSON_EXTRACT(sub.value, '$.status')))='ACTIVE' AND u.isActive=true AND (u.lockedUntil IS NULL OR u.lockedUntil <= CURRENT_TIMESTAMP(3)) AND p.key LIKE 'payroll:%' THEN u.id END FROM Organization o LEFT JOIN SystemConfig sub ON sub.organizationId=o.id AND sub.key='billing.subscription' LEFT JOIN SystemConfig mc ON mc.organizationId=o.id AND mc.key='module.payroll.status' LEFT JOIN User u ON u.organizationId=o.id LEFT JOIN RolePermission rp ON rp.roleId=u.roleId LEFT JOIN Permission p ON p.id=rp.permissionId WHERE ${eligibleTenantSql}
      UNION ALL SELECT 'ACCOUNTING', o.id, IF(${activeJson("mc")} AND o.status='ACTIVE' AND UPPER(JSON_UNQUOTE(JSON_EXTRACT(sub.value, '$.status')))='ACTIVE', 1, 0), CASE WHEN ${activeJson("mc")} AND o.status='ACTIVE' AND UPPER(JSON_UNQUOTE(JSON_EXTRACT(sub.value, '$.status')))='ACTIVE' AND u.isActive=true AND (u.lockedUntil IS NULL OR u.lockedUntil <= CURRENT_TIMESTAMP(3)) AND p.key LIKE 'accounting:%' THEN u.id END FROM Organization o LEFT JOIN SystemConfig sub ON sub.organizationId=o.id AND sub.key='billing.subscription' LEFT JOIN SystemConfig mc ON mc.organizationId=o.id AND mc.key='module.accounting.status' LEFT JOIN User u ON u.organizationId=o.id LEFT JOIN RolePermission rp ON rp.roleId=u.roleId LEFT JOIN Permission p ON p.id=rp.permissionId WHERE ${eligibleTenantSql}
    ) module_data GROUP BY module_data.module`);
  const byModule = new Map(rows.map((row) => [row.module, row]));
  return { modules: ["HRIS", "PAYROLL", "ACCOUNTING"].map((module) => ({ module, tenantCount: Number(byModule.get(module)?.tenantCount ?? 0), activeUserCount: Number(byModule.get(module)?.activeUserCount ?? 0) })) };
};

export const getPlatformModuleTenants = async (input: unknown, user: AuthUser) => {
  assertAdmin(user); const query = platformModulesQuerySchema.parse(input); const rows = await loadRows(query); const total = Number(rows[0]?.totalRecords ?? 0); const totalPages = Math.ceil(total / query.limit);
  return { tenants: rows.map(mapRow), pagination: { currentPage: query.page, pageSize: query.limit, totalPages, totalRecords: total, hasNextPage: query.page < totalPages, hasPreviousPage: query.page > 1 }, appliedFilters: query };
};

export const getPlatformModuleTenant = async (tenantId: string, user: AuthUser) => {
  const result = await getPlatformModuleTenants({ tenantId, page: 1, limit: 1 }, user); if (!result.tenants[0]) throw notFound("Tenant not found"); return result.tenants[0];
};

const assertDisableSafe = async (tx: Prisma.TransactionClient, organizationId: string, module: BillingModuleKey) => {
  let count = 0; let reason = "";
  if (module === "payroll") { count = await tx.payrollRun.count({ where: { organizationId, status: "PROCESSING" } }); reason = "processing payroll runs"; }
  if (module === "accounting") { const [payments, disbursements, invoices] = await Promise.all([tx.paymentRequest.count({ where: { organizationId, status: { in: ["PENDING", "APPROVED"] } } }), tx.walletDisbursement.count({ where: { organizationId, status: { in: ["PENDING", "PROCESSING"] } } }), tx.invoice.count({ where: { organizationId, status: { in: ["DRAFT", "SENT"] } } })]); count = payments + disbursements + invoices; reason = "pending payments, disbursements, or draft/sent invoices"; }
  if (module === "hris") { const [leave, appraisal] = await Promise.all([tx.leaveRequest.count({ where: { organizationId, status: "PENDING" } }), tx.appraisalCycle.count({ where: { organizationId, status: "OPEN" } })]); count = leave + appraisal; reason = "pending leave requests or open appraisal cycles"; }
  if (count) throw conflict(`Cannot disable ${moduleLabels[module]} while ${reason} exist`, { errorCode: "MODULE_DEPENDENCY_ACTIVE", module, dependencyCount: count });
};

export const updatePlatformTenantModules = async (tenantId: string, input: unknown, user: AuthUser) => {
  assertAdmin(user); const payload = platformModuleBulkUpdateSchema.parse(input); const now = new Date();
  const tenant = await prisma.organization.findFirst({ where: { id: tenantId, status: "ACTIVE", deletionRequests: { none: { status: "PENDING_PLATFORM_APPROVAL" } }, users: { none: { isPlatformAdmin: true } } }, select: { id: true } }); if (!tenant) throw notFound("Active tenant not found");
  const subscriptionRow = await prisma.systemConfig.findUnique({ where: { organizationId_key: { organizationId: tenantId, key: "billing.subscription" } }, select: { value: true } }); const subscription = subscriptionRow?.value && typeof subscriptionRow.value === "object" && !Array.isArray(subscriptionRow.value) ? subscriptionRow.value as Record<string, unknown> : {};
  if (String(subscription.status ?? "").toUpperCase() !== "ACTIVE") throw conflict("Tenant subscription is not active", { errorCode: "SUBSCRIPTION_INACTIVE" });
  const plan = getBillingPlanDefinition(String(subscription.planKey ?? "") as BillingPlanKey); if (!plan) throw conflict("Tenant subscription plan is invalid", { errorCode: "INVALID_SUBSCRIPTION_PLAN" });
  const previous = await prisma.systemConfig.findMany({ where: { organizationId: tenantId, key: { in: billingModuleKeys.map((module) => `module.${module}.status`) } }, select: { key: true, value: true, rowVersion: true } }); const prior = new Map(previous.map((row) => [row.key.split(".")[1] as BillingModuleKey, { enabled: row.value === "ACTIVE", version: row.rowVersion }]));
  if (payload.expectedVersion !== undefined && Math.max(1, ...previous.map((row) => row.rowVersion)) !== payload.expectedVersion) throw conflict("Module configuration was changed by another administrator", { errorCode: "MODULE_VERSION_CONFLICT" });
  for (const item of payload.modules) if (!item.enabled && plan.includedModules.includes(item.module)) throw conflict(`${moduleLabels[item.module]} is included in the current plan; change the plan before disabling it`, { errorCode: "MODULE_INCLUDED_IN_PLAN", module: item.module });
  const changed = payload.modules.filter((item) => (prior.get(item.module)?.enabled ?? false) !== item.enabled);
  if (!changed.length) return { changed: false, previous: payload.modules.map((item) => ({ ...item, enabled: prior.get(item.module)?.enabled ?? false })), current: payload.modules, effectiveAt: now };
  try {
    await prisma.$transaction(async (tx) => {
      for (const item of changed) {
        if (!item.enabled) await assertDisableSafe(tx, tenantId, item.module);
        const status = item.enabled ? "ACTIVE" : "INACTIVE"; const key = `module.${item.module}.status`;
        await tx.systemConfig.upsert({ where: { organizationId_key: { organizationId: tenantId, key } }, create: { organizationId: tenantId, key, value: status, updatedByUserId: user.id, updateReason: payload.reason, updateSource: "PLATFORM_ADMIN" }, update: { value: status, updatedByUserId: user.id, updateReason: payload.reason, updateSource: "PLATFORM_ADMIN", rowVersion: { increment: 1 } } });
        await tx.systemConfig.upsert({ where: { organizationId_key: { organizationId: tenantId, key: `module.${item.module}.enabled` } }, create: { organizationId: tenantId, key: `module.${item.module}.enabled`, value: item.enabled, updatedByUserId: user.id, updateReason: payload.reason, updateSource: "PLATFORM_ADMIN" }, update: { value: item.enabled, updatedByUserId: user.id, updateReason: payload.reason, updateSource: "PLATFORM_ADMIN", rowVersion: { increment: 1 } } });
        await tx.systemConfig.upsert({ where: { organizationId_key: { organizationId: tenantId, key: `billing.addons.${item.module}.subscription` } }, create: { organizationId: tenantId, key: `billing.addons.${item.module}.subscription`, value: { status, activatedAt: item.enabled ? now.toISOString() : null, disabledAt: item.enabled ? null : now.toISOString(), source: "PLATFORM_ADMIN" } }, update: { value: { status, activatedAt: item.enabled ? now.toISOString() : null, disabledAt: item.enabled ? null : now.toISOString(), source: "PLATFORM_ADMIN" }, updatedByUserId: user.id, updateReason: payload.reason, updateSource: "PLATFORM_ADMIN", rowVersion: { increment: 1 } } });
      }
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  } catch (error) {
    await createAuditLog({ organizationId: tenantId, actorUserId: user.id, action: "PLATFORM_MODULE_UPDATE_FAILED", resource: "MODULE", summary: "Platform module update failed", metadata: { modules: changed.map((item) => item.module), reason: payload.reason, result: "FAILED" } });
    throw error;
  }
  for (const item of changed) await createAuditLog({ organizationId: tenantId, actorUserId: user.id, action: item.enabled ? "PLATFORM_MODULE_ENABLED" : "PLATFORM_MODULE_DISABLED", resource: "MODULE", resourceId: item.module, summary: `${item.enabled ? "Enabled" : "Disabled"} ${moduleLabels[item.module]}`, metadata: { previousState: prior.get(item.module)?.enabled ?? false, newState: item.enabled, reason: payload.reason, result: "SUCCESS" } });
  await snapshotTenantModuleUsage(now, tenantId);
  return { changed: true, previous: changed.map((item) => ({ module: item.module, enabled: prior.get(item.module)?.enabled ?? false })), current: changed, effectiveAt: now, configuration: await getPlatformModuleTenant(tenantId, user) };
};

export const setPlatformTenantModule = (tenantId: string, module: BillingModuleKey, enabled: boolean, reason: string, user: AuthUser) => updatePlatformTenantModules(tenantId, { modules: [{ module, enabled }], reason }, user);
export const getPlatformModulesOverview = async (input: unknown, user: AuthUser) => { const [analytics, tenants] = await Promise.all([getPlatformModuleAnalytics(user), getPlatformModuleTenants(input, user)]); return { analytics, ...tenants }; };


}

namespace PlatformAnalyticsService {
const DAY_MS = 86_400_000;
const assertAdmin = (user: AuthUser) => { if (!user.isPlatformAdmin) throw forbidden("Platform Admin access is required"); };
const eligibleTenantSql = Prisma.sql`o.status <> 'ARCHIVED' AND NOT EXISTS (SELECT 1 FROM User pa WHERE pa.organizationId=o.id AND pa.isPlatformAdmin=true) AND NOT EXISTS (SELECT 1 FROM OrganizationDeletionRequest odr WHERE odr.organizationId=o.id AND odr.status='PENDING_PLATFORM_APPROVAL')`;
export const monthKeys = (from: Date, to: Date) => { const rows: string[] = []; for (const cursor = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), 1)); cursor <= to; cursor.setUTCMonth(cursor.getUTCMonth() + 1)) rows.push(cursor.toISOString().slice(0, 7)); return rows; };
export const calculateDaysInactive = (lastActive: Date | null, createdAt: Date, asOf: Date) => Math.max(0, Math.floor((asOf.getTime() - (lastActive ?? createdAt).getTime()) / DAY_MS));
export const monthlyRecurringEquivalent = (amount: number, billingCycle: unknown) => String(billingCycle ?? "").toUpperCase() === "YEARLY" ? amount / 12 : amount;
export const activityScore = (sessions: number, pagesVisited: number | null) => sessions + (pagesVisited ?? 0);
const endExclusive = (to: Date) => new Date(to.getTime() + DAY_MS);

export const getPlatformAnalytics = async (input: unknown, user: AuthUser) => {
  assertAdmin(user); const range = platformAnalyticsQuerySchema.parse(input); const until = endExclusive(range.to); const months = monthKeys(range.from, range.to); const now = new Date(); const riskAsOf = range.to < now ? until : now; const riskCutoff = new Date(riskAsOf.getTime() - 3 * DAY_MS);
  const [tenantRows, revenueRows, churnRows, topRows, riskRows, moduleRows] = await Promise.all([
    prisma.$queryRaw<Array<{ month: string; count: bigint }>>(Prisma.sql`SELECT DATE_FORMAT(o.createdAt, '%Y-%m') month, COUNT(*) count FROM Organization o WHERE ${eligibleTenantSql} AND o.createdAt >= ${range.from} AND o.createdAt < ${until} GROUP BY month ORDER BY month`),
    prisma.$queryRaw<Array<{ month: string; mrr: Prisma.Decimal }>>(Prisma.sql`SELECT DATE_FORMAT(b.billedAt, '%Y-%m') month, SUM(CASE WHEN UPPER(JSON_UNQUOTE(JSON_EXTRACT(b.metadata, '$.billingCycle')))='YEARLY' THEN b.amount/12 ELSE b.amount END) mrr FROM BillingHistory b JOIN Organization o ON o.id=b.organizationId WHERE ${eligibleTenantSql} AND b.billedAt >= ${range.from} AND b.billedAt < ${until} AND UPPER(b.status) IN ('PAID','COMPLETED','SUCCESS') GROUP BY month ORDER BY month`),
    prisma.$queryRaw<Array<{ plan: string; churnedTenants: bigint }>>(Prisma.sql`SELECT JSON_UNQUOTE(JSON_EXTRACT(sc.value, '$.planKey')) plan, COUNT(DISTINCT sc.organizationId) churnedTenants FROM SystemConfig sc JOIN Organization o ON o.id=sc.organizationId WHERE ${eligibleTenantSql} AND sc.key='billing.subscription' AND UPPER(JSON_UNQUOTE(JSON_EXTRACT(sc.value, '$.status'))) IN ('CANCELLED','EXPIRED') AND STR_TO_DATE(LEFT(COALESCE(JSON_UNQUOTE(JSON_EXTRACT(sc.value, '$.cancelledAt')), JSON_UNQUOTE(JSON_EXTRACT(sc.value, '$.expiredAt')), JSON_UNQUOTE(JSON_EXTRACT(sc.value, '$.renewalDate'))), 10), '%Y-%m-%d') >= ${range.from} AND STR_TO_DATE(LEFT(COALESCE(JSON_UNQUOTE(JSON_EXTRACT(sc.value, '$.cancelledAt')), JSON_UNQUOTE(JSON_EXTRACT(sc.value, '$.expiredAt')), JSON_UNQUOTE(JSON_EXTRACT(sc.value, '$.renewalDate'))), 10), '%Y-%m-%d') < ${until} GROUP BY plan`),
    prisma.$queryRaw<Array<{ tenantId: string; company: string; lastLogin: Date | null; sessionsThisMonth: bigint; pagesVisited: Prisma.Decimal | null }>>(Prisma.sql`SELECT o.id tenantId, o.name company, logins.lastLogin, COALESCE(sessions.sessionCount,0) sessionsThisMonth, views.pageViews FROM Organization o LEFT JOIN (SELECT organizationId, MAX(lastLoginAt) lastLogin FROM User GROUP BY organizationId) logins ON logins.organizationId=o.id LEFT JOIN (SELECT organizationId, COUNT(*) sessionCount FROM UserSession WHERE createdAt >= ${range.from} AND createdAt < ${until} GROUP BY organizationId) sessions ON sessions.organizationId=o.id LEFT JOIN (SELECT organizationId, SUM(pageViews) pageViews FROM TenantUsageDaily WHERE usageDate >= ${range.from} AND usageDate < ${until} GROUP BY organizationId) views ON views.organizationId=o.id WHERE ${eligibleTenantSql} ORDER BY (COALESCE(sessions.sessionCount,0)+COALESCE(views.pageViews,0)) DESC, logins.lastLogin DESC LIMIT 10`),
    prisma.$queryRaw<Array<{ tenantId: string; company: string; createdAt: Date; plan: string | null; lastActive: Date | null }>>(Prisma.sql`SELECT activity.* FROM (SELECT o.id tenantId, o.name company, o.createdAt, JSON_UNQUOTE(JSON_EXTRACT(sub.value, '$.planKey')) plan, NULLIF(GREATEST(COALESCE(logins.lastLogin,'1970-01-01'),COALESCE(sessions.lastSeen,'1970-01-01'),COALESCE(views.lastActivity,'1970-01-01')),'1970-01-01') lastActive FROM Organization o LEFT JOIN SystemConfig sub ON sub.organizationId=o.id AND sub.key='billing.subscription' LEFT JOIN (SELECT organizationId,MAX(lastLoginAt) lastLogin FROM User GROUP BY organizationId) logins ON logins.organizationId=o.id LEFT JOIN (SELECT organizationId,MAX(lastSeenAt) lastSeen FROM UserSession GROUP BY organizationId) sessions ON sessions.organizationId=o.id LEFT JOIN (SELECT organizationId,MAX(lastActivityAt) lastActivity FROM TenantUsageDaily GROUP BY organizationId) views ON views.organizationId=o.id WHERE ${eligibleTenantSql} AND o.status='ACTIVE') activity WHERE (activity.lastActive IS NULL AND activity.createdAt <= ${riskCutoff}) OR activity.lastActive <= ${riskCutoff} ORDER BY COALESCE(activity.lastActive,activity.createdAt) ASC LIMIT 100`),
    prisma.$queryRaw<Array<{ month: string; moduleKey: string; tenantCount: Prisma.Decimal }>>(Prisma.sql`SELECT snapshots.month, snapshots.moduleKey, SUM(snapshots.enabled) tenantCount FROM (SELECT DATE_FORMAT(snapshotDate,'%Y-%m') month, organizationId, moduleKey, enabled, ROW_NUMBER() OVER(PARTITION BY organizationId,moduleKey,DATE_FORMAT(snapshotDate,'%Y-%m') ORDER BY snapshotDate DESC) rowNumber FROM TenantModuleDailySnapshot WHERE snapshotDate >= ${range.from} AND snapshotDate < ${until}) snapshots WHERE snapshots.rowNumber=1 GROUP BY snapshots.month,snapshots.moduleKey`)
  ]);
  const tenantsByMonth = new Map(tenantRows.map((row) => [row.month, Number(row.count)])); const revenueByMonth = new Map(revenueRows.map((row) => [row.month, Number(row.mrr)])); const churnByPlan = new Map(churnRows.map((row) => [row.plan, Number(row.churnedTenants)]));
  const modulesByMonth = new Map<string, Map<string, number>>(); for (const row of moduleRows) { if (!modulesByMonth.has(row.month)) modulesByMonth.set(row.month, new Map()); modulesByMonth.get(row.month)!.set(row.moduleKey, Number(row.tenantCount)); }
  return {
    range: { from: range.from, to: range.to, timezone: "UTC", toInclusive: true },
    newTenantsOverTime: months.map((month) => ({ month, newTenants: tenantsByMonth.get(month) ?? 0 })),
    mrrGrowth: months.map((month) => ({ month, mrr: Number((revenueByMonth.get(month) ?? 0).toFixed(2)), currency: "NGN" })),
    moduleUsageByMonth: months.map((month) => modulesByMonth.has(month) ? { month, modules: Object.fromEntries(billingModuleKeys.map((module) => [module.toUpperCase(), modulesByMonth.get(month)?.get(module) ?? 0])), availability: "TRACKED_MONTH_END" } : { month, modules: null, availability: "NOT_TRACKED" }),
    churnByPlan: billingPlanKeys.map((plan) => ({ plan: plan.toUpperCase().replace(/-/g, "_"), churnedTenants: churnByPlan.get(plan) ?? 0 })),
    totalChurn: [...churnByPlan.values()].reduce((sum, count) => sum + count, 0),
    topTenantsByActivity: topRows.map((row) => ({ tenantId: row.tenantId, company: row.company, lastLogin: row.lastLogin, sessionsThisMonth: Number(row.sessionsThisMonth), pagesVisited: row.pagesVisited === null ? null : Number(row.pagesVisited) })),
    atRiskTenants: riskRows.map((row) => ({ tenantId: row.tenantId, company: row.company, plan: row.plan?.toUpperCase().replace(/-/g, "_") ?? null, lastActive: row.lastActive, daysInactive: calculateDaysInactive(row.lastActive, row.createdAt, riskAsOf), activityState: row.lastActive ? "INACTIVE" : "NEVER_ACTIVE", status: "AT_RISK" })),
    telemetry: { pageViews: "AVAILABLE_AFTER_FRONTEND_INSTRUMENTATION", historicalModuleUsage: "AVAILABLE_FROM_ANALYTICS_MIGRATION_BASELINE" }
  };
};

export const sendAtRiskTenantCheckIn = async (tenantId: string, user: AuthUser) => {
  assertAdmin(user); const now = new Date(); const cutoff = new Date(now.getTime() - 3 * DAY_MS); const checkInDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const tenant = await prisma.organization.findFirst({ where: { id: tenantId, status: "ACTIVE", users: { none: { isPlatformAdmin: true } }, deletionRequests: { none: { status: "PENDING_PLATFORM_APPROVAL" } } }, include: { users: { where: { isActive: true }, orderBy: { createdAt: "asc" }, take: 20, select: { email: true, firstName: true, lastName: true, role: { select: { name: true, isSystem: true } } } }, usageDaily: { orderBy: { lastActivityAt: "desc" }, take: 1, select: { lastActivityAt: true } } } });
  if (!tenant) throw notFound("Active tenant not found"); const [lastUserLogin, lastSession] = await Promise.all([prisma.user.aggregate({ where: { organizationId: tenant.id }, _max: { lastLoginAt: true } }), prisma.userSession.aggregate({ where: { organizationId: tenant.id }, _max: { lastSeenAt: true } })]); const lastActive = [lastUserLogin._max.lastLoginAt, lastSession._max.lastSeenAt, tenant.usageDaily[0]?.lastActivityAt].filter(Boolean).sort((a, b) => b!.getTime() - a!.getTime())[0] ?? null;
  const reject = async (message: string, errorCode: string) => { await createAuditLog({ organizationId: tenant.id, actorUserId: user.id, action: "PLATFORM_AT_RISK_CHECK_IN_REJECTED", resource: "ORGANIZATION", resourceId: tenant.id, summary: "At-risk tenant check-in rejected", metadata: { result: "REJECTED", reason: errorCode } }); throw conflict(message, { errorCode }); };
  if (lastActive && lastActive > cutoff) return reject("Tenant is not currently at risk", "TENANT_NOT_AT_RISK"); if (!lastActive && tenant.createdAt > cutoff) return reject("Tenant has not yet reached the at-risk threshold", "TENANT_NOT_AT_RISK");
  const contact = tenant.users.find((candidate) => candidate.role.isSystem && candidate.role.name === "Owner") ?? tenant.users[0]; const recipientEmail = contact?.email ?? tenant.email; if (!recipientEmail) return reject("Tenant has no eligible check-in contact", "TENANT_CONTACT_MISSING");
  let attempt;
  try { attempt = await prisma.tenantCheckIn.create({ data: { organizationId: tenant.id, checkInDate, triggeredByUserId: user.id, recipientEmail } }); }
  catch (error) { if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return reject("A check-in has already been attempted for this tenant today", "CHECK_IN_COOLDOWN"); throw error; }
  try {
    await sendTenantCheckInEmail({ to: recipientEmail, contactName: contact ? `${contact.firstName} ${contact.lastName}`.trim() : tenant.name, organizationName: tenant.name });
    await prisma.tenantCheckIn.update({ where: { id: attempt.id }, data: { status: "SENT", deliveredAt: new Date() } });
    await createAuditLog({ organizationId: tenant.id, actorUserId: user.id, action: "PLATFORM_AT_RISK_CHECK_IN_SENT", resource: "ORGANIZATION", resourceId: tenant.id, summary: "Sent at-risk tenant check-in", metadata: { checkInId: attempt.id, result: "SUCCESS" } });
    return { tenantId: tenant.id, checkInId: attempt.id, status: "SENT", sentAt: new Date() };
  } catch {
    await prisma.tenantCheckIn.update({ where: { id: attempt.id }, data: { status: "FAILED", failedAt: new Date(), errorMessage: "Email delivery failed" } });
    await createAuditLog({ organizationId: tenant.id, actorUserId: user.id, action: "PLATFORM_AT_RISK_CHECK_IN_FAILED", resource: "ORGANIZATION", resourceId: tenant.id, summary: "At-risk tenant check-in failed", metadata: { checkInId: attempt.id, result: "FAILED" } });
    throw serviceUnavailable("Tenant check-in delivery failed");
  }
};


}

namespace PlatformSupportService {
const eligibleTenantWhere: Prisma.OrganizationWhereInput = {
  status: { not: "ARCHIVED" },
  users: { none: { isPlatformAdmin: true } }
};

const actorIsPlatformAdmin = (actor: AuthUser) => {
  if (!actor.isPlatformAdmin || actor.impersonation) throw forbidden("Platform Admin access is required");
};

const ticketInclude = {
  organization: { select: { id: true, name: true } },
  assignedTo: { select: { id: true, firstName: true, lastName: true } },
  resolvedBy: { select: { id: true, firstName: true, lastName: true } }
} satisfies Prisma.SupportTicketInclude;

type TicketRecord = Prisma.SupportTicketGetPayload<{ include: typeof ticketInclude }>;

const person = (user: { id: string; firstName: string; lastName: string } | null) =>
  user ? { id: user.id, name: `${user.firstName} ${user.lastName}`.trim() } : null;

const mapListTicket = (ticket: TicketRecord) => ({
  ticketId: ticket.ticketNumber,
  tenant: ticket.organization,
  subject: ticket.subject,
  priority: ticket.priority,
  status: ticket.status,
  assignedTo: person(ticket.assignedTo),
  updatedAt: ticket.updatedAt
});

const mapTicketDetail = (ticket: TicketRecord) => ({
  ...mapListTicket(ticket),
  description: ticket.description,
  openedAt: ticket.openedAt,
  resolutionNotes: ticket.resolutionNotes,
  resolvedAt: ticket.resolvedAt,
  resolvedBy: person(ticket.resolvedBy),
  createdAt: ticket.createdAt
});

const findTicket = async (identifier: string) => {
  const ticket = await prisma.supportTicket.findFirst({
    where: { OR: [{ id: identifier }, { ticketNumber: identifier }] },
    include: ticketInclude
  });
  if (!ticket) throw notFound("Support ticket not found");
  return ticket;
};

export const isSupportStatusTransitionAllowed = (from: SupportTicketStatus, to: SupportTicketStatus) =>
  from === to ||
  (from === "OPEN" && (to === "IN_PROGRESS" || to === "RESOLVED")) ||
  (from === "IN_PROGRESS" && to === "RESOLVED");

export const listPlatformSupportTickets = async (queryInput: unknown, actor: AuthUser) => {
  actorIsPlatformAdmin(actor);
  const query = supportTicketListQuerySchema.parse(queryInput);
  const where: Prisma.SupportTicketWhereInput = {
    organization: eligibleTenantWhere,
    ...(query.status ? { status: query.status } : {}),
    ...(query.search ? {
      OR: [
        { id: { contains: query.search } },
        { ticketNumber: { contains: query.search } },
        { subject: { contains: query.search } },
        { organization: { name: { contains: query.search } } }
      ]
    } : {})
  };
  const [total, tickets] = await prisma.$transaction([
    prisma.supportTicket.count({ where }),
    prisma.supportTicket.findMany({
      where,
      include: ticketInclude,
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
      skip: (query.page - 1) * query.limit,
      take: query.limit
    })
  ]);
  return {
    data: tickets.map(mapListTicket),
    pagination: {
      page: query.page,
      limit: query.limit,
      total,
      totalPages: Math.ceil(total / query.limit),
      hasNextPage: query.page * query.limit < total,
      hasPreviousPage: query.page > 1
    }
  };
};

export const getPlatformSupportTicket = async (ticketId: string, actor: AuthUser) => {
  actorIsPlatformAdmin(actor);
  return mapTicketDetail(await findTicket(ticketId));
};

const generateTicketNumber = () =>
  `TKT-${new Date().getUTCFullYear()}-${crypto.randomBytes(5).toString("hex").toUpperCase()}`;

export const createPlatformSupportTicket = async (input: unknown, actor: AuthUser) => {
  actorIsPlatformAdmin(actor);
  const payload = createSupportTicketSchema.parse(input);
  const tenant = await prisma.organization.findFirst({
    where: { id: payload.tenantId, ...eligibleTenantWhere },
    select: { id: true, name: true }
  });
  if (!tenant) throw notFound("Tenant not found");

  let created: TicketRecord | null = null;
  for (let attempt = 0; attempt < 3 && !created; attempt += 1) {
    try {
      created = await prisma.supportTicket.create({
        data: {
          organizationId: tenant.id,
          ticketNumber: generateTicketNumber(),
          subject: payload.subject,
          description: payload.description,
          priority: payload.priority,
          status: "OPEN",
          openedAt: new Date(),
          createdByUserId: actor.id
        },
        include: ticketInclude
      });
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") throw error;
    }
  }
  if (!created) throw conflict("Unable to allocate a unique ticket number; retry the request");
  await createAuditLog({
    organizationId: tenant.id,
    actorUserId: actor.id,
    action: "PLATFORM_SUPPORT_TICKET_CREATED",
    resource: "SUPPORT_TICKET",
    resourceId: created.id,
    summary: `Created support ticket ${created.ticketNumber}`,
    metadata: { ticketNumber: created.ticketNumber, priority: created.priority }
  });
  return mapTicketDetail(created);
};

export const assignPlatformSupportTicket = async (ticketId: string, input: unknown, actor: AuthUser) => {
  actorIsPlatformAdmin(actor);
  const payload = assignSupportTicketSchema.parse(input);
  const [ticket, assignee] = await Promise.all([
    findTicket(ticketId),
    prisma.user.findFirst({
      where: { id: payload.assignedToId, isPlatformAdmin: true, isActive: true },
      select: { id: true, firstName: true, lastName: true }
    })
  ]);
  if (!assignee) throw badRequest("Assignee must be an active Platform Admin", { errorCode: "INVALID_ASSIGNEE" });
  if (ticket.assignedToUserId === assignee.id) return mapTicketDetail(ticket);
  const updated = await prisma.supportTicket.update({
    where: { id: ticket.id },
    data: { assignedToUserId: assignee.id },
    include: ticketInclude
  });
  await createAuditLog({
    organizationId: ticket.organizationId, actorUserId: actor.id,
    action: "PLATFORM_SUPPORT_TICKET_ASSIGNED", resource: "SUPPORT_TICKET", resourceId: ticket.id,
    summary: `Assigned support ticket ${ticket.ticketNumber}`,
    metadata: { previousAssigneeId: ticket.assignedToUserId, assignedToId: assignee.id }
  });
  return mapTicketDetail(updated);
};

export const updatePlatformSupportResolutionNotes = async (ticketId: string, input: unknown, actor: AuthUser) => {
  actorIsPlatformAdmin(actor);
  const payload = updateResolutionNotesSchema.parse(input);
  const ticket = await findTicket(ticketId);
  if (ticket.status === "RESOLVED") throw conflict("Resolution notes cannot be changed after a ticket is resolved");
  const updated = await prisma.supportTicket.update({
    where: { id: ticket.id },
    data: { resolutionNotes: payload.resolutionNotes },
    include: ticketInclude
  });
  await createAuditLog({
    organizationId: ticket.organizationId, actorUserId: actor.id,
    action: "PLATFORM_SUPPORT_RESOLUTION_NOTES_UPDATED", resource: "SUPPORT_TICKET", resourceId: ticket.id,
    summary: `Updated resolution notes for ${ticket.ticketNumber}`
  });
  return mapTicketDetail(updated);
};

export const updatePlatformSupportTicketStatus = async (ticketId: string, input: unknown, actor: AuthUser) => {
  actorIsPlatformAdmin(actor);
  const payload = updateSupportTicketStatusSchema.parse(input);
  const ticket = await findTicket(ticketId);
  const current = ticket.status as SupportTicketStatus;
  if (!isSupportStatusTransitionAllowed(current, payload.status)) {
    throw conflict(`Cannot transition a support ticket from ${current} to ${payload.status}`, { errorCode: "INVALID_STATUS_TRANSITION" });
  }
  if (current === payload.status) return mapTicketDetail(ticket);
  const resolvedAt = payload.status === "RESOLVED" ? new Date() : null;
  const changed = await prisma.supportTicket.updateMany({
    where: { id: ticket.id, status: current },
    data: {
      status: payload.status,
      ...(resolvedAt ? { resolvedAt, resolvedByUserId: actor.id } : {})
    }
  });
  if (changed.count !== 1) throw conflict("Ticket was updated by another request; refresh and retry");
  const updated = await findTicket(ticket.id);
  await createAuditLog({
    organizationId: ticket.organizationId, actorUserId: actor.id,
    action: payload.status === "RESOLVED" ? "PLATFORM_SUPPORT_TICKET_RESOLVED" : "PLATFORM_SUPPORT_TICKET_STATUS_UPDATED",
    resource: "SUPPORT_TICKET", resourceId: ticket.id,
    summary: `Changed support ticket ${ticket.ticketNumber} from ${current} to ${payload.status}`,
    metadata: { previousStatus: current, newStatus: payload.status }
  });
  return mapTicketDetail(updated);
};

export const resolvePlatformSupportTicket = (ticketId: string, actor: AuthUser) =>
  updatePlatformSupportTicketStatus(ticketId, { status: "RESOLVED" }, actor);


}

export const listPlatformInvoices = PlatformBillingService.listPlatformInvoices;
export const getBillingAnalytics = PlatformBillingService.getBillingAnalytics;
export const getRevenueByPlan = PlatformBillingService.getRevenueByPlan;
export const createPlatformInvoice = PlatformBillingService.createPlatformInvoice;
export const sendInvoiceReminder = PlatformBillingService.sendInvoiceReminder;
export const downloadPlatformInvoice = PlatformBillingService.downloadPlatformInvoice;
export const sanitizeCsvCell = PlatformBillingService.sanitizeCsvCell;
export const exportPlatformInvoices = PlatformBillingService.exportPlatformInvoices;
export const getBillingOverview = PlatformBillingService.getBillingOverview;
export const platformUserRowStatus = PlatformUsersService.platformUserRowStatus;
export const effectivePlatformUserModules = PlatformUsersService.effectivePlatformUserModules;
export const getPlatformUserAnalytics = PlatformUsersService.getPlatformUserAnalytics;
export const getPlatformUsers = PlatformUsersService.getPlatformUsers;
export const getPlatformUserFilterOptions = PlatformUsersService.getPlatformUserFilterOptions;
export const deactivatePlatformUser = PlatformUsersService.deactivatePlatformUser;
export const resetPlatformUserPassword = PlatformUsersService.resetPlatformUserPassword;
export const impersonatePlatformUser = PlatformUsersService.impersonatePlatformUser;
export const moduleUsageTotal = PlatformModulesService.moduleUsageTotal;
export const getPlatformModuleAnalytics = PlatformModulesService.getPlatformModuleAnalytics;
export const getPlatformModuleTenants = PlatformModulesService.getPlatformModuleTenants;
export const getPlatformModuleTenant = PlatformModulesService.getPlatformModuleTenant;
export const updatePlatformTenantModules = PlatformModulesService.updatePlatformTenantModules;
export const setPlatformTenantModule = PlatformModulesService.setPlatformTenantModule;
export const getPlatformModulesOverview = PlatformModulesService.getPlatformModulesOverview;
export const monthKeys = PlatformAnalyticsService.monthKeys;
export const calculateDaysInactive = PlatformAnalyticsService.calculateDaysInactive;
export const monthlyRecurringEquivalent = PlatformAnalyticsService.monthlyRecurringEquivalent;
export const activityScore = PlatformAnalyticsService.activityScore;
export const getPlatformAnalytics = PlatformAnalyticsService.getPlatformAnalytics;
export const sendAtRiskTenantCheckIn = PlatformAnalyticsService.sendAtRiskTenantCheckIn;
export const isSupportStatusTransitionAllowed = PlatformSupportService.isSupportStatusTransitionAllowed;
export const listPlatformSupportTickets = PlatformSupportService.listPlatformSupportTickets;
export const getPlatformSupportTicket = PlatformSupportService.getPlatformSupportTicket;
export const createPlatformSupportTicket = PlatformSupportService.createPlatformSupportTicket;
export const assignPlatformSupportTicket = PlatformSupportService.assignPlatformSupportTicket;
export const updatePlatformSupportResolutionNotes = PlatformSupportService.updatePlatformSupportResolutionNotes;
export const updatePlatformSupportTicketStatus = PlatformSupportService.updatePlatformSupportTicketStatus;
export const resolvePlatformSupportTicket = PlatformSupportService.resolvePlatformSupportTicket;
