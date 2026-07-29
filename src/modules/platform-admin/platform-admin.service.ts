import { Prisma } from "@prisma/client";
import type { AuthUser } from "../../types";
import bcrypt from "bcryptjs";
import crypto from "node:crypto";
import jwt from "jsonwebtoken";
import { env } from "../../config/env";
import { badRequest, conflict, forbidden, notFound } from "../../core/http-error";
import { prisma } from "../../core/prisma";
import { createAuditLog } from "../admin/admin.audit";
import { forgotPassword } from "../auth/auth.service";
import {
  billingModuleKeys,
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
  type PlatformSubscriptionStatus
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
  type PlatformDashboardQuery
} from "./platform-admin.validation";

const subscriptionKey = "billing.subscription";
const addOnPrefix = "billing.addons";
const excludedTenantWhere: Prisma.OrganizationWhereInput = {
  status: { not: "ARCHIVED" },
  deletionRequests: { none: { status: "PENDING_PLATFORM_APPROVAL" } },
  users: { none: { isPlatformAdmin: true } }
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

const assertPlatformAdmin = (platformAdmin: AuthUser) => {
  if (!platformAdmin.isPlatformAdmin) throw forbidden("Platform Admin access is required");
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
  const modules = await getPlatformTenantModules(tenantId, platformAdmin); const current = modules.modules.find((module) => module.moduleId === moduleId)!;
  if (!payload.enabled && current.includedInPlan) throw badRequest("A module included in the current plan cannot be disabled; override the plan first", { errorCode: "MODULE_INCLUDED_IN_PLAN" });
  if ((current.status === "ACTIVE") === payload.enabled) throw badRequest("Module already has the requested state", { errorCode: "DUPLICATE_OPERATION" });
  const now = new Date(); const addOnKey = `${addOnPrefix}.${moduleId}.subscription`;
  await prisma.$transaction([
    prisma.systemConfig.upsert({ where: { organizationId_key: { organizationId: tenantId, key: `module.${moduleId}.status` } }, create: { organizationId: tenantId, key: `module.${moduleId}.status`, value: payload.enabled ? "ACTIVE" : "INACTIVE" }, update: { value: payload.enabled ? "ACTIVE" : "INACTIVE" } }),
    prisma.systemConfig.upsert({ where: { organizationId_key: { organizationId: tenantId, key: addOnKey } }, create: { organizationId: tenantId, key: addOnKey, value: { status: payload.enabled ? "ACTIVE" : "INACTIVE", activatedAt: payload.enabled ? now.toISOString() : null } }, update: { value: { status: payload.enabled ? "ACTIVE" : "INACTIVE", activatedAt: payload.enabled ? now.toISOString() : null } } })
  ]);
  await createAuditLog({ organizationId: tenantId, actorUserId: platformAdmin.id, action: payload.enabled ? "PLATFORM_MODULE_ENABLED" : "PLATFORM_MODULE_DISABLED", resource: "MODULE", resourceId: moduleId, summary: `${payload.enabled ? "Enabled" : "Disabled"} ${moduleLabels[moduleId]}` });
  return { moduleId, moduleName: moduleLabels[moduleId], status: payload.enabled ? "ACTIVE" : "INACTIVE", effectiveAt: now };
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
  const endedAt = new Date(); await prisma.platformImpersonationSession.update({ where: { id: session.id }, data: { status: "ENDED", endedAt } });
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
