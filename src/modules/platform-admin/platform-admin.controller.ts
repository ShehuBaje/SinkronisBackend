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
  getPlatformPricingOverview,
  overridePlatformTenantPlan,
  resetPlatformTenantUserPassword,
  suspendPlatformTenant,
  togglePlatformTenantModule,
  updatePlatformModulePrice
} from "./platform-admin.service";
import {
  createPlatformInvoice, downloadPlatformInvoice, exportPlatformInvoices, getBillingAnalytics, getBillingOverview, getRevenueByPlan, listPlatformInvoices, sendInvoiceReminder,
  deactivatePlatformUser, getPlatformUserAnalytics, getPlatformUserFilterOptions, getPlatformUsers, impersonatePlatformUser, resetPlatformUserPassword,
  getPlatformModuleAnalytics, getPlatformModulesOverview, getPlatformModuleTenant, getPlatformModuleTenants, setPlatformTenantModule, updatePlatformTenantModules,
  getPlatformAnalytics, sendAtRiskTenantCheckIn,
  assignPlatformSupportTicket,
  createPlatformSupportTicket,
  getPlatformSupportTicket,
  listPlatformSupportTickets,
  resolvePlatformSupportTicket,
  updatePlatformSupportResolutionNotes,
  updatePlatformSupportTicketStatus
} from "./platform-admin.service";
import {
  getPlatformConfiguration, getPlatformEmailTemplate, getPlatformEmailTemplates, getPlatformFeatureFlags,
  getPlatformMaintenanceMode, getPlatformPasswordPolicy, getPlatformSettings, updatePlatformConfiguration,
  updatePlatformEmailTemplate, updatePlatformFeatureFlag, updatePlatformMaintenanceMode, updatePlatformPasswordPolicy
} from "./platform-admin.service";
import type { PlatformEmailTemplateKey, PlatformFeatureFlagKey } from "./platform-admin.interface";

export const getPlatformSettingsController = async (req: Request, res: Response) => sendSuccess(res, "Platform settings retrieved", await getPlatformSettings(req.user!));
export const getPlatformConfigurationController = async (req: Request, res: Response) => sendSuccess(res, "Platform configuration retrieved", await getPlatformConfiguration(req.user!));
export const updatePlatformConfigurationController = async (req: Request, res: Response) => sendSuccess(res, "Platform configuration updated", await updatePlatformConfiguration(req.body, req.user!));
export const getPlatformPasswordPolicyController = async (req: Request, res: Response) => sendSuccess(res, "Platform password policy retrieved", await getPlatformPasswordPolicy(req.user!));
export const updatePlatformPasswordPolicyController = async (req: Request, res: Response) => sendSuccess(res, "Platform password policy updated", await updatePlatformPasswordPolicy(req.body, req.user!));
export const getPlatformFeatureFlagsController = async (req: Request, res: Response) => sendSuccess(res, "Platform feature flags retrieved", await getPlatformFeatureFlags(req.user!));
export const updatePlatformFeatureFlagController = async (req: Request, res: Response) => sendSuccess(res, "Platform feature flag updated", await updatePlatformFeatureFlag(req.params.key as PlatformFeatureFlagKey, req.body, req.user!));
export const getPlatformEmailTemplatesController = async (req: Request, res: Response) => sendSuccess(res, "Platform email templates retrieved", await getPlatformEmailTemplates(req.user!));
export const getPlatformEmailTemplateController = async (req: Request, res: Response) => sendSuccess(res, "Platform email template retrieved", await getPlatformEmailTemplate(req.params.key as PlatformEmailTemplateKey, req.user!));
export const updatePlatformEmailTemplateController = async (req: Request, res: Response) => sendSuccess(res, "Platform email template updated", await updatePlatformEmailTemplate(req.params.key as PlatformEmailTemplateKey, req.body, req.user!));
export const getPlatformMaintenanceModeController = async (req: Request, res: Response) => sendSuccess(res, "Platform maintenance mode retrieved", await getPlatformMaintenanceMode(req.user!));
export const updatePlatformMaintenanceModeController = async (req: Request, res: Response) => sendSuccess(res, "Platform maintenance mode updated", await updatePlatformMaintenanceMode(req.body, req.user!));

export const listPlatformSupportTicketsController = async (req: Request, res: Response) => {
  const result = await listPlatformSupportTickets(req.query, req.user!);
  return sendSuccess(res, "Support tickets retrieved successfully", result.data, { pagination: result.pagination });
};
export const getPlatformSupportTicketController = async (req: Request, res: Response) =>
  sendSuccess(res, "Support ticket fetched successfully", await getPlatformSupportTicket(String(req.params.ticketId), req.user!));
export const createPlatformSupportTicketController = async (req: Request, res: Response) =>
  sendSuccess(res, "Support ticket created successfully", await createPlatformSupportTicket(req.body, req.user!), { status: 201 });
export const assignPlatformSupportTicketController = async (req: Request, res: Response) =>
  sendSuccess(res, "Support ticket assigned successfully", await assignPlatformSupportTicket(String(req.params.ticketId), req.body, req.user!));
export const updatePlatformSupportResolutionNotesController = async (req: Request, res: Response) =>
  sendSuccess(res, "Resolution notes updated successfully", await updatePlatformSupportResolutionNotes(String(req.params.ticketId), req.body, req.user!));
export const updatePlatformSupportTicketStatusController = async (req: Request, res: Response) =>
  sendSuccess(res, "Support ticket status updated successfully", await updatePlatformSupportTicketStatus(String(req.params.ticketId), req.body, req.user!));
export const resolvePlatformSupportTicketController = async (req: Request, res: Response) =>
  sendSuccess(res, "Support ticket resolved successfully", await resolvePlatformSupportTicket(String(req.params.ticketId), req.user!));

export const getPlatformAnalyticsController = async (req: Request, res: Response) => sendSuccess(res, "Platform analytics retrieved", await getPlatformAnalytics(req.query, req.user!));
export const sendAtRiskTenantCheckInController = async (req: Request, res: Response) => sendSuccess(res, "Tenant check-in sent", await sendAtRiskTenantCheckIn(String(req.params.tenantId), req.user!));

export const getPlatformModulesOverviewController = async (req: Request, res: Response) => sendSuccess(res, "Module management retrieved", await getPlatformModulesOverview(req.query, req.user!));
export const getPlatformModuleAnalyticsController = async (req: Request, res: Response) => sendSuccess(res, "Module analytics retrieved", await getPlatformModuleAnalytics(req.user!));
export const getPlatformModuleTenantsController = async (req: Request, res: Response) => sendSuccess(res, "Tenant module configurations retrieved", await getPlatformModuleTenants(req.query, req.user!));
export const getPlatformModuleTenantController = async (req: Request, res: Response) => sendSuccess(res, "Tenant module configuration retrieved", await getPlatformModuleTenant(String(req.params.tenantId), req.user!));
export const updatePlatformTenantModulesController = async (req: Request, res: Response) => sendSuccess(res, "Tenant modules updated", await updatePlatformTenantModules(String(req.params.tenantId), req.body, req.user!));
export const enablePlatformTenantModuleController = async (req: Request, res: Response) => sendSuccess(res, "Tenant module enabled", await setPlatformTenantModule(String(req.params.tenantId), req.params.module as never, true, String(req.body.reason), req.user!));
export const disablePlatformTenantModuleController = async (req: Request, res: Response) => sendSuccess(res, "Tenant module disabled", await setPlatformTenantModule(String(req.params.tenantId), req.params.module as never, false, String(req.body.reason), req.user!));

export const getPlatformUsersController = async (req: Request, res: Response) => sendSuccess(res, "Users retrieved successfully", await getPlatformUsers(req.query, req.user!));
export const getPlatformUserAnalyticsController = async (req: Request, res: Response) => sendSuccess(res, "User analytics retrieved", await getPlatformUserAnalytics(req.user!));
export const getPlatformUserFilterOptionsController = async (req: Request, res: Response) => sendSuccess(res, "User filter options retrieved", await getPlatformUserFilterOptions(req.user!));
export const deactivatePlatformUserController = async (req: Request, res: Response) => sendSuccess(res, "User deactivated", await deactivatePlatformUser(String(req.params.userId), req.user!));
export const resetPlatformUserPasswordController = async (req: Request, res: Response) => sendSuccess(res, "Password reset initiated", await resetPlatformUserPassword(String(req.params.userId), req.user!));
export const impersonatePlatformUserController = async (req: Request, res: Response) => sendSuccess(res, "Impersonation session started", await impersonatePlatformUser(String(req.params.userId), String(req.body.reason), req.user!, { ipAddress: req.ip, userAgent: req.get("user-agent") ?? null }));

export const getBillingOverviewController = async (req: Request, res: Response) => sendSuccess(res, "Billing and revenue retrieved", await getBillingOverview(req.query, req.user!));
export const getBillingAnalyticsController = async (req: Request, res: Response) => sendSuccess(res, "Billing analytics retrieved", await getBillingAnalytics(req.query, req.user!));
export const getRevenueByPlanController = async (req: Request, res: Response) => sendSuccess(res, "Revenue by plan retrieved", await getRevenueByPlan(req.query, req.user!));
export const listPlatformInvoicesController = async (req: Request, res: Response) => { const result = await listPlatformInvoices(req.query, req.user!); return sendSuccess(res, "Platform invoices retrieved", result.data, { pagination: result.pagination }); };
export const createPlatformInvoiceController = async (req: Request, res: Response) => sendSuccess(res, "Platform invoice created", await createPlatformInvoice(req.body, req.user!), { status: 201 });
export const sendInvoiceReminderController = async (req: Request, res: Response) => sendSuccess(res, "Invoice reminder sent", await sendInvoiceReminder(String(req.params.invoiceId), req.user!));
export const downloadPlatformInvoiceController = async (req: Request, res: Response) => { const result = await downloadPlatformInvoice(String(req.params.invoiceId), req.user!); return res.status(200).type("application/pdf").attachment(result.filename).send(result.buffer); };
export const exportPlatformInvoicesController = async (req: Request, res: Response) => {
  const result = await exportPlatformInvoices(req.query, req.user!);
  res.status(200).type("text/csv; charset=utf-8").attachment(result.filename);
  for await (const chunk of result.chunks) {
    if (res.destroyed) return;
    if (!res.write(chunk)) {
      const writable = await new Promise<boolean>((resolve) => {
        const onDrain = () => { cleanup(); resolve(true); };
        const onClose = () => { cleanup(); resolve(false); };
        const cleanup = () => { res.off("drain", onDrain); res.off("close", onClose); };
        res.once("drain", onDrain); res.once("close", onClose);
      });
      if (!writable) return;
    }
  }
  return res.end();
};

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
  sendSuccess(res, "Price change recorded successfully", await updatePlatformModulePrice(String(req.params.moduleId ?? req.params.planCode), req.body, req.user!, {
    ipAddress: req.ip,
    requestId: req.header("x-request-id") ?? null
  }));
