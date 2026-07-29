import type { Request, Response } from "express";
import { sendSuccess } from "../../core/api-response";
import {
  activatePlatformTenant,
  createPlatformTenant,
  deactivatePlatformTenantUser,
  exitPlatformTenantImpersonation,
  getPlatformDashboard,
  getPlatformTenantActivity,
  getPlatformTenantBilling,
  getPlatformTenantCompleteDetails,
  getPlatformTenantModules,
  getPlatformTenantOverview,
  getPlatformTenantSupportTickets,
  getPlatformTenants,
  getPlatformTenantUsers,
  impersonatePlatformTenantAdmin,
  createPlatformPricingPlan,
  getPlatformPricingOverview,
  overridePlatformTenantPlan,
  resetPlatformTenantUserPassword,
  suspendPlatformTenant,
  togglePlatformTenantModule,
  updatePlatformModulePrice
} from "./platform-admin.service";

export const getPlatformDashboardController = async (req: Request, res: Response) =>
  sendSuccess(res, "Platform dashboard retrieved", await getPlatformDashboard(req.query, req.user!));

export const getPlatformTenantsController = async (req: Request, res: Response) => {
  const result = await getPlatformTenants(req.query, req.user!);
  return sendSuccess(res, "Tenants retrieved", result.data, { metadata: result.metadata, pagination: result.pagination });
};

export const createPlatformTenantController = async (req: Request, res: Response) =>
  sendSuccess(res, "Tenant created", await createPlatformTenant(req.body, req.user!), { status: 201 });

export const getPlatformTenantDetailsController = async (req: Request, res: Response) =>
  sendSuccess(res, "Tenant details retrieved", await getPlatformTenantCompleteDetails(String(req.params.tenantId), req.user!));

export const getPlatformTenantOverviewController = async (req: Request, res: Response) =>
  sendSuccess(res, "Tenant overview retrieved", await getPlatformTenantOverview(String(req.params.tenantId), req.user!));

export const suspendPlatformTenantController = async (req: Request, res: Response) =>
  sendSuccess(res, "Tenant suspended", await suspendPlatformTenant(String(req.params.tenantId), req.body, req.user!));

export const activatePlatformTenantController = async (req: Request, res: Response) =>
  sendSuccess(res, "Tenant activated", await activatePlatformTenant(String(req.params.tenantId), req.user!));

export const getPlatformTenantUsersController = async (req: Request, res: Response) => {
  const result = await getPlatformTenantUsers(String(req.params.tenantId), req.query, req.user!);
  return sendSuccess(res, "Tenant users retrieved", { totalUsers: result.totalUsers, users: result.data }, { pagination: result.pagination });
};

export const deactivatePlatformTenantUserController = async (req: Request, res: Response) =>
  sendSuccess(res, "Tenant user deactivated", await deactivatePlatformTenantUser(String(req.params.tenantId), String(req.params.userId), req.user!));

export const resetPlatformTenantUserPasswordController = async (req: Request, res: Response) =>
  sendSuccess(res, "Password reset initiated", await resetPlatformTenantUserPassword(String(req.params.tenantId), String(req.params.userId), req.user!));

export const getPlatformTenantModulesController = async (req: Request, res: Response) =>
  sendSuccess(res, "Tenant modules retrieved", await getPlatformTenantModules(String(req.params.tenantId), req.user!));

export const togglePlatformTenantModuleController = async (req: Request, res: Response) =>
  sendSuccess(res, "Tenant module updated", await togglePlatformTenantModule(String(req.params.tenantId), req.params.moduleId as never, req.body, req.user!));

export const getPlatformTenantBillingController = async (req: Request, res: Response) => {
  const result = await getPlatformTenantBilling(String(req.params.tenantId), req.query, req.user!);
  return sendSuccess(res, "Tenant billing retrieved", { currentSubscription: result.currentSubscription, invoices: result.invoices }, { pagination: result.pagination });
};

export const overridePlatformTenantPlanController = async (req: Request, res: Response) =>
  sendSuccess(res, "Tenant subscription overridden", await overridePlatformTenantPlan(String(req.params.tenantId), req.body, req.user!));

export const getPlatformTenantActivityController = async (req: Request, res: Response) => {
  const result = await getPlatformTenantActivity(String(req.params.tenantId), req.query, req.user!);
  return sendSuccess(res, "Tenant activity retrieved", result.data, { pagination: result.pagination });
};

export const getPlatformTenantSupportTicketsController = async (req: Request, res: Response) => {
  const result = await getPlatformTenantSupportTickets(String(req.params.tenantId), req.query, req.user!);
  return sendSuccess(res, "Tenant support tickets retrieved", result.data, { pagination: result.pagination });
};

export const impersonatePlatformTenantAdminController = async (req: Request, res: Response) =>
  sendSuccess(res, "Impersonation session started", await impersonatePlatformTenantAdmin(String(req.params.tenantId), req.user!, {
    ipAddress: req.ip,
    userAgent: req.get("user-agent") ?? null
  }));

export const exitPlatformTenantImpersonationController = async (req: Request, res: Response) =>
  sendSuccess(res, "Impersonation session ended", await exitPlatformTenantImpersonation(req.user!));

export const getPlatformPricingOverviewController = async (req: Request, res: Response) =>
  sendSuccess(res, "Pricing and plans retrieved successfully", await getPlatformPricingOverview(req.query, req.user!));

export const updatePlatformModulePriceController = async (req: Request, res: Response) =>
  sendSuccess(res, "Price change recorded successfully", await updatePlatformModulePrice(String(req.params.moduleId), req.body, req.user!, {
    ipAddress: req.ip,
    requestId: req.header("x-request-id") ?? null
  }));

export const createPlatformPricingPlanController = async (req: Request, res: Response) =>
  sendSuccess(res, "Subscription plan created successfully", await createPlatformPricingPlan(req.body, req.user!, {
    ipAddress: req.ip,
    requestId: req.header("x-request-id") ?? null
  }), { status: 201 });
