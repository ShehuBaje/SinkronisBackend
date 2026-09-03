import test from "node:test";
import assert from "node:assert/strict";
import { lastSixCalendarMonths, moduleAdoptionFromSnapshot } from "./platform-admin.service";
import {
  createPlatformTenantSchema,
  overridePlatformTenantPlanSchema,
  platformDashboardQuerySchema,
  platformModuleToggleSchema,
  platformPricingQuerySchema,
  platformTenantListQuerySchema,
  platformTenantSupportQuerySchema,
  suspendPlatformTenantSchema,
  updatePlatformPriceSchema
} from "./platform-admin.validation";
import { billingDateFilterSchema, createPlatformInvoiceSchema, invoiceExportQuerySchema, invoiceListQuerySchema, impersonatePlatformUserSchema, platformUsersQuerySchema, platformModuleBulkUpdateSchema, platformModulesQuerySchema, platformAnalyticsQuerySchema, createSupportTicketSchema, supportTicketListQuerySchema, updateResolutionNotesSchema, updateSupportTicketStatusSchema } from "./platform-admin.validation";
import { restrictImpersonatedSensitiveActions } from "../../middleware/impersonation.middleware";
import { annualRecurringRevenue, churnRatePercentage, createPlatformInvoiceNumber, invoiceReminderEligible, sanitizeCsvCell, effectivePlatformUserModules, platformUserRowStatus, moduleUsageTotal, activityScore, calculateDaysInactive, monthKeys, monthlyRecurringEquivalent, isSupportStatusTransitionAllowed } from "./platform-admin.service";
import { requireEffectiveModuleAccess } from "../../middleware/module-access.middleware";
import { platformEmailTemplateParamsSchema, platformFeatureFlagParamsSchema, updateMaintenanceModeSchema, updatePlatformConfigurationSchema, updatePlatformEmailTemplateSchema, updatePlatformPasswordPolicySchema } from "./platform-admin.validation";
import { extractTemplateVariables } from "./platform-admin.service";
import { enforcePlatformMaintenance } from "../../middleware/maintenance.middleware";
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
    { organizationId: "one", planKey: "all-in-one", planName: "All-in-One Suite", status: "ACTIVE", renewalDate: null, billingCycle: "MONTHLY", activeModules: ["hris", "payroll", "accounting"], monthlyRecurringRevenue: 150000, baseMonthlyRecurringRevenue: 150000, revenueComponents: [{ key: "all-in-one", source: "BASE_PLAN", monthlyRevenue: 150000 }] },
    { organizationId: "two", planKey: "payroll", planName: "Payroll", status: "ACTIVE", renewalDate: null, billingCycle: "MONTHLY", activeModules: ["payroll"], monthlyRecurringRevenue: 10000, baseMonthlyRecurringRevenue: 10000, revenueComponents: [{ key: "payroll", source: "BASE_PLAN", monthlyRevenue: 10000 }] }
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
    "/impersonation/exit", "/impersonation/stop", "/dashboard",
    "/pricing", "/pricing/modules/:moduleId/price", "/pricing/:planCode",
    "/billing", "/billing/analytics", "/billing/revenue-by-plan", "/billing/invoices/export", "/billing/export", "/billing/invoices", "/billing/invoices", "/billing/invoices/:invoiceId/reminder", "/billing/invoices/:invoiceId/download",
    "/users", "/users/analytics", "/users/filter-options", "/users/:userId/deactivate", "/users/:userId/reset-password", "/users/:userId/impersonate",
    "/modules", "/modules/analytics", "/modules/tenants", "/modules/tenants/:tenantId", "/modules/tenants/:tenantId", "/modules/tenants/:tenantId/:module/enable", "/modules/tenants/:tenantId/:module/disable",
    "/analytics", "/analytics/at-risk/:tenantId/check-in",
    "/support/tickets", "/support/tickets", "/support/tickets/:ticketId",
    "/support/tickets/:ticketId/assign", "/support/tickets/:ticketId/resolution-notes",
    "/support/tickets/:ticketId/status", "/support/tickets/:ticketId/resolve",
    "/settings", "/settings/configuration", "/settings/configuration",
    "/settings/password-policy", "/settings/password-policy",
    "/settings/feature-flags", "/settings/feature-flags/:key",
    "/settings/email-templates", "/settings/email-templates/:key", "/settings/email-templates/:key",
    "/settings/maintenance", "/settings/maintenance",
    "/tenants", "/tenants", "/tenants/:tenantId",
    "/tenants/:tenantId/overview", "/tenants/:tenantId/users",
    "/tenants/:tenantId/users/:userId/deactivate", "/tenants/:tenantId/users/:userId/reset-password",
    "/tenants/:tenantId/modules", "/tenants/:tenantId/modules/:moduleId",
    "/tenants/:tenantId/billing", "/tenants/:tenantId/subscription/activate", "/tenants/:tenantId/subscription/override",
    "/tenants/:tenantId/activity", "/tenants/:tenantId/support-tickets",
    "/tenants/:tenantId/impersonate", "/tenants/:tenantId/suspend", "/tenants/:tenantId/activate"
  ]);
  for (const removed of ["/pricing/modules", "/pricing/subscription-distribution", "/pricing/plans/:planId"]) {
    assert.equal(paths.includes(removed), false);
  }
  assert.equal(paths.includes("/pricing/plans"), false);
  for (const removed of ["/dashboard/analytics", "/dashboard/revenue-trend", "/dashboard/module-adoption", "/dashboard/recent-activity", "/dashboard/tenant-health"]) {
    assert.equal(paths.includes(removed), false);
  }
});

test("support ticket queries and creation enforce bounded platform enums and input", () => {
  const query = supportTicketListQuerySchema.parse({ page: "2", limit: "50", search: "  Bravo  ", status: "in_progress" });
  assert.deepEqual(query, { page: 2, limit: 50, search: "Bravo", status: "IN_PROGRESS" });
  assert.equal(supportTicketListQuerySchema.safeParse({ page: 0 }).success, false);
  assert.equal(supportTicketListQuerySchema.safeParse({ limit: 101 }).success, false);
  assert.equal(supportTicketListQuerySchema.safeParse({ search: "x" }).success, false);
  assert.equal(supportTicketListQuerySchema.safeParse({ status: "CLOSED" }).success, false);
  assert.equal(createSupportTicketSchema.safeParse({ tenantId: "tenant", subject: "PAYE issue", priority: "critical", description: "PAYE calculation produces an incorrect result." }).success, true);
  assert.equal(createSupportTicketSchema.safeParse({ tenantId: "tenant", subject: "x", priority: "LOW", description: "short" }).success, false);
  assert.equal(updateResolutionNotesSchema.safeParse({ resolutionNotes: "  Corrected calculation and awaiting confirmation.  " }).success, true);
});

test("support ticket status transitions allow progression, idempotence, and no reopening", () => {
  assert.equal(isSupportStatusTransitionAllowed("OPEN", "OPEN"), true);
  assert.equal(isSupportStatusTransitionAllowed("OPEN", "IN_PROGRESS"), true);
  assert.equal(isSupportStatusTransitionAllowed("OPEN", "RESOLVED"), true);
  assert.equal(isSupportStatusTransitionAllowed("IN_PROGRESS", "RESOLVED"), true);
  assert.equal(isSupportStatusTransitionAllowed("IN_PROGRESS", "OPEN"), false);
  assert.equal(isSupportStatusTransitionAllowed("RESOLVED", "OPEN"), false);
  assert.equal(updateSupportTicketStatusSchema.safeParse({ status: "PENDING" }).success, false);
});

test("platform configuration validates partial updates, currencies, VAT, timezone, and email", () => {
  const parsed = updatePlatformConfigurationSchema.parse({ defaultCurrency: "GBP", vatRate: "7.5", defaultTimezone: "Africa/Lagos", supportEmail: " SUPPORT@EXAMPLE.COM " });
  assert.deepEqual(parsed, { defaultCurrency: "GBP", vatRate: 7.5, defaultTimezone: "Africa/Lagos", supportEmail: "support@example.com" });
  assert.equal(updatePlatformConfigurationSchema.safeParse({}).success, false);
  assert.equal(updatePlatformConfigurationSchema.safeParse({ defaultCurrency: "EUR" }).success, false);
  assert.equal(updatePlatformConfigurationSchema.safeParse({ vatRate: -1 }).success, false);
  assert.equal(updatePlatformConfigurationSchema.safeParse({ vatRate: 101 }).success, false);
  assert.equal(updatePlatformConfigurationSchema.safeParse({ defaultTimezone: "Lagos" }).success, false);
  assert.equal(updatePlatformConfigurationSchema.safeParse({ supportEmail: "invalid" }).success, false);
});

test("global password policy supports never-expire and bounded security values", () => {
  assert.equal(updatePlatformPasswordPolicySchema.safeParse({ minimumLength: 16, passwordExpiryDays: null, accountLockoutAttempts: 3, requireSpecialCharacter: true }).success, true);
  assert.equal(updatePlatformPasswordPolicySchema.safeParse({}).success, false);
  assert.equal(updatePlatformPasswordPolicySchema.safeParse({ minimumLength: 7 }).success, false);
  assert.equal(updatePlatformPasswordPolicySchema.safeParse({ accountLockoutAttempts: 2 }).success, false);
});

test("feature and email template keys are closed enums and templates reject unsafe HTML", () => {
  assert.equal(platformFeatureFlagParamsSchema.safeParse({ key: "AI_POWERED_INSIGHTS" }).success, true);
  assert.equal(platformFeatureFlagParamsSchema.safeParse({ key: "UNKNOWN_FLAG" }).success, false);
  assert.equal(platformEmailTemplateParamsSchema.safeParse({ key: "ONBOARDING_WELCOME" }).success, true);
  assert.equal(updatePlatformEmailTemplateSchema.safeParse({ subject: "Welcome {{tenantName}}", body: "Hello {{adminName}}" }).success, true);
  assert.equal(updatePlatformEmailTemplateSchema.safeParse({ subject: "Unsafe", body: "<script>alert(1)</script>" }).success, false);
  assert.deepEqual(extractTemplateVariables("Hello {{ tenantName }} and {{adminName}}"), ["tenantName", "adminName"]);
  assert.throws(() => extractTemplateVariables("Hello {{tenantName"), /malformed placeholder/);
});

test("maintenance updates are bounded and Platform Admin requests bypass enforcement", () => {
  assert.equal(updateMaintenanceModeSchema.safeParse({ enabled: true, message: "Scheduled platform maintenance is in progress." }).success, true);
  assert.equal(updateMaintenanceModeSchema.safeParse({}).success, false);
  assert.equal(updateMaintenanceModeSchema.safeParse({ message: "short" }).success, false);
  let continued = false;
  enforcePlatformMaintenance({ user: { isPlatformAdmin: true } } as any, {} as any, () => { continued = true; });
  assert.equal(continued, true);
});

test("analytics date ranges are UTC, inclusive, bounded, and ordered", () => {
  const parsed = platformAnalyticsQuerySchema.parse({ from: "2026-01-31", to: "2026-03-01" });
  assert.equal(parsed.from.toISOString(), "2026-01-31T00:00:00.000Z");
  assert.equal(parsed.to.toISOString(), "2026-03-01T00:00:00.000Z");
  assert.equal(platformAnalyticsQuerySchema.safeParse({ from: "2026-03-02", to: "2026-03-01" }).success, false);
  assert.equal(platformAnalyticsQuerySchema.safeParse({ from: "2020-01-01", to: "2026-01-01" }).success, false);
  assert.equal(platformAnalyticsQuerySchema.safeParse({ from: "01/01/2026" }).success, false);
});

test("analytics query validation is idempotent across route middleware and service", () => {
  const routeValidated = platformAnalyticsQuerySchema.parse({ from: "2026-02-01", to: "2026-07-31" });
  const serviceValidated = platformAnalyticsQuerySchema.parse(routeValidated);
  assert.equal(serviceValidated.from.toISOString(), "2026-02-01T00:00:00.000Z");
  assert.equal(serviceValidated.to.toISOString(), "2026-07-31T00:00:00.000Z");
  assert.doesNotThrow(() => JSON.stringify({ success: true, data: { range: serviceValidated, amount: 0, rows: [], nullableActivity: null } }));
});

test("analytics month series includes continuous zero-value month keys across boundaries", () => {
  assert.deepEqual(monthKeys(new Date("2025-12-31T00:00:00.000Z"), new Date("2026-03-01T00:00:00.000Z")), ["2025-12", "2026-01", "2026-02", "2026-03"]);
});

test("analytics inactivity accepts TiDB calculated date strings", () => {
  assert.equal(calculateDaysInactive("2026-08-20T00:00:00.000Z", "2026-08-01T00:00:00.000Z", new Date("2026-08-23T00:00:00.000Z")), 3);
  assert.equal(calculateDaysInactive(null, "2026-08-20T00:00:00.000Z", new Date("2026-08-23T00:00:00.000Z")), 3);
});

test("MRR normalizes annual recurring charges and preserves monthly charges", () => {
  assert.equal(monthlyRecurringEquivalent(1_200_000, "YEARLY"), 100_000);
  assert.equal(monthlyRecurringEquivalent(80_000, "MONTHLY"), 80_000);
});

test("at-risk detection includes the three-day boundary and never-active tenants", () => {
  const asOf = new Date("2026-08-17T12:00:00.000Z");
  assert.equal(calculateDaysInactive(new Date("2026-08-14T12:00:00.000Z"), new Date("2026-01-01"), asOf), 3);
  assert.equal(calculateDaysInactive(null, new Date("2026-08-10T12:00:00.000Z"), asOf), 7);
});

test("activity ranking combines measured sessions and available page views", () => {
  assert.equal(activityScore(12, 30), 42);
  assert.equal(activityScore(12, null), 12);
});

test("platform module queries validate supported filters, sorting, and pagination", () => {
  const parsed = platformModulesQuerySchema.parse({ module: "HRIS", enabled: "true", plan: "ALL_IN_ONE", tenantStatus: "active", sortBy: "usage", sortOrder: "desc" });
  assert.deepEqual({ module: parsed.module, enabled: parsed.enabled, plan: parsed.plan, tenantStatus: parsed.tenantStatus }, { module: "hris", enabled: true, plan: "all-in-one", tenantStatus: "ACTIVE" });
  assert.equal(platformModulesQuerySchema.safeParse({ enabled: "true" }).success, false);
  assert.equal(platformModulesQuerySchema.safeParse({ module: "ALL_IN_ONE" }).success, false);
  assert.equal(platformModulesQuerySchema.safeParse({ sortBy: "rawSql" }).success, false);
  assert.equal(platformModulesQuerySchema.safeParse({ limit: 101 }).success, false);
});

test("bulk module updates reject duplicates and invalid or empty module sets", () => {
  assert.equal(platformModuleBulkUpdateSchema.safeParse({ modules: [{ module: "HRIS", enabled: true }, { module: "PAYROLL", enabled: false }], reason: "Subscription adjustment" }).success, true);
  assert.equal(platformModuleBulkUpdateSchema.safeParse({ modules: [{ module: "HRIS", enabled: true }, { module: "hris", enabled: false }], reason: "Duplicate" }).success, false);
  assert.equal(platformModuleBulkUpdateSchema.safeParse({ modules: [], reason: "Empty update" }).success, false);
  assert.equal(platformModuleBulkUpdateSchema.safeParse({ modules: [{ module: "ALL_IN_ONE", enabled: true }], reason: "Invalid module" }).success, false);
});

test("cumulative module usage counts user-module assignments, not unique users", () => {
  assert.equal(moduleUsageTotal({ hrisUsers: 45, payrollUsers: 28, accountingUsers: 0 }), 73);
});

test("module access middleware rejects direct Platform Administrator tenant access before querying entitlements", () => {
  let error: any;
  requireEffectiveModuleAccess("hris")({ user: { isPlatformAdmin: true } } as any, {} as any, (value?: unknown) => { error = value; });
  assert.equal(error?.statusCode, 403);
});

test("platform user listing validates search, filters, sorting, and pagination", () => {
  const parsed = platformUsersQuerySchema.parse({ page: "2", limit: "50", search: "  Amina Yusuf  ", tenantId: "tenant", roleId: "role", status: "active", sortBy: "tenantName", sortOrder: "asc" });
  assert.deepEqual({ page: parsed.page, limit: parsed.limit, search: parsed.search, status: parsed.status, sortBy: parsed.sortBy }, { page: 2, limit: 50, search: "Amina Yusuf", status: "ACTIVE", sortBy: "tenantName" });
  assert.equal(platformUsersQuerySchema.safeParse({ page: 0 }).success, false);
  assert.equal(platformUsersQuerySchema.safeParse({ limit: 101 }).success, false);
  assert.equal(platformUsersQuerySchema.safeParse({ search: "x" }).success, false);
  assert.equal(platformUsersQuerySchema.safeParse({ status: "SUSPENDED" }).success, false);
  assert.equal(platformUsersQuerySchema.safeParse({ sortBy: "passwordHash" }).success, false);
});

test("impersonation requires a bounded support reason", () => {
  assert.equal(impersonatePlatformUserSchema.safeParse({ reason: "Investigating reported access issue" }).success, true);
  assert.equal(impersonatePlatformUserSchema.safeParse({}).success, false);
  assert.equal(impersonatePlatformUserSchema.safeParse({ reason: "x" }).success, false);
});

test("impersonated sessions cannot perform sensitive mutations", () => {
  let error: any; let continued = false;
  restrictImpersonatedSensitiveActions({ user: { impersonation: { sessionId: "session", platformAdminUserId: "admin" } }, method: "POST", path: "/security/password-policy" } as any, {} as any, (value?: unknown) => { error = value; });
  assert.equal(error?.statusCode, 403);
  restrictImpersonatedSensitiveActions({ user: { impersonation: { sessionId: "session", platformAdminUserId: "admin" } }, method: "GET", path: "/security/policy" } as any, {} as any, () => { continued = true; });
  assert.equal(continued, true);
});

test("platform user status keeps inactive, locked, and suspended states distinct", () => {
  const now = new Date("2026-08-06T12:00:00.000Z");
  assert.equal(platformUserRowStatus({ isActive: false, lockedUntil: null, organization: { status: "ACTIVE" } }, now), "INACTIVE");
  assert.equal(platformUserRowStatus({ isActive: true, lockedUntil: new Date("2026-08-06T13:00:00.000Z"), organization: { status: "ACTIVE" } }, now), "LOCKED");
  assert.equal(platformUserRowStatus({ isActive: true, lockedUntil: null, organization: { status: "SUSPENDED" } }, now), "SUSPENDED");
  assert.equal(platformUserRowStatus({ isActive: true, lockedUntil: new Date("2026-08-06T11:00:00.000Z"), organization: { status: "ACTIVE" } }, now), "ACTIVE");
});

test("module access intersects role permissions with active tenant modules", () => {
  assert.deepEqual(effectivePlatformUserModules(["hris:employees:view", "payroll:runs:view", "admin:roles:view"], new Set(["hris", "accounting"])), ["HRIS"]);
  assert.deepEqual(effectivePlatformUserModules(["accounting:payments:view"], new Set()), []);
});

test("platform billing validates dates, pagination, filters, sorting, periods, and money", () => {
  assert.equal(billingDateFilterSchema.safeParse({ startDate: "2026-08-02", endDate: "2026-08-01" }).success, false);
  assert.equal(invoiceListQuerySchema.safeParse({ page: 0 }).success, false);
  assert.equal(invoiceListQuerySchema.safeParse({ status: "SENT" }).success, false);
  assert.equal(invoiceListQuerySchema.safeParse({ sortBy: "rawSql" }).success, false);
  assert.equal(invoiceListQuerySchema.safeParse({ billingPeriod: "2026-13" }).success, false);
  assert.equal(invoiceListQuerySchema.safeParse({ period: "2026-07" }).success, true);
  assert.equal(invoiceListQuerySchema.safeParse({ period: "2026-07", billingPeriod: "2026-08" }).success, false);
  assert.equal(createPlatformInvoiceSchema.safeParse({ tenantId: "tenant", billingPeriod: "2026-07", amount: 500000.25 }).success, true);
  assert.equal(createPlatformInvoiceSchema.parse({ tenantId: "tenant", period: "2026-08", amount: 185000 }).billingPeriod, "2026-08");
  assert.equal(createPlatformInvoiceSchema.safeParse({ tenantId: "tenant", billingPeriod: "2026-07", amount: 0 }).success, false);
  assert.equal(createPlatformInvoiceSchema.safeParse({ tenantId: "tenant", billingPeriod: "2026-07", amount: 1.001 }).success, false);
  assert.equal(createPlatformInvoiceSchema.safeParse({ tenantId: "tenant", billingPeriod: "2026-07", amount: 10, invoiceNumber: "untrusted" }).success, false);
});

test("billing formulas and reminder eligibility follow the fixed-price model", () => {
  assert.equal(annualRecurringRevenue(320000), 3840000);
  assert.equal(churnRatePercentage(20, 3), 15);
  assert.equal(churnRatePercentage(0, 3), 0);
  assert.equal(invoiceReminderEligible("OVERDUE"), true);
  assert.equal(invoiceReminderEligible("DRAFT"), false);
  assert.equal(invoiceReminderEligible("PAID"), false);
  const numbers = new Set(Array.from({ length: 100 }, () => createPlatformInvoiceNumber("2026-08")));
  assert.equal(numbers.size, 100);
  for (const number of numbers) assert.match(number, /^SINV-202608-[A-F0-9]{10}$/);
});

test("invoice export accepts the listing filters without pagination", () => {
  const result = invoiceExportQuerySchema.parse({ search: "Acme", status: "OVERDUE", tenantId: "tenant", period: "2026-07", sortBy: "tenantName", sortOrder: "asc" });
  assert.deepEqual({ status: result.status, sortBy: result.sortBy, sortOrder: result.sortOrder }, { status: "OVERDUE", sortBy: "tenantName", sortOrder: "asc" });
  assert.equal(invoiceExportQuerySchema.safeParse({ page: 1 }).success, false);
});

test("CSV export neutralizes formulas and escapes quotes and newlines", () => {
  assert.equal(sanitizeCsvCell("=HYPERLINK(\"https://bad.test\")"), '"\'=HYPERLINK(""https://bad.test"")"');
  assert.equal(sanitizeCsvCell("+SUM(A1:A2)"), '"\'+SUM(A1:A2)"');
  assert.equal(sanitizeCsvCell("-10"), '"\'-10"');
  assert.equal(sanitizeCsvCell("@command"), '"\'@command"');
  assert.equal(sanitizeCsvCell("Acme\nLimited"), '"Acme Limited"');
});

test("pricing queries and mutations enforce bounded filters, precision, and effective dates", () => {
  assert.equal(platformPricingQuerySchema.safeParse({ page: 1, limit: 20, sortBy: "monthlyRevenue", sortOrder: "desc" }).success, true);
  assert.equal(platformPricingQuerySchema.safeParse({ pricingModel: "BASE_PLUS_PER_EMPLOYEE" }).success, false);
  assert.equal(platformPricingQuerySchema.safeParse({ limit: 101 }).success, false);
  assert.equal(updatePlatformPriceSchema.safeParse({ baseMonthlyPrice: 90000.25 }).success, true);
  assert.equal(updatePlatformPriceSchema.safeParse({ monthlyPrice: 1.001, reason: "Invalid precision", effectiveAt: "2026-08-01T00:00:00.000Z" }).success, false);
});

test("tenant creation validates modular plans, email, country, and strict fields", () => {
  assert.equal(createPlatformTenantSchema.safeParse({ companyName: "Acme", adminEmail: "admin@acme.test", subscriptionPlan: "ALL_IN_ONE", country: "NG" }).success, true);
  assert.equal(createPlatformTenantSchema.safeParse({ companyName: "Acme", adminEmail: "admin@acme.test", subscriptionPlan: "HRIS", country: "NG", seatAllocation: 20 }).success, false);
  assert.equal(createPlatformTenantSchema.safeParse({ companyName: "Acme", adminEmail: "invalid", subscriptionPlan: "STARTER", country: "NG" }).success, false);
  assert.equal(createPlatformTenantSchema.safeParse({ companyName: "Acme", adminEmail: "admin@acme.test", subscriptionPlan: "HRIS", country: "ZZ" }).success, false);
});

test("module toggles, plan overrides, and support filters reject invalid values", () => {
  assert.equal(platformModuleToggleSchema.safeParse({ enabled: true }).success, true);
  assert.equal(platformModuleToggleSchema.safeParse({ enabled: "yes" }).success, false);
  assert.equal(overridePlatformTenantPlanSchema.safeParse({ plan: "accounting", effectiveDate: "2026-08-01T00:00:00+01:00" }).success, true);
  assert.equal(overridePlatformTenantPlanSchema.safeParse({ plan: "hris", seatAllocation: 20 }).success, false);
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
