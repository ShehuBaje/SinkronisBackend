import { Router } from "express";
import rateLimit from "express-rate-limit";
import { asyncHandler } from "../../core/async-handler";
import { validate } from "../../core/validate";
import { authorize } from "../../middleware/rbac.middleware";
import { requirePlatformAdmin } from "../../middleware/platform-admin.middleware";
import {
  activatePlatformTenantController,
  createPlatformTenantController,
  deactivatePlatformTenantUserController,
  exitPlatformTenantImpersonationController,
  getPlatformDashboardController,
  getPlatformPricingOverviewController,
  getPlatformTenantActivityController,
  getPlatformTenantBillingController,
  getPlatformTenantDetailsController,
  getPlatformTenantModulesController,
  getPlatformTenantOverviewController,
  getPlatformTenantSupportTicketsController,
  getPlatformTenantsController,
  getPlatformTenantUsersController,
  impersonatePlatformTenantAdminController,
  overridePlatformTenantPlanController,
  resetPlatformTenantUserPasswordController,
  suspendPlatformTenantController,
  togglePlatformTenantModuleController,
  updatePlatformModulePriceController
  ,getBillingOverviewController, getBillingAnalyticsController, getRevenueByPlanController, listPlatformInvoicesController, createPlatformInvoiceController, sendInvoiceReminderController, downloadPlatformInvoiceController, exportPlatformInvoicesController
  ,getPlatformUsersController, getPlatformUserAnalyticsController, getPlatformUserFilterOptionsController, deactivatePlatformUserController, resetPlatformUserPasswordController, impersonatePlatformUserController
  ,getPlatformModulesOverviewController, getPlatformModuleAnalyticsController, getPlatformModuleTenantsController, getPlatformModuleTenantController, updatePlatformTenantModulesController, enablePlatformTenantModuleController, disablePlatformTenantModuleController
  ,getPlatformAnalyticsController, sendAtRiskTenantCheckInController
  ,listPlatformSupportTicketsController, getPlatformSupportTicketController, createPlatformSupportTicketController, assignPlatformSupportTicketController, updatePlatformSupportResolutionNotesController, updatePlatformSupportTicketStatusController, resolvePlatformSupportTicketController
  ,getPlatformSettingsController, getPlatformConfigurationController, updatePlatformConfigurationController, getPlatformPasswordPolicyController, updatePlatformPasswordPolicyController, getPlatformFeatureFlagsController, updatePlatformFeatureFlagController, getPlatformEmailTemplatesController, getPlatformEmailTemplateController, updatePlatformEmailTemplateController, getPlatformMaintenanceModeController, updatePlatformMaintenanceModeController
} from "./platform-admin.controller";
import {
  createPlatformTenantSchema,
  overridePlatformTenantPlanSchema,
  platformDashboardQuerySchema,
  platformModuleToggleSchema,
  platformPricingModuleParamsSchema,
  platformPricingPlanParamsSchema,
  platformPricingQuerySchema,
  platformTenantActivityQuerySchema,
  platformTenantBillingQuerySchema,
  platformTenantListQuerySchema,
  platformTenantModuleParamsSchema,
  platformTenantParamsSchema,
  platformTenantSupportQuerySchema,
  platformTenantUserParamsSchema,
  platformTenantUsersQuerySchema,
  suspendPlatformTenantSchema,
  updatePlatformPriceSchema,
  platformEmailTemplateParamsSchema, platformFeatureFlagParamsSchema, updateMaintenanceModeSchema, updatePlatformConfigurationSchema, updatePlatformEmailTemplateSchema, updatePlatformFeatureFlagSchema, updatePlatformPasswordPolicySchema,
  billingDateFilterSchema, createPlatformInvoiceSchema, invoiceExportQuerySchema, invoiceListQuerySchema, invoiceParamsSchema,
  impersonatePlatformUserSchema, platformUserParamsSchema, platformUsersQuerySchema,
  platformModuleActionParamsSchema, platformModuleBulkUpdateSchema, platformModuleReasonSchema, platformModulesQuerySchema, platformModuleTenantParamsSchema,
  analyticsTenantParamsSchema, platformAnalyticsQuerySchema,
  assignSupportTicketSchema, createSupportTicketSchema, supportTicketListQuerySchema, supportTicketParamsSchema, updateResolutionNotesSchema, updateSupportTicketStatusSchema
} from "./platform-admin.validation";

export const platformAdminRouter = Router();
const dashboardPermission = authorize("platform:dashboard:view");

// An impersonated tenant user is intentionally not a Platform Admin. This
// endpoint validates the signed impersonation session and restores the actor.
platformAdminRouter.post("/impersonation/exit", asyncHandler(exitPlatformTenantImpersonationController));
platformAdminRouter.post("/impersonation/stop", asyncHandler(exitPlatformTenantImpersonationController));
platformAdminRouter.use(requirePlatformAdmin);

platformAdminRouter.get("/dashboard", dashboardPermission, validate({ query: platformDashboardQuerySchema }), asyncHandler(getPlatformDashboardController));
platformAdminRouter.get("/pricing", authorize("platform:pricing:view"), validate({ query: platformPricingQuerySchema }), asyncHandler(getPlatformPricingOverviewController));
platformAdminRouter.patch("/pricing/modules/:moduleId/price", authorize("platform:pricing:manage"), validate({ params: platformPricingModuleParamsSchema, body: updatePlatformPriceSchema }), asyncHandler(updatePlatformModulePriceController));
platformAdminRouter.patch("/pricing/:planCode", authorize("platform:pricing:manage"), validate({ params: platformPricingPlanParamsSchema, body: updatePlatformPriceSchema }), asyncHandler(updatePlatformModulePriceController));
const billingRead = authorize("platform:dashboard:view");
const billingManage = authorize("platform:tenants:billing:manage");
const sensitiveBillingLimit = rateLimit({ windowMs: 15 * 60 * 1000, limit: 20, standardHeaders: true, legacyHeaders: false });
platformAdminRouter.get("/billing", billingRead, validate({ query: invoiceListQuerySchema }), asyncHandler(getBillingOverviewController));
platformAdminRouter.get("/billing/analytics", billingRead, validate({ query: billingDateFilterSchema }), asyncHandler(getBillingAnalyticsController));
platformAdminRouter.get("/billing/revenue-by-plan", billingRead, validate({ query: billingDateFilterSchema }), asyncHandler(getRevenueByPlanController));
platformAdminRouter.get("/billing/invoices/export", billingRead, sensitiveBillingLimit, validate({ query: invoiceExportQuerySchema }), asyncHandler(exportPlatformInvoicesController));
platformAdminRouter.get("/billing/export", billingRead, sensitiveBillingLimit, validate({ query: invoiceExportQuerySchema }), asyncHandler(exportPlatformInvoicesController));
platformAdminRouter.get("/billing/invoices", billingRead, validate({ query: invoiceListQuerySchema }), asyncHandler(listPlatformInvoicesController));
platformAdminRouter.post("/billing/invoices", billingManage, validate({ body: createPlatformInvoiceSchema }), asyncHandler(createPlatformInvoiceController));
platformAdminRouter.post("/billing/invoices/:invoiceId/reminder", billingManage, sensitiveBillingLimit, validate({ params: invoiceParamsSchema }), asyncHandler(sendInvoiceReminderController));
platformAdminRouter.get("/billing/invoices/:invoiceId/download", billingRead, validate({ params: invoiceParamsSchema }), asyncHandler(downloadPlatformInvoiceController));
const userActionLimit = rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: true, legacyHeaders: false });
platformAdminRouter.get("/users", authorize("platform:users:read"), validate({ query: platformUsersQuerySchema }), asyncHandler(getPlatformUsersController));
platformAdminRouter.get("/users/analytics", authorize("platform:users:read"), asyncHandler(getPlatformUserAnalyticsController));
platformAdminRouter.get("/users/filter-options", authorize("platform:users:read"), asyncHandler(getPlatformUserFilterOptionsController));
platformAdminRouter.patch("/users/:userId/deactivate", authorize("platform:users:deactivate"), validate({ params: platformUserParamsSchema }), asyncHandler(deactivatePlatformUserController));
platformAdminRouter.post("/users/:userId/reset-password", authorize("platform:users:reset-password"), userActionLimit, validate({ params: platformUserParamsSchema }), asyncHandler(resetPlatformUserPasswordController));
platformAdminRouter.post("/users/:userId/impersonate", authorize("platform:users:impersonate"), userActionLimit, validate({ params: platformUserParamsSchema, body: impersonatePlatformUserSchema }), asyncHandler(impersonatePlatformUserController));
platformAdminRouter.get("/modules", authorize("platform:modules:read"), validate({ query: platformModulesQuerySchema }), asyncHandler(getPlatformModulesOverviewController));
platformAdminRouter.get("/modules/analytics", authorize("platform:modules:read"), asyncHandler(getPlatformModuleAnalyticsController));
platformAdminRouter.get("/modules/tenants", authorize("platform:modules:read"), validate({ query: platformModulesQuerySchema }), asyncHandler(getPlatformModuleTenantsController));
platformAdminRouter.get("/modules/tenants/:tenantId", authorize("platform:modules:read"), validate({ params: platformModuleTenantParamsSchema }), asyncHandler(getPlatformModuleTenantController));
platformAdminRouter.patch("/modules/tenants/:tenantId", authorize("platform:modules:manage"), validate({ params: platformModuleTenantParamsSchema, body: platformModuleBulkUpdateSchema }), asyncHandler(updatePlatformTenantModulesController));
platformAdminRouter.patch("/modules/tenants/:tenantId/:module/enable", authorize("platform:modules:manage"), validate({ params: platformModuleActionParamsSchema, body: platformModuleReasonSchema }), asyncHandler(enablePlatformTenantModuleController));
platformAdminRouter.patch("/modules/tenants/:tenantId/:module/disable", authorize("platform:modules:manage"), validate({ params: platformModuleActionParamsSchema, body: platformModuleReasonSchema }), asyncHandler(disablePlatformTenantModuleController));
const analyticsCheckInLimit = rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: true, legacyHeaders: false });
platformAdminRouter.get("/analytics", authorize("platform:analytics:read"), validate({ query: platformAnalyticsQuerySchema }), asyncHandler(getPlatformAnalyticsController));
platformAdminRouter.post("/analytics/at-risk/:tenantId/check-in", authorize("platform:analytics:check-in"), analyticsCheckInLimit, validate({ params: analyticsTenantParamsSchema }), asyncHandler(sendAtRiskTenantCheckInController));
platformAdminRouter.get("/support/tickets", authorize("platform:support:read"), validate({ query: supportTicketListQuerySchema }), asyncHandler(listPlatformSupportTicketsController));
platformAdminRouter.post("/support/tickets", authorize("platform:support:manage"), validate({ body: createSupportTicketSchema }), asyncHandler(createPlatformSupportTicketController));
platformAdminRouter.get("/support/tickets/:ticketId", authorize("platform:support:read"), validate({ params: supportTicketParamsSchema }), asyncHandler(getPlatformSupportTicketController));
platformAdminRouter.patch("/support/tickets/:ticketId/assign", authorize("platform:support:manage"), validate({ params: supportTicketParamsSchema, body: assignSupportTicketSchema }), asyncHandler(assignPlatformSupportTicketController));
platformAdminRouter.patch("/support/tickets/:ticketId/resolution-notes", authorize("platform:support:manage"), validate({ params: supportTicketParamsSchema, body: updateResolutionNotesSchema }), asyncHandler(updatePlatformSupportResolutionNotesController));
platformAdminRouter.patch("/support/tickets/:ticketId/status", authorize("platform:support:manage"), validate({ params: supportTicketParamsSchema, body: updateSupportTicketStatusSchema }), asyncHandler(updatePlatformSupportTicketStatusController));
platformAdminRouter.patch("/support/tickets/:ticketId/resolve", authorize("platform:support:manage"), validate({ params: supportTicketParamsSchema }), asyncHandler(resolvePlatformSupportTicketController));
platformAdminRouter.get("/settings", authorize("platform:settings:read"), asyncHandler(getPlatformSettingsController));
platformAdminRouter.get("/settings/configuration", authorize("platform:settings:read"), asyncHandler(getPlatformConfigurationController));
platformAdminRouter.patch("/settings/configuration", authorize("platform:settings:manage"), validate({ body: updatePlatformConfigurationSchema }), asyncHandler(updatePlatformConfigurationController));
platformAdminRouter.get("/settings/password-policy", authorize("platform:settings:read"), asyncHandler(getPlatformPasswordPolicyController));
platformAdminRouter.patch("/settings/password-policy", authorize("platform:settings:manage"), validate({ body: updatePlatformPasswordPolicySchema }), asyncHandler(updatePlatformPasswordPolicyController));
platformAdminRouter.get("/settings/feature-flags", authorize("platform:settings:read"), asyncHandler(getPlatformFeatureFlagsController));
platformAdminRouter.patch("/settings/feature-flags/:key", authorize("platform:settings:manage"), validate({ params: platformFeatureFlagParamsSchema, body: updatePlatformFeatureFlagSchema }), asyncHandler(updatePlatformFeatureFlagController));
platformAdminRouter.get("/settings/email-templates", authorize("platform:settings:read"), asyncHandler(getPlatformEmailTemplatesController));
platformAdminRouter.get("/settings/email-templates/:key", authorize("platform:settings:read"), validate({ params: platformEmailTemplateParamsSchema }), asyncHandler(getPlatformEmailTemplateController));
platformAdminRouter.patch("/settings/email-templates/:key", authorize("platform:settings:manage"), validate({ params: platformEmailTemplateParamsSchema, body: updatePlatformEmailTemplateSchema }), asyncHandler(updatePlatformEmailTemplateController));
platformAdminRouter.get("/settings/maintenance", authorize("platform:settings:read"), asyncHandler(getPlatformMaintenanceModeController));
platformAdminRouter.patch("/settings/maintenance", authorize("platform:settings:manage"), validate({ body: updateMaintenanceModeSchema }), asyncHandler(updatePlatformMaintenanceModeController));
platformAdminRouter.post("/tenants", authorize("platform:tenants:create"), validate({ body: createPlatformTenantSchema }), asyncHandler(createPlatformTenantController));
platformAdminRouter.get("/tenants", authorize("platform:tenants:view"), validate({ query: platformTenantListQuerySchema }), asyncHandler(getPlatformTenantsController));
platformAdminRouter.get("/tenants/:tenantId", authorize("platform:tenants:view"), validate({ params: platformTenantParamsSchema }), asyncHandler(getPlatformTenantDetailsController));
platformAdminRouter.get("/tenants/:tenantId/overview", authorize("platform:tenants:view"), validate({ params: platformTenantParamsSchema }), asyncHandler(getPlatformTenantOverviewController));
platformAdminRouter.get("/tenants/:tenantId/users", authorize("platform:tenants:view"), validate({ params: platformTenantParamsSchema, query: platformTenantUsersQuerySchema }), asyncHandler(getPlatformTenantUsersController));
platformAdminRouter.patch("/tenants/:tenantId/users/:userId/deactivate", authorize("platform:tenants:users:manage"), validate({ params: platformTenantUserParamsSchema }), asyncHandler(deactivatePlatformTenantUserController));
platformAdminRouter.post("/tenants/:tenantId/users/:userId/reset-password", authorize("platform:tenants:users:manage"), validate({ params: platformTenantUserParamsSchema }), asyncHandler(resetPlatformTenantUserPasswordController));
platformAdminRouter.get("/tenants/:tenantId/modules", authorize("platform:tenants:view"), validate({ params: platformTenantParamsSchema }), asyncHandler(getPlatformTenantModulesController));
platformAdminRouter.patch("/tenants/:tenantId/modules/:moduleId", authorize("platform:tenants:modules:manage"), validate({ params: platformTenantModuleParamsSchema, body: platformModuleToggleSchema }), asyncHandler(togglePlatformTenantModuleController));
platformAdminRouter.get("/tenants/:tenantId/billing", authorize("platform:tenants:view"), validate({ params: platformTenantParamsSchema, query: platformTenantBillingQuerySchema }), asyncHandler(getPlatformTenantBillingController));
platformAdminRouter.patch("/tenants/:tenantId/subscription/override", authorize("platform:tenants:billing:manage"), validate({ params: platformTenantParamsSchema, body: overridePlatformTenantPlanSchema }), asyncHandler(overridePlatformTenantPlanController));
platformAdminRouter.get("/tenants/:tenantId/activity", authorize("platform:tenants:view"), validate({ params: platformTenantParamsSchema, query: platformTenantActivityQuerySchema }), asyncHandler(getPlatformTenantActivityController));
platformAdminRouter.get("/tenants/:tenantId/support-tickets", authorize("platform:tenants:view"), validate({ params: platformTenantParamsSchema, query: platformTenantSupportQuerySchema }), asyncHandler(getPlatformTenantSupportTicketsController));
platformAdminRouter.post("/tenants/:tenantId/impersonate", authorize("platform:tenants:impersonate"), validate({ params: platformTenantParamsSchema }), asyncHandler(impersonatePlatformTenantAdminController));
platformAdminRouter.patch("/tenants/:tenantId/suspend", authorize("platform:tenants:suspend"), validate({ params: platformTenantParamsSchema, body: suspendPlatformTenantSchema }), asyncHandler(suspendPlatformTenantController));
platformAdminRouter.patch("/tenants/:tenantId/activate", authorize("platform:tenants:suspend"), validate({ params: platformTenantParamsSchema }), asyncHandler(activatePlatformTenantController));
