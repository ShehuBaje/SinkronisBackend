import type { Prisma } from "@prisma/client";
import type { PermissionKey } from "../auth/permissions";

export type QuickAction = {
  key: "invite-user" | "manage-modules" | "view-audit-log" | "security-settings";
  title: string;
  description: string;
  permission: PermissionKey;
};

export type AdminAuditLogInput = {
  organizationId?: string;
  actorUserId?: string;
  action: string;
  resource: string;
  resourceId?: string;
  summary: string;
  metadata?: Prisma.InputJsonValue;
};

export type AuditLogRow = {
  id: string;
  actorUserId?: string | null;
  sequence?: number | null;
  action: string;
  resource: string;
  resourceId: string | null;
  summary: string;
  metadata: unknown;
  previousHash?: string | null;
  hash?: string | null;
  createdAt: Date;
  actorUser?: { id: string; firstName: string; lastName: string; email: string } | null;
};

export type SystemAlertRow = {
  id: string;
  key: string;
  title: string;
  message: string;
  severity: string;
  status: string;
  createdAt: Date;
  updatedAt: Date;
};

export const tenantNotificationChannelKeys = ["IN_APP", "EMAIL"] as const;
export const tenantNotificationModuleKeys = ["hris", "payroll", "accounting"] as const;
export const platformAnnouncementTypes = ["FEATURE", "MAINTENANCE", "SECURITY", "UPDATE"] as const;

export type TenantNotificationChannelKey = (typeof tenantNotificationChannelKeys)[number];
export type TenantNotificationModuleKey = (typeof tenantNotificationModuleKeys)[number];
export type PlatformAnnouncementType = (typeof platformAnnouncementTypes)[number];
export type NotificationModuleStatus = "ENABLED" | "PARTIAL" | "DISABLED";

export interface NotificationCategoryPreference {
  notificationId: string;
  categoryKey: string;
  categoryName: string;
  description: string;
  enabled: boolean;
}

export interface NotificationModulePreference {
  moduleKey: string;
  moduleName: string;
  moduleStatus: NotificationModuleStatus;
  toggleAll: boolean;
  notifications: NotificationCategoryPreference[];
}

export interface NotificationChannelPreferences {
  channel: { id: string; key: string; name: string; description: string | null };
  modules: NotificationModulePreference[];
}

export interface PlatformAnnouncementResponse {
  announcementId: string;
  title: string;
  summary: string;
  fullDescription: string;
  announcementType: string;
  contentFormat: string;
  createdDate: Date;
  publishedDate: Date | null;
  readStatus: "READ" | "UNREAD";
  readAt: Date | null;
  learnMoreUrl: string | null;
  contentReference: string | null;
  expiryDate: Date | null;
}

export const supportedLanguages = [
  { code: "en", name: "English" }, { code: "fr", name: "French" }, { code: "ar", name: "Arabic" }
] as const;
export const supportedDateFormats = ["DD/MM/YYYY", "MM/DD/YYYY", "YYYY-MM-DD", "DD-MMM-YYYY"] as const;
export const supportedCurrencies = [
  { code: "NGN", name: "Nigerian Naira" }, { code: "USD", name: "US Dollar" },
  { code: "GBP", name: "British Pound" }, { code: "EUR", name: "Euro" }
] as const;

export type SupportedLanguage = (typeof supportedLanguages)[number]["code"];
export type SupportedDateFormat = (typeof supportedDateFormats)[number];
export type SupportedCurrency = (typeof supportedCurrencies)[number]["code"];

export interface LocaleSettingsResponse {
  timeZone: string; language: SupportedLanguage; dateFormat: SupportedDateFormat; currency: SupportedCurrency;
}
export interface BrandingSettingsResponse {
  logoUrl: string | null; fileName: string | null; uploadTimestamp: Date | null; accentColor: string; linkText: string | null;
  logoMetadata: { mimeType: string | null; size: number | null; width: number | null; height: number | null };
}
