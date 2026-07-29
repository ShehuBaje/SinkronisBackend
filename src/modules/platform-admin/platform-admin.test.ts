import test from "node:test";
import assert from "node:assert/strict";
import { lastSixCalendarMonths, moduleAdoptionFromSnapshot } from "./platform-admin.service";
import {
  createPlatformTenantSchema,
  createPlatformPricingPlanSchema,
  overridePlatformTenantPlanSchema,
  platformDashboardQuerySchema,
  platformModuleToggleSchema,
  platformPricingQuerySchema,
  platformTenantListQuerySchema,
  platformTenantSupportQuerySchema,
  suspendPlatformTenantSchema,
  updatePlatformPriceSchema
} from "./platform-admin.validation";
import type { PlatformSubscriptionSnapshot } from "./platform-admin.interface";
import { platformAdminRouter } from "./platform-admin.routes";
import { requirePlatformAdmin } from "../../middleware/platform-admin.middleware";
import { canAccessOrganization } from "../../middleware/auth.middleware";

test("revenue trend always returns six chronological calendar months", () => {
  const months = lastSixCalendarMonths(new Date("2026-01-15T00:00:00.000Z"));
  assert.equal(months.length, 6);
  assert.deepEqual(months.map((item) => [item.month, item.year]), [
    ["August", 2025], ["September", 2025], ["October", 2025],
    ["November", 2025], ["December", 2025], ["January", 2026]
  ]);
});

test("All-in-One contributes to each included module adoption", () => {
  const subscriptions: PlatformSubscriptionSnapshot[] = [
    { organizationId: "one", planKey: "all-in-one", planName: "All-in-One Suite", status: "ACTIVE", renewalDate: null, billingCycle: "MONTHLY", activeModules: ["hris", "payroll", "accounting"], monthlyRecurringRevenue: 150000, baseMonthlyRecurringRevenue: 150000, revenueComponents: [{ key: "all-in-one", source: "BASE_PLAN", monthlyRevenue: 150000 }], seatAllocation: null },
    { organizationId: "two", planKey: "payroll", planName: "Payroll", status: "ACTIVE", renewalDate: null, billingCycle: "MONTHLY", activeModules: ["payroll"], monthlyRecurringRevenue: 10000, baseMonthlyRecurringRevenue: 10000, revenueComponents: [{ key: "payroll", source: "BASE_PLAN", monthlyRevenue: 10000 }], seatAllocation: null }
  ];
  const adoption = moduleAdoptionFromSnapshot(subscriptions, 2);
  assert.deepEqual(adoption.map((item) => [item.moduleId, item.tenantCount, item.percentageAdoption]), [
    ["hris", 1, 50], ["accounting", 1, 50], ["payroll", 2, 100], ["all-in-one", 1, 50]
  ]);
});

test("tenant health validates ranges, filters, sorting, and pagination", () => {
  assert.equal(platformDashboardQuerySchema.safeParse({ revenueMin: 500, revenueMax: 100 }).success, false);
  assert.equal(platformDashboardQuerySchema.safeParse({ registeredFrom: "2026-07-20", registeredTo: "2026-07-21" }).success, false);
  const query = platformDashboardQuerySchema.parse({ plan: "ALL_IN_ONE", module: "HRIS", status: "ACTIVE", sortBy: "lastActiveAt", page: "2", limit: "10", activityLimit: "7" });
  assert.deepEqual({ plan: query.plan, module: query.module, status: query.status, sortBy: query.sortBy, page: query.page, activityLimit: query.activityLimit }, { plan: "all-in-one", module: "hris", status: "ACTIVE", sortBy: "lastActiveDate", page: 2, activityLimit: 7 });
});

test("dashboard limits are bounded and invalid query fields are rejected", () => {
  assert.equal(platformDashboardQuerySchema.safeParse({ limit: 101 }).success, false);
  assert.equal(platformDashboardQuerySchema.safeParse({ activityLimit: 101 }).success, false);
  assert.equal(platformDashboardQuerySchema.safeParse({ eventType: "UNKNOWN" }).success, false);
});

test("only the consolidated dashboard plus Platform Tenant management routes are active", () => {
  const paths = (platformAdminRouter as any).stack.filter((layer: any) => layer.route).map((layer: any) => layer.route.path);
  assert.deepEqual(paths, [
    "/impersonation/exit", "/dashboard",
    "/pricing", "/pricing/modules/:moduleId/price", "/pricing/plans",
    "/tenants", "/tenants", "/tenants/:tenantId",
    "/tenants/:tenantId/overview", "/tenants/:tenantId/users",
    "/tenants/:tenantId/users/:userId/deactivate", "/tenants/:tenantId/users/:userId/reset-password",
    "/tenants/:tenantId/modules", "/tenants/:tenantId/modules/:moduleId",
    "/tenants/:tenantId/billing", "/tenants/:tenantId/subscription/override",
    "/tenants/:tenantId/activity", "/tenants/:tenantId/support-tickets",
    "/tenants/:tenantId/impersonate", "/tenants/:tenantId/suspend", "/tenants/:tenantId/activate"
  ]);
  for (const removed of ["/pricing/modules", "/pricing/subscription-distribution", "/pricing/plans/:planId"]) {
    assert.equal(paths.includes(removed), false);
  }
  const pricingPlanRoute = (platformAdminRouter as any).stack.find((layer: any) => layer.route?.path === "/pricing/plans");
  assert.deepEqual(Object.keys(pricingPlanRoute.route.methods), ["post"]);
  for (const removed of ["/dashboard/analytics", "/dashboard/revenue-trend", "/dashboard/module-adoption", "/dashboard/recent-activity", "/dashboard/tenant-health"]) {
    assert.equal(paths.includes(removed), false);
  }
});

test("pricing queries and mutations enforce bounded filters, precision, and effective dates", () => {
  assert.equal(platformPricingQuerySchema.safeParse({ page: 1, limit: 20, sortBy: "monthlyRevenue", sortOrder: "desc" }).success, true);
  assert.equal(platformPricingQuerySchema.safeParse({ limit: 101 }).success, false);
  assert.equal(updatePlatformPriceSchema.safeParse({ monthlyPrice: 90000.25, reason: "Annual pricing review", effectiveAt: "2026-08-01T00:00:00.000Z" }).success, true);
  assert.equal(updatePlatformPriceSchema.safeParse({ monthlyPrice: 1.001, reason: "Invalid precision", effectiveAt: "2026-08-01T00:00:00.000Z" }).success, false);
});

test("plan creation rejects duplicate features and accepts references or normalized feature input", () => {
  assert.equal(createPlatformPricingPlanSchema.safeParse({
    name: "Enterprise", monthlyPrice: 250000, description: "Large organization plan",
    features: [{ featureId: "feature_hris_employee" }, { name: "Dedicated Account Manager", description: "Assigned specialist" }]
  }).success, true);
  assert.equal(createPlatformPricingPlanSchema.safeParse({
    name: "Enterprise", monthlyPrice: 250000, description: "Large organization plan",
    features: [{ featureId: "same" }, { featureId: "same" }]
  }).success, false);
});

test("tenant creation validates modular plans, email, country, and strict fields", () => {
  assert.equal(createPlatformTenantSchema.safeParse({ companyName: "Acme", adminEmail: "admin@acme.test", subscriptionPlan: "ALL_IN_ONE", country: "NG" }).success, true);
  assert.equal(createPlatformTenantSchema.safeParse({ companyName: "Acme", adminEmail: "invalid", subscriptionPlan: "STARTER", country: "NG" }).success, false);
  assert.equal(createPlatformTenantSchema.safeParse({ companyName: "Acme", adminEmail: "admin@acme.test", subscriptionPlan: "HRIS", country: "ZZ" }).success, false);
});

test("module toggles, plan overrides, and support filters reject invalid values", () => {
  assert.equal(platformModuleToggleSchema.safeParse({ enabled: true }).success, true);
  assert.equal(platformModuleToggleSchema.safeParse({ enabled: "yes" }).success, false);
  assert.equal(overridePlatformTenantPlanSchema.safeParse({ plan: "accounting", effectiveDate: "2026-08-01T00:00:00+01:00" }).success, true);
  assert.equal(overridePlatformTenantPlanSchema.safeParse({ plan: "enterprise" }).success, false);
  assert.equal(platformTenantSupportQuerySchema.safeParse({ status: "OPEN", priority: "HIGH", sortOrder: "desc" }).success, true);
  assert.equal(platformTenantSupportQuerySchema.safeParse({ status: "UNKNOWN" }).success, false);
});

test("Platform Admin guard rejects a tenant-level admin", () => {
  let receivedError: any;
  requirePlatformAdmin({ user: { isPlatformAdmin: false } } as any, {} as any, (error?: unknown) => { receivedError = error; });
  assert.equal(receivedError?.statusCode, 403);
});

test("tenant filters accept UI enums and All means no filter", () => {
  const filtered = platformTenantListQuerySchema.parse({ plan: "ALL_IN_ONE", module: "HRIS", status: "SUSPENDED", sortBy: "numberOfUsers", sortOrder: "desc" });
  assert.deepEqual({ plan: filtered.plan, module: filtered.module, status: filtered.status, sortBy: filtered.sortBy }, { plan: "all-in-one", module: "hris", status: "SUSPENDED", sortBy: "totalUsers" });
  const all = platformTenantListQuerySchema.parse({ plan: "All", module: "ALL", status: "all" });
  assert.deepEqual({ plan: all.plan, module: all.module, status: all.status }, { plan: undefined, module: undefined, status: undefined });
});

test("tenant suspension reason is optional but validated when supplied", () => {
  assert.equal(suspendPlatformTenantSchema.safeParse({}).success, true);
  assert.equal(suspendPlatformTenantSchema.safeParse({ reason: "x" }).success, false);
  assert.equal(suspendPlatformTenantSchema.safeParse({ reason: "Repeated payment abuse" }).success, true);
});

test("suspended tenants lose access while Platform Admin identity remains independently guarded", () => {
  assert.equal(canAccessOrganization({ isPlatformAdmin: false, organization: { status: "SUSPENDED" } }), false);
  assert.equal(canAccessOrganization({ isPlatformAdmin: false, organization: { status: "ACTIVE" } }), true);
  assert.equal(canAccessOrganization({ isPlatformAdmin: true, organization: { status: "SUSPENDED" } }), true);
});
