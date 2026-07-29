import { Router } from "express";
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
  createPlatformPricingPlanController,
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
} from "./platform-admin.controller";
import {
  createPlatformTenantSchema,
  createPlatformPricingPlanSchema,
  overridePlatformTenantPlanSchema,
  platformDashboardQuerySchema,
  platformModuleToggleSchema,
  platformPricingModuleParamsSchema,
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
  updatePlatformPriceSchema
} from "./platform-admin.validation";

export const platformAdminRouter = Router();
const dashboardPermission = authorize("platform:dashboard:view");

// An impersonated tenant user is intentionally not a Platform Admin. This
// endpoint validates the signed impersonation session and restores the actor.
platformAdminRouter.post("/impersonation/exit", asyncHandler(exitPlatformTenantImpersonationController));
platformAdminRouter.use(requirePlatformAdmin);

platformAdminRouter.get("/dashboard", dashboardPermission, validate({ query: platformDashboardQuerySchema }), asyncHandler(getPlatformDashboardController));
platformAdminRouter.get("/pricing", authorize("platform:pricing:view"), validate({ query: platformPricingQuerySchema }), asyncHandler(getPlatformPricingOverviewController));
platformAdminRouter.patch("/pricing/modules/:moduleId/price", authorize("platform:pricing:manage"), validate({ params: platformPricingModuleParamsSchema, body: updatePlatformPriceSchema }), asyncHandler(updatePlatformModulePriceController));
platformAdminRouter.post("/pricing/plans", authorize("platform:pricing:manage"), validate({ body: createPlatformPricingPlanSchema }), asyncHandler(createPlatformPricingPlanController));
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
