import { Router, type RequestHandler } from "express";
import multer from "multer";
import { asyncHandler } from "../../core/async-handler";
import { createCrudRouter } from "../../core/crud-router";
import { paginationQuery } from "../../core/pagination";
import { validate } from "../../core/validate";
import { authorize } from "../../middleware/rbac.middleware";
import { badRequest } from "../../core/http-error";
import {
  acknowledgeSystemAlertController,
  addMyPlanPaymentCardController,
  addIpAllowlistEntryController,
  cancelMyPlanPaymentCardCreationController,
  cancelMyPlanSubscriptionController,
  changeMyPlanController,
  purchaseMyPlanController,
  cancelMyPlanChangeController,
  cloneRoleController,
  createBranchController,
  createRoleController,
  createUserGroupController,
  deleteBranchController,
  deleteUserGroupController,
  deleteRoleController,
  getBranchController,
  getAuditLogsController,
  getDashboardController,
  getModuleSectionController,
  getMyPlanBillingHistoryController,
  getMyPlanBillingAnalyticsController,
  getMyPlanActiveModulesController,
  getMyPlanOverviewController,
  getMyPlanPaymentLocationOptionsController,
  getMyPlanPaymentMethodController,
  getMyPlanPlansController,
  listMyPlanPaymentCardsController,
  updateMyPlanPaymentCardController,
  deleteMyPlanPaymentCardController,
  downloadMyPlanInvoiceController,
  triggerMyPlanRenewalNotificationsController,
  getSecurityPolicyController,
  getIpAllowlistController,
  getRoleByIdController,
  getUserManagementAnalyticsController,
  getRolePermissionCatalogController,
  inviteUserController,
  listBranchesTableController,
  listDepartmentsTableController,
  listBranchesController,
  listPendingInvitationsController,
  listActiveSessionsController,
  listLoginActivityController,
  listRoleTemplatesController,
  listUserGroupsController,
  listUsersTableController,
  removeUserController,
  resendInvitationController,
  revokeSessionController,
  revokeSessionsBulkController,
  removeIpAllowlistEntryController,
  getOrganizationController,
  getSystemAlertsController,
  getWorkScheduleController,
  listRolesController,
  saveWorkScheduleController,
  updateBranchController,
  updateModuleStatusController,
  updateMyPlanBillingAddressController,
  updateMyPlanPaymentMethodController,
  updateSecurityPasswordPolicyController,
  updateSecurityTwoFactorPolicyController,
  toggleIpAllowlistController,
  updateOrganizationController,
  updateRoleController,
  updateUserAccessController,
  updateUserGroupController,
  getNotificationsAlertsOverviewController,
  getNotificationPreferencesController,
  toggleNotificationCategoryController,
  toggleNotificationModuleController,
  listPlatformAnnouncementsController,
  getPlatformAnnouncementController,
  getPlatformAnnouncementLearnMoreController,
  markPlatformAnnouncementReadController,
  markAllPlatformAnnouncementsReadController,
  getGeneralSettingsOverviewController,
  getLocaleSettingsController,
  getLocaleOptionsController,
  updateLocaleSettingsController,
  getBrandingSettingsController,
  updateBrandingSettingsController,
  uploadBrandingLogoController,
  requestOrganizationDataExportController,
  downloadOrganizationDataExportController,
  requestOrganizationDeletionController
} from "./admin.controller";
import {
  departmentsCrudOptions,
  staffCrudOptions,
  systemConfigCrudOptions,
  teamsCrudOptions
} from "./admin.service";
import {
  actionParamsSchema,
  auditLogQuerySchema,
  branchCreateSchema,
  branchUpdateSchema,
  branchesTableQuerySchema,
  departmentsTableQuerySchema,
  moduleParamsSchema,
  moduleStatusUpdateSchema,
  myPlanAddCardSchema,
  myPlanBillingAddressSchema,
  myPlanBillingAnalyticsQuerySchema,
  myPlanBillingHistoryQuerySchema,
  myPlanCancelCardCreationSchema,
  myPlanCancelSubscriptionSchema,
  myPlanChangeSchema,
  myPlanPurchaseSchema,
  myPlanChangeParamsSchema,
  myPlanLocationOptionsQuerySchema,
  myPlanPaymentMethodSchema,
  myPlanCardParamsSchema,
  myPlanCardUpdateSchema,
  myPlanInvoiceParamsSchema,
  myPlanRenewalNotificationSchema,
  securityPasswordPolicySchema,
  securityTwoFactorSchema,
  securitySessionsQuerySchema,
  securityRevokeSessionSchema,
  securityRevokeSessionsBulkSchema,
  ipAllowlistToggleSchema,
  ipAllowlistEntryCreateSchema,
  loginActivityQuerySchema,
  organizationUpdateSchema,
  roleCloneSchema,
  roleCreateSchema,
  roleUpdateSchema,
  userManagementAnalyticsQuerySchema,
  userManagementCreateGroupSchema,
  userManagementGroupQuerySchema,
  userManagementInvitationQuerySchema,
  userManagementInviteSchema,
  userManagementUpdateGroupSchema,
  userManagementUpdateUserSchema,
  userManagementUsersQuerySchema,
  workScheduleUpsertSchema,
  announcementListQuerySchema,
  announcementParamsSchema,
  notificationCategoryParamsSchema,
  notificationChannelParamsSchema,
  notificationModuleParamsSchema,
  notificationToggleSchema,
  localeSettingsSchema,
  localeOptionsQuerySchema,
  brandingSettingsSchema,
  generalSettingsExportParamsSchema,
  organizationDeletionRequestSchema
} from "./admin.validation";

export const adminRouter = Router();

const brandingLogoUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (_req, file, callback) => ["image/png", "image/svg+xml"].includes(file.mimetype)
    ? callback(null, true)
    : callback(new Error("UNSUPPORTED_LOGO_TYPE"))
});

const handleBrandingLogoUpload: RequestHandler = (req, res, next) => {
  brandingLogoUpload.single("logo")(req, res, (error: unknown) => {
    if (!error) return next();
    if (error instanceof multer.MulterError && error.code === "LIMIT_FILE_SIZE") {
      return next(badRequest("Logo must not exceed 2 MB", { errorCode: "LOGO_FILE_TOO_LARGE", maxBytes: 2 * 1024 * 1024 }));
    }
    return next(badRequest("Logo must be a PNG or SVG image", { errorCode: "UNSUPPORTED_LOGO_TYPE" }));
  });
};

adminRouter.get("/general-settings/overview", authorize("admin:settings:view"), asyncHandler(getGeneralSettingsOverviewController));
adminRouter.get("/general-settings/locale/options", authorize("admin:settings:view"), validate({ query: localeOptionsQuerySchema }), asyncHandler(getLocaleOptionsController));
adminRouter.get("/general-settings/locale", authorize("admin:settings:view"), asyncHandler(getLocaleSettingsController));
adminRouter.put("/general-settings/locale", authorize("admin:settings:update"), validate({ body: localeSettingsSchema }), asyncHandler(updateLocaleSettingsController));
adminRouter.get("/general-settings/branding", authorize("admin:settings:view"), asyncHandler(getBrandingSettingsController));
adminRouter.patch("/general-settings/branding", authorize("admin:settings:update"), validate({ body: brandingSettingsSchema }), asyncHandler(updateBrandingSettingsController));
adminRouter.post("/general-settings/branding/logo", authorize("admin:settings:update"), handleBrandingLogoUpload, asyncHandler(uploadBrandingLogoController));
adminRouter.post("/general-settings/data-privacy/exports", authorize("admin:settings:export"), asyncHandler(requestOrganizationDataExportController));
adminRouter.get("/general-settings/data-privacy/exports/:exportId/download", authorize("admin:settings:export"), validate({ params: generalSettingsExportParamsSchema }), asyncHandler(downloadOrganizationDataExportController));
adminRouter.post("/general-settings/data-privacy/deletion-request", authorize("admin:settings:delete-request"), validate({ body: organizationDeletionRequestSchema }), asyncHandler(requestOrganizationDeletionController));

adminRouter.get("/dashboard", authorize("admin:organization:view"), asyncHandler(getDashboardController));

adminRouter.get("/security/policy", authorize("admin:security:view"), asyncHandler(getSecurityPolicyController));

adminRouter.put(
  "/security/password-policy",
  authorize("admin:security:update"),
  validate({ body: securityPasswordPolicySchema }),
  asyncHandler(updateSecurityPasswordPolicyController)
);

adminRouter.put(
  "/security/two-factor",
  authorize("admin:security:update"),
  validate({ body: securityTwoFactorSchema }),
  asyncHandler(updateSecurityTwoFactorPolicyController)
);

adminRouter.get(
  "/security/sessions",
  authorize("admin:security:view"),
  validate({ query: securitySessionsQuerySchema }),
  asyncHandler(listActiveSessionsController)
);

adminRouter.post(
  "/security/sessions/:id/revoke",
  authorize("admin:security:sessions:revoke"),
  validate({ params: actionParamsSchema, body: securityRevokeSessionSchema }),
  asyncHandler(revokeSessionController)
);

adminRouter.post(
  "/security/sessions/revoke-bulk",
  authorize("admin:security:sessions:revoke"),
  validate({ body: securityRevokeSessionsBulkSchema }),
  asyncHandler(revokeSessionsBulkController)
);

adminRouter.get(
  "/security/ip-allowlist",
  authorize("admin:security:view"),
  asyncHandler(getIpAllowlistController)
);

adminRouter.put(
  "/security/ip-allowlist/toggle",
  authorize("admin:security:ip-allowlist:update"),
  validate({ body: ipAllowlistToggleSchema }),
  asyncHandler(toggleIpAllowlistController)
);

adminRouter.post(
  "/security/ip-allowlist",
  authorize("admin:security:ip-allowlist:update"),
  validate({ body: ipAllowlistEntryCreateSchema }),
  asyncHandler(addIpAllowlistEntryController)
);

adminRouter.delete(
  "/security/ip-allowlist/:id",
  authorize("admin:security:ip-allowlist:update"),
  validate({ params: actionParamsSchema }),
  asyncHandler(removeIpAllowlistEntryController)
);

adminRouter.get(
  "/security/login-activity",
  authorize("admin:security:activity:view"),
  validate({ query: loginActivityQuerySchema }),
  asyncHandler(listLoginActivityController)
);

adminRouter.get("/modules", authorize("admin:organization:view"), asyncHandler(getModuleSectionController));

adminRouter.patch(
  "/modules/:moduleKey/status",
  authorize("admin:organization:update"),
  validate({ params: moduleParamsSchema, body: moduleStatusUpdateSchema }),
  asyncHandler(updateModuleStatusController)
);

adminRouter.delete(
  "/my-plan/subscription/plan-change/:changeId",
  authorize("admin:organization:update"),
  validate({ params: myPlanChangeParamsSchema }),
  asyncHandler(cancelMyPlanChangeController)
);

adminRouter.get("/my-plan/overview", authorize("admin:organization:view"), asyncHandler(getMyPlanOverviewController));

adminRouter.get("/my-plan/plans", authorize("admin:organization:view"), asyncHandler(getMyPlanPlansController));

adminRouter.post(
  "/my-plan/subscriptions",
  authorize("admin:organization:update"),
  validate({ body: myPlanPurchaseSchema }),
  asyncHandler(purchaseMyPlanController)
);

adminRouter.patch(
  "/my-plan/subscription/plan",
  authorize("admin:organization:update"),
  validate({ body: myPlanChangeSchema }),
  asyncHandler(changeMyPlanController)
);

adminRouter.post(
  "/my-plan/subscription/cancel",
  authorize("admin:organization:update"),
  validate({ body: myPlanCancelSubscriptionSchema }),
  asyncHandler(cancelMyPlanSubscriptionController)
);

adminRouter.get(
  "/my-plan/active-modules",
  authorize("admin:organization:view"),
  asyncHandler(getMyPlanActiveModulesController)
);

adminRouter.get(
  "/my-plan/payment-method",
  authorize("admin:organization:view"),
  asyncHandler(getMyPlanPaymentMethodController)
);

adminRouter.get(
  "/my-plan/payment-method/location-options",
  authorize("admin:organization:view"),
  validate({ query: myPlanLocationOptionsQuerySchema }),
  asyncHandler(getMyPlanPaymentLocationOptionsController)
);

adminRouter.patch(
  "/my-plan/payment-method",
  authorize("admin:organization:update"),
  validate({ body: myPlanPaymentMethodSchema }),
  asyncHandler(updateMyPlanPaymentMethodController)
);

adminRouter.post(
  "/my-plan/payment-method/cards",
  authorize("admin:organization:update"),
  validate({ body: myPlanAddCardSchema }),
  asyncHandler(addMyPlanPaymentCardController)
);

adminRouter.get("/my-plan/payment-method/cards", authorize("admin:organization:view"), asyncHandler(listMyPlanPaymentCardsController));
adminRouter.patch(
  "/my-plan/payment-method/cards/:cardId",
  authorize("admin:organization:update"),
  validate({ params: myPlanCardParamsSchema, body: myPlanCardUpdateSchema }),
  asyncHandler(updateMyPlanPaymentCardController)
);
adminRouter.delete(
  "/my-plan/payment-method/cards/:cardId",
  authorize("admin:organization:update"),
  validate({ params: myPlanCardParamsSchema }),
  asyncHandler(deleteMyPlanPaymentCardController)
);

adminRouter.post(
  "/my-plan/payment-method/cards/cancel",
  authorize("admin:organization:update"),
  validate({ body: myPlanCancelCardCreationSchema }),
  asyncHandler(cancelMyPlanPaymentCardCreationController)
);

adminRouter.patch(
  "/my-plan/payment-method/billing-address",
  authorize("admin:organization:update"),
  validate({ body: myPlanBillingAddressSchema }),
  asyncHandler(updateMyPlanBillingAddressController)
);

adminRouter.get(
  "/my-plan/billing-history",
  authorize("admin:organization:view"),
  validate({ query: myPlanBillingHistoryQuerySchema }),
  asyncHandler(getMyPlanBillingHistoryController)
);

adminRouter.get(
  "/my-plan/billing-analytics",
  authorize("admin:organization:view"),
  validate({ query: myPlanBillingAnalyticsQuerySchema }),
  asyncHandler(getMyPlanBillingAnalyticsController)
);

adminRouter.get(
  "/my-plan/invoices/:invoiceId/download",
  authorize("admin:organization:view"),
  validate({ params: myPlanInvoiceParamsSchema }),
  asyncHandler(downloadMyPlanInvoiceController)
);

adminRouter.post(
  "/my-plan/renewal-notifications/process",
  authorize("admin:organization:update"),
  validate({ body: myPlanRenewalNotificationSchema }),
  asyncHandler(triggerMyPlanRenewalNotificationsController)
);

adminRouter.get(
  "/notifications-alerts/overview",
  authorize("admin:notifications:view", "admin:announcements:view"),
  asyncHandler(getNotificationsAlertsOverviewController)
);
adminRouter.get(
  "/notifications-alerts/preferences/:channelKey",
  authorize("admin:notifications:view"),
  validate({ params: notificationChannelParamsSchema }),
  asyncHandler(getNotificationPreferencesController)
);
adminRouter.patch(
  "/notifications-alerts/preferences/:channelKey/modules/:moduleKey",
  authorize("admin:notifications:update"),
  validate({ params: notificationModuleParamsSchema, body: notificationToggleSchema }),
  asyncHandler(toggleNotificationModuleController)
);
adminRouter.patch(
  "/notifications-alerts/preferences/:channelKey/modules/:moduleKey/categories/:categoryId",
  authorize("admin:notifications:update"),
  validate({ params: notificationCategoryParamsSchema, body: notificationToggleSchema }),
  asyncHandler(toggleNotificationCategoryController)
);
adminRouter.get(
  "/notifications-alerts/announcements",
  authorize("admin:announcements:view"),
  validate({ query: announcementListQuerySchema }),
  asyncHandler(listPlatformAnnouncementsController)
);
adminRouter.post(
  "/notifications-alerts/announcements/read-all",
  authorize("admin:announcements:view"),
  asyncHandler(markAllPlatformAnnouncementsReadController)
);
adminRouter.get(
  "/notifications-alerts/announcements/:announcementId",
  authorize("admin:announcements:view"),
  validate({ params: announcementParamsSchema }),
  asyncHandler(getPlatformAnnouncementController)
);
adminRouter.get(
  "/notifications-alerts/announcements/:announcementId/learn-more",
  authorize("admin:announcements:view"),
  validate({ params: announcementParamsSchema }),
  asyncHandler(getPlatformAnnouncementLearnMoreController)
);
adminRouter.post(
  "/notifications-alerts/announcements/:announcementId/read",
  authorize("admin:announcements:view"),
  validate({ params: announcementParamsSchema }),
  asyncHandler(markPlatformAnnouncementReadController)
);

adminRouter.get(
  "/audit-log",
  authorize("admin:organization:view"),
  validate({ query: auditLogQuerySchema }),
  asyncHandler(getAuditLogsController)
);

adminRouter.get("/system-alerts", authorize("admin:organization:view"), asyncHandler(getSystemAlertsController));

adminRouter.patch(
  "/system-alerts/:id/acknowledge",
  authorize("admin:organization:update"),
  validate({ params: actionParamsSchema }),
  asyncHandler(acknowledgeSystemAlertController)
);

adminRouter.get("/organization", authorize("admin:organization:view"), asyncHandler(getOrganizationController));

adminRouter.patch(
  "/organization",
  authorize("admin:organization:update"),
  validate({ body: organizationUpdateSchema }),
  asyncHandler(updateOrganizationController)
);

adminRouter.get(
  "/organization/work-schedule",
  authorize("admin:organization:view"),
  asyncHandler(getWorkScheduleController)
);

adminRouter.put(
  "/organization/work-schedule",
  authorize("admin:organization:update"),
  validate({ body: workScheduleUpsertSchema }),
  asyncHandler(saveWorkScheduleController)
);

adminRouter.get(
  "/departments/table",
  authorize("admin:departments:view"),
  validate({ query: departmentsTableQuerySchema }),
  asyncHandler(listDepartmentsTableController)
);

adminRouter.get(
  "/branches/table",
  authorize("admin:organization:view"),
  validate({ query: branchesTableQuerySchema }),
  asyncHandler(listBranchesTableController)
);

adminRouter.get(
  "/branches",
  authorize("admin:organization:view"),
  validate({ query: paginationQuery }),
  asyncHandler(listBranchesController)
);

adminRouter.get(
  "/branches/:id",
  authorize("admin:organization:view"),
  validate({ params: actionParamsSchema }),
  asyncHandler(getBranchController)
);

adminRouter.post(
  "/branches",
  authorize("admin:organization:create"),
  validate({ body: branchCreateSchema }),
  asyncHandler(createBranchController)
);

adminRouter.patch(
  "/branches/:id",
  authorize("admin:organization:update"),
  validate({ params: actionParamsSchema, body: branchUpdateSchema }),
  asyncHandler(updateBranchController)
);

adminRouter.delete(
  "/branches/:id",
  authorize("admin:organization:delete"),
  validate({ params: actionParamsSchema }),
  asyncHandler(deleteBranchController)
);

adminRouter.get(
  "/users/analytics",
  authorize("admin:staff:view"),
  validate({ query: userManagementAnalyticsQuerySchema }),
  asyncHandler(getUserManagementAnalyticsController)
);

adminRouter.get(
  "/users",
  authorize("admin:staff:view"),
  validate({ query: userManagementUsersQuerySchema }),
  asyncHandler(listUsersTableController)
);

adminRouter.patch(
  "/users/:id",
  authorize("admin:staff:update"),
  validate({ params: actionParamsSchema, body: userManagementUpdateUserSchema }),
  asyncHandler(updateUserAccessController)
);

adminRouter.delete(
  "/users/:id",
  authorize("admin:staff:delete"),
  validate({ params: actionParamsSchema }),
  asyncHandler(removeUserController)
);

adminRouter.post(
  "/users/invitations",
  authorize("admin:staff:create"),
  validate({ body: userManagementInviteSchema }),
  asyncHandler(inviteUserController)
);

adminRouter.get(
  "/users/invitations",
  authorize("admin:staff:view"),
  validate({ query: userManagementInvitationQuerySchema }),
  asyncHandler(listPendingInvitationsController)
);

adminRouter.post(
  "/users/invitations/:id/resend",
  authorize("admin:staff:update"),
  validate({ params: actionParamsSchema }),
  asyncHandler(resendInvitationController)
);

adminRouter.get(
  "/users/groups",
  authorize("admin:staff:view"),
  validate({ query: userManagementGroupQuerySchema }),
  asyncHandler(listUserGroupsController)
);

adminRouter.post(
  "/users/groups",
  authorize("admin:staff:create"),
  validate({ body: userManagementCreateGroupSchema }),
  asyncHandler(createUserGroupController)
);

adminRouter.patch(
  "/users/groups/:id",
  authorize("admin:staff:update"),
  validate({ params: actionParamsSchema, body: userManagementUpdateGroupSchema }),
  asyncHandler(updateUserGroupController)
);

adminRouter.delete(
  "/users/groups/:id",
  authorize("admin:staff:delete"),
  validate({ params: actionParamsSchema }),
  asyncHandler(deleteUserGroupController)
);

adminRouter.use("/departments", createCrudRouter(departmentsCrudOptions));
adminRouter.use("/teams", createCrudRouter(teamsCrudOptions));
adminRouter.use("/staff", createCrudRouter(staffCrudOptions));
adminRouter.use("/system-config", createCrudRouter(systemConfigCrudOptions));

adminRouter.get("/roles", authorize("admin:roles:view"), asyncHandler(listRolesController));

adminRouter.get("/roles/templates", authorize("admin:roles:view"), asyncHandler(listRoleTemplatesController));

adminRouter.get(
  "/roles/permission-catalog",
  authorize("admin:roles:view"),
  asyncHandler(getRolePermissionCatalogController)
);

adminRouter.get(
  "/roles/:id",
  authorize("admin:roles:view"),
  validate({ params: actionParamsSchema }),
  asyncHandler(getRoleByIdController)
);

adminRouter.post(
  "/roles",
  authorize("admin:roles:create"),
  validate({ body: roleCreateSchema }),
  asyncHandler(createRoleController)
);

adminRouter.patch(
  "/roles/:id",
  authorize("admin:roles:update"),
  validate({ params: actionParamsSchema, body: roleUpdateSchema }),
  asyncHandler(updateRoleController)
);

adminRouter.post(
  "/roles/:id/clone",
  authorize("admin:roles:create"),
  validate({ params: actionParamsSchema, body: roleCloneSchema }),
  asyncHandler(cloneRoleController)
);

adminRouter.delete(
  "/roles/:id",
  authorize("admin:roles:delete"),
  validate({ params: actionParamsSchema }),
  asyncHandler(deleteRoleController)
);
