import {
  acknowledgeSystemAlert,
  addMyPlanPaymentCard,
  addIpAllowlistEntry,
  cancelMyPlanPaymentCardCreation,
  cloneRole,
  createBranch,
  createRole,
  createUserGroup,
  deleteBranch,
  deleteRole,
  deleteUserGroup,
  getBranch,
  getAuditLogs,
  getDashboardData,
  getOrganization,
  getRoleById,
  getModuleSectionData,
  getMyPlanBillingHistory,
  getMyPlanBillingAnalytics,
  getMyPlanModuleAddOns,
  getMyPlanOverview,
  getMyPlanPaymentLocationOptions,
  getMyPlanPaymentMethod,
  getMyPlanPlans,
  listMyPlanPaymentCards,
  updateMyPlanPaymentCard,
  deleteMyPlanPaymentCard,
  downloadMyPlanInvoice,
  triggerMyPlanRenewalNotifications,
  getRolePermissionCatalog,
  getRoleTemplates,
  getSecurityPolicy,
  getIpAllowlist,
  getSystemAlerts,
  getUserManagementAnalytics,
  getWorkSchedule,
  inviteUser,
  listActiveSessions,
  listLoginActivity,
  listBranches,
  listBranchesTable,
  listDepartmentsTable,
  listPendingInvitations,
  listRoles,
  listUserGroups,
  listUsersTable,
  removeUser,
  resendInvitation,
  revokeSession,
  revokeSessionsBulk,
  removeIpAllowlistEntry,
  saveWorkSchedule,
  cancelMyPlanSubscription,
  changeMyPlan,
  purchaseMyPlan,
  cancelMyPlanChange,
  toggleIpAllowlist,
  updateBranch,
  updateSecurityPasswordPolicy,
  updateSecurityTwoFactorPolicy,
  updateOrganization,
  updateRole,
  updateModuleStatus,
  updateMyPlanModuleAddOn,
  updateMyPlanBillingAddress,
  updateMyPlanPaymentMethod,
  updateUserAccess,
  updateUserGroup,
  getNotificationsAlertsOverview,
  getTenantNotificationPreferences,
  toggleTenantNotificationCategory,
  toggleTenantNotificationModule,
  listPlatformAnnouncements,
  getPlatformAnnouncement,
  getPlatformAnnouncementLearnMore,
  markPlatformAnnouncementRead,
  markAllPlatformAnnouncementsRead,
  getGeneralSettingsOverview,
  getLocaleSettings,
  getLocaleOptions,
  updateLocaleSettings,
  getBrandingSettings,
  updateBrandingSettings,
  uploadBrandingLogo,
  requestOrganizationDataExport,
  getOrganizationDataExportDownload,
  requestOrganizationDeletion
} from "./admin.service";
import { sendSuccess } from "../../core/api-response";
import type { TenantNotificationChannelKey } from "./admin.interface";

export const getDashboardController = async (req: any, res: any) => {
  const data = await getDashboardData(req);
  res.json(data);
};

export const getSecurityPolicyController = async (req: any, res: any) => {
  const data = await getSecurityPolicy(req.organizationId!);
  res.json(data);
};

export const updateSecurityPasswordPolicyController = async (req: any, res: any) => {
  const data = await updateSecurityPasswordPolicy(req);
  res.json(data);
};

export const updateSecurityTwoFactorPolicyController = async (req: any, res: any) => {
  const data = await updateSecurityTwoFactorPolicy(req);
  res.json(data);
};

export const listActiveSessionsController = async (req: any, res: any) => {
  const data = await listActiveSessions(req);
  res.json(data);
};

export const revokeSessionController = async (req: any, res: any) => {
  const data = await revokeSession(req);
  res.json(data);
};

export const revokeSessionsBulkController = async (req: any, res: any) => {
  const data = await revokeSessionsBulk(req);
  res.json(data);
};

export const getIpAllowlistController = async (req: any, res: any) => {
  const data = await getIpAllowlist(req.organizationId!);
  res.json(data);
};

export const toggleIpAllowlistController = async (req: any, res: any) => {
  const data = await toggleIpAllowlist(req);
  res.json(data);
};

export const addIpAllowlistEntryController = async (req: any, res: any) => {
  const data = await addIpAllowlistEntry(req);
  res.status(201).json(data);
};

export const removeIpAllowlistEntryController = async (req: any, res: any) => {
  const data = await removeIpAllowlistEntry(req);
  res.json(data);
};

export const listLoginActivityController = async (req: any, res: any) => {
  const data = await listLoginActivity(req);
  res.json(data);
};

export const getModuleSectionController = async (req: any, res: any) => {
  const data = await getModuleSectionData(req);
  res.json(data);
};

export const getAuditLogsController = async (req: any, res: any) => {
  const data = await getAuditLogs(req);
  res.json(data);
};

export const getSystemAlertsController = async (req: any, res: any) => {
  const alerts = await getSystemAlerts(req.organizationId!);
  res.json(alerts);
};

export const acknowledgeSystemAlertController = async (req: any, res: any) => {
  const alert = await acknowledgeSystemAlert(req.organizationId!, req.user?.id, String(req.params.id));
  res.json(alert);
};

export const getOrganizationController = async (req: any, res: any) => {
  const organization = await getOrganization(req.organizationId!);
  res.json(organization);
};

export const updateOrganizationController = async (req: any, res: any) => {
  const organization = await updateOrganization(req);
  res.json(organization);
};

export const updateModuleStatusController = async (req: any, res: any) => {
  const data = await updateModuleStatus(req);
  res.json(data);
};

export const getMyPlanOverviewController = async (req: any, res: any) => {
  const data = await getMyPlanOverview(req);
  sendSuccess(res, "My Plan overview retrieved.", data);
};

export const getMyPlanPlansController = async (req: any, res: any) => {
  const data = await getMyPlanPlans(req);
  sendSuccess(res, "Plans retrieved.", data);
};

export const changeMyPlanController = async (req: any, res: any) => {
  const data = await changeMyPlan(req);
  sendSuccess(res, data.message ?? "Plan change processed.", data);
};

export const purchaseMyPlanController = async (req: any, res: any) => {
  const data = await purchaseMyPlan(req);
  sendSuccess(res, data.message, data, { status: data.confirmationRequired ? 200 : 201 });
};

export const cancelMyPlanChangeController = async (req: any, res: any) => {
  const data = await cancelMyPlanChange(req);
  sendSuccess(res, "Scheduled plan change cancelled.", data);
};

export const getMyPlanModuleAddOnsController = async (req: any, res: any) => {
  const data = await getMyPlanModuleAddOns(req);
  sendSuccess(res, "Modules retrieved.", data);
};

export const updateMyPlanModuleAddOnController = async (req: any, res: any) => {
  const data = await updateMyPlanModuleAddOn(req);
  sendSuccess(res, "Module change processed.", data);
};

export const getMyPlanPaymentMethodController = async (req: any, res: any) => {
  const data = await getMyPlanPaymentMethod(req);
  sendSuccess(res, "Payment method retrieved.", data);
};

export const updateMyPlanPaymentMethodController = async (req: any, res: any) => {
  const data = await updateMyPlanPaymentMethod(req);
  sendSuccess(res, "Payment method updated.", data);
};

export const listMyPlanPaymentCardsController = async (req: any, res: any) => {
  const data = await listMyPlanPaymentCards(req);
  sendSuccess(res, "Payment cards retrieved.", data);
};

export const updateMyPlanPaymentCardController = async (req: any, res: any) => {
  const data = await updateMyPlanPaymentCard(req);
  sendSuccess(res, "Payment card updated.", data);
};

export const deleteMyPlanPaymentCardController = async (req: any, res: any) => {
  await deleteMyPlanPaymentCard(req);
  sendSuccess(res, "Payment card removed.", null);
};

export const addMyPlanPaymentCardController = async (req: any, res: any) => {
  const data = await addMyPlanPaymentCard(req);
  sendSuccess(res, data.message, data, { status: 201 });
};

export const cancelMyPlanPaymentCardCreationController = async (req: any, res: any) => {
  const data = await cancelMyPlanPaymentCardCreation(req);
  sendSuccess(res, data.message, data);
};

export const getMyPlanPaymentLocationOptionsController = async (req: any, res: any) => {
  const data = await getMyPlanPaymentLocationOptions(req);
  sendSuccess(res, "Payment location options retrieved.", data);
};

export const updateMyPlanBillingAddressController = async (req: any, res: any) => {
  const data = await updateMyPlanBillingAddress(req);
  sendSuccess(res, data.message, data);
};

export const getMyPlanBillingHistoryController = async (req: any, res: any) => {
  const data = await getMyPlanBillingHistory(req);
  sendSuccess(res, "Billing history retrieved.", data.data, { metadata: { section: data.section, year: data.year }, pagination: { page: data.page, limit: data.limit, total: data.total, totalPages: Math.ceil(data.total / data.limit) } });
};

export const getMyPlanBillingAnalyticsController = async (req: any, res: any) => {
  const data = await getMyPlanBillingAnalytics(req);
  sendSuccess(res, "Billing analytics retrieved.", data);
};

export const downloadMyPlanInvoiceController = async (req: any, res: any) => {
  const invoice = await downloadMyPlanInvoice(req);
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="${invoice.filename}"`);
  res.send(invoice.buffer);
};

export const triggerMyPlanRenewalNotificationsController = async (req: any, res: any) => {
  const data = await triggerMyPlanRenewalNotifications(req);
  sendSuccess(res, "Renewal notifications processed.", data);
};

export const cancelMyPlanSubscriptionController = async (req: any, res: any) => {
  const data = await cancelMyPlanSubscription(req);
  sendSuccess(res, data.message, data);
};

export const getNotificationsAlertsOverviewController = async (req: any, res: any) => sendSuccess(res, "Notifications and alerts overview retrieved.", await getNotificationsAlertsOverview(req));
export const getNotificationPreferencesController = async (req: any, res: any) => sendSuccess(res, "Notification preferences retrieved.", await getTenantNotificationPreferences(req.organizationId!, req.params.channelKey as TenantNotificationChannelKey));
export const toggleNotificationCategoryController = async (req: any, res: any) => sendSuccess(res, "Notification preference updated.", await toggleTenantNotificationCategory(req));
export const toggleNotificationModuleController = async (req: any, res: any) => sendSuccess(res, "Module notification preferences updated.", await toggleTenantNotificationModule(req));
export const listPlatformAnnouncementsController = async (req: any, res: any) => { const result = await listPlatformAnnouncements(req); return sendSuccess(res, "Platform announcements retrieved.", result.data, { metadata: result.metadata, pagination: result.pagination }); };
export const getPlatformAnnouncementController = async (req: any, res: any) => sendSuccess(res, "Platform announcement retrieved.", await getPlatformAnnouncement(req));
export const getPlatformAnnouncementLearnMoreController = async (req: any, res: any) => sendSuccess(res, "Announcement content retrieved.", await getPlatformAnnouncementLearnMore(req));
export const markPlatformAnnouncementReadController = async (req: any, res: any) => sendSuccess(res, "Announcement marked as read.", await markPlatformAnnouncementRead(req));
export const markAllPlatformAnnouncementsReadController = async (req: any, res: any) => sendSuccess(res, "Announcements marked as read.", await markAllPlatformAnnouncementsRead(req));

export const getUserManagementAnalyticsController = async (req: any, res: any) => {
  const analytics = await getUserManagementAnalytics(req);
  res.json(analytics);
};

export const listUsersTableController = async (req: any, res: any) => {
  const users = await listUsersTable(req);
  res.json(users);
};

export const updateUserAccessController = async (req: any, res: any) => {
  const user = await updateUserAccess(req);
  res.json(user);
};

export const removeUserController = async (req: any, res: any) => {
  await removeUser(req);
  res.status(204).send();
};

export const inviteUserController = async (req: any, res: any) => {
  const invitation = await inviteUser(req);
  res.status(201).json(invitation);
};

export const listPendingInvitationsController = async (req: any, res: any) => {
  const invitations = await listPendingInvitations(req);
  res.json(invitations);
};

export const resendInvitationController = async (req: any, res: any) => {
  const invitation = await resendInvitation(req);
  res.json(invitation);
};

export const listUserGroupsController = async (req: any, res: any) => {
  const groups = await listUserGroups(req);
  res.json(groups);
};

export const createUserGroupController = async (req: any, res: any) => {
  const group = await createUserGroup(req);
  res.status(201).json(group);
};

export const updateUserGroupController = async (req: any, res: any) => {
  const group = await updateUserGroup(req);
  res.json(group);
};

export const deleteUserGroupController = async (req: any, res: any) => {
  const result = await deleteUserGroup(req);
  res.json(result);
};

export const listDepartmentsTableController = async (req: any, res: any) => {
  const departments = await listDepartmentsTable(req);
  res.json(departments);
};

export const listBranchesController = async (req: any, res: any) => {
  const branches = await listBranches(req);
  res.json(branches);
};

export const listBranchesTableController = async (req: any, res: any) => {
  const branches = await listBranchesTable(req);
  res.json(branches);
};

export const getBranchController = async (req: any, res: any) => {
  const branch = await getBranch(req.organizationId!, String(req.params.id));
  res.json(branch);
};

export const createBranchController = async (req: any, res: any) => {
  const branch = await createBranch(req);
  res.status(201).json(branch);
};

export const updateBranchController = async (req: any, res: any) => {
  const branch = await updateBranch(req);
  res.json(branch);
};

export const deleteBranchController = async (req: any, res: any) => {
  await deleteBranch(req);
  res.status(204).send();
};

export const getWorkScheduleController = async (req: any, res: any) => {
  const schedule = await getWorkSchedule(req.organizationId!);
  res.json(schedule);
};

export const saveWorkScheduleController = async (req: any, res: any) => {
  const schedule = await saveWorkSchedule(req);
  res.json(schedule);
};

export const listRolesController = async (req: any, res: any) => {
  const roles = await listRoles(req.organizationId!);
  res.json(roles);
};

export const getRoleByIdController = async (req: any, res: any) => {
  const role = await getRoleById(req.organizationId!, String(req.params.id));
  res.json(role);
};

export const listRoleTemplatesController = async (_req: any, res: any) => {
  const templates = await getRoleTemplates();
  res.json(templates);
};

export const getRolePermissionCatalogController = async (_req: any, res: any) => {
  const catalog = await getRolePermissionCatalog();
  res.json(catalog);
};

export const createRoleController = async (req: any, res: any) => {
  const role = await createRole(req);
  res.status(201).json(role);
};

export const updateRoleController = async (req: any, res: any) => {
  const role = await updateRole(req);
  res.json(role);
};

export const cloneRoleController = async (req: any, res: any) => {
  const role = await cloneRole(req);
  res.status(201).json(role);
};

export const deleteRoleController = async (req: any, res: any) => {
  await deleteRole(req);
  res.status(204).send();
};

export const getGeneralSettingsOverviewController = async (req: any, res: any) =>
  sendSuccess(res, "General settings retrieved", await getGeneralSettingsOverview(req));

export const getLocaleSettingsController = async (req: any, res: any) =>
  sendSuccess(res, "Locale and region settings retrieved", await getLocaleSettings(req));

export const getLocaleOptionsController = async (req: any, res: any) =>
  sendSuccess(res, "Locale options retrieved", await getLocaleOptions(req));

export const updateLocaleSettingsController = async (req: any, res: any) =>
  sendSuccess(res, "Locale and region settings updated", await updateLocaleSettings(req));

export const getBrandingSettingsController = async (req: any, res: any) =>
  sendSuccess(res, "Branding settings retrieved", await getBrandingSettings(req));

export const updateBrandingSettingsController = async (req: any, res: any) =>
  sendSuccess(res, "Branding settings updated", await updateBrandingSettings(req));

export const uploadBrandingLogoController = async (req: any, res: any) =>
  sendSuccess(res, "Organization logo uploaded", await uploadBrandingLogo(req));

export const requestOrganizationDataExportController = async (req: any, res: any) =>
  sendSuccess(res, "Organization data export requested for delivery within 24 hours", await requestOrganizationDataExport(req), { status: 201 });

export const downloadOrganizationDataExportController = async (req: any, res: any) => {
  const file = await getOrganizationDataExportDownload(req);
  res.setHeader("Content-Type", "application/zip");
  res.setHeader("Content-Disposition", `attachment; filename="${file.fileName.replace(/["\\\r\n]/g, "")}"`);
  res.send(file.buffer);
};

export const requestOrganizationDeletionController = async (req: any, res: any) =>
  sendSuccess(res, "Organization deletion request submitted for platform approval", await requestOrganizationDeletion(req), { status: 201 });
