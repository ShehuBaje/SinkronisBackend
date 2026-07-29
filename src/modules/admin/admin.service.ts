import type { Request } from "express";
import type { Prisma } from "@prisma/client";
import crypto from "crypto";
import fs from "node:fs/promises";
import path from "node:path";
import bcrypt from "bcryptjs";
import { env } from "../../config/env";
import { badRequest, notFound } from "../../core/http-error";
import { getPagination } from "../../core/pagination";
import { prisma } from "../../core/prisma";
import { permissions } from "../auth/permissions";
import type { PermissionKey } from "../auth/permissions";
import { createAuditLog, extractEntityId } from "./admin.audit";
import { deriveActiveModules, syncSystemAlerts } from "./admin.dashboard";
import { billingPlans as sharedBillingPlans, calculateBillingAmount, modulePrices, type BillingCycle, type BillingPlanDefinition, type BillingPlanKey } from "../billing/billing.catalog";
import { getEffectivePlanCatalogue, resolveRecurringPrices, sumMoney } from "../billing/pricing.service";
import { sendSubscriptionRenewalEmail } from "../auth/auth.mailer";
import { deriveSubscriptionStatus, isRenewalReminderDue } from "../billing/billing.rules";
import { supportedCurrencies, supportedDateFormats, supportedLanguages, type AdminAuditLogInput, type AuditLogRow, type BrandingSettingsResponse, type LocaleSettingsResponse, type NotificationChannelPreferences, type PlatformAnnouncementResponse, type QuickAction, type SystemAlertRow, type TenantNotificationChannelKey } from "./admin.interface";
import {
  branchCreateSchema,
  branchUpdateSchema,
  departmentCreateSchema,
  departmentUpdateSchema,
  employeeCreateSchema,
  employeeUpdateSchema,
  organizationUpdateSchema,
  roleCloneSchema,
  roleCreateSchema,
  roleUpdateSchema,
  securityPasswordPolicySchema,
  securityTwoFactorSchema,
  securitySessionsQuerySchema,
  securityRevokeSessionSchema,
  securityRevokeSessionsBulkSchema,
  ipAllowlistToggleSchema,
  ipAllowlistEntryCreateSchema,
  loginActivityQuerySchema,
  auditLogQuerySchema,
  myPlanAddonUpdateSchema,
  myPlanAddCardSchema,
  myPlanBillingAddressSchema,
  myPlanBillingAnalyticsQuerySchema,
  myPlanBillingHistoryQuerySchema,
  myPlanCancelCardCreationSchema,
  myPlanCancelSubscriptionSchema,
  myPlanLocationOptionsQuerySchema,
  myPlanChangeSchema,
  myPlanPurchaseSchema,
  myPlanRenewalNotificationSchema,
  myPlanPaymentMethodSchema,
  announcementListQuerySchema,
  notificationToggleSchema,
  brandingSettingsSchema,
  localeOptionsQuerySchema,
  localeSettingsSchema,
  organizationDeletionRequestSchema,
  myPlanCardUpdateSchema,
  systemConfigCreateSchema,
  systemConfigUpdateSchema,
  teamCreateSchema,
  teamUpdateSchema,
  userManagementCreateGroupSchema,
  userManagementInviteSchema,
  userManagementUpdateGroupSchema,
  userManagementUpdateUserSchema,
  workScheduleUpsertSchema
} from "./admin.validation";

type AuditLogDelegate = {
  findMany: (args: Record<string, unknown>) => Promise<AuditLogRow[]>;
};

type SystemAlertDelegate = {
  findMany: (args: Record<string, unknown>) => Promise<SystemAlertRow[]>;
  findFirst: (args: Record<string, unknown>) => Promise<(SystemAlertRow & { isActive?: boolean }) | null>;
  update: (args: Record<string, unknown>) => Promise<SystemAlertRow>;
};

type WorkScheduleDelegate = {
  findUnique: (args: Record<string, unknown>) => Promise<Record<string, unknown> | null>;
  upsert: (args: Record<string, unknown>) => Promise<Record<string, unknown>>;
};

type BranchDelegate = {
  findMany: (args: Record<string, unknown>) => Promise<Array<Record<string, unknown>>>;
  count: (args: Record<string, unknown>) => Promise<number>;
  findFirst: (args: Record<string, unknown>) => Promise<Record<string, unknown> | null>;
  create: (args: Record<string, unknown>) => Promise<Record<string, unknown>>;
  update: (args: Record<string, unknown>) => Promise<Record<string, unknown>>;
  delete: (args: Record<string, unknown>) => Promise<Record<string, unknown>>;
};

type AgentInvitationRow = {
  id: string;
  organizationId: string;
  roleId?: string | null;
  invitedByUserId?: string | null;
  email: string;
  token: string;
  moduleAccess?: unknown;
  status: string;
  expiresAt: Date;
  acceptedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  role?: { id?: string; name?: string } | null;
};

type AgentInvitationDelegate = {
  create: (args: Record<string, unknown>) => Promise<AgentInvitationRow>;
  findMany: (args: Record<string, unknown>) => Promise<AgentInvitationRow[]>;
  findFirst: (args: Record<string, unknown>) => Promise<AgentInvitationRow | null>;
  update: (args: Record<string, unknown>) => Promise<AgentInvitationRow>;
  count: (args: Record<string, unknown>) => Promise<number>;
};

type RoleWithPermissionsRow = {
  id: string;
  organizationId: string;
  name: string;
  description: string | null;
  isSystem: boolean;
  createdAt: Date;
  updatedAt: Date;
  permissions: Array<{
    permission: {
      key: string;
    };
  }>;
};

type PermissionActionGroup = {
  action: string;
  key: PermissionKey;
  label: string;
  description: string;
};

type PermissionResourceGroup = {
  resource: string;
  label: string;
  permissions: Array<{
    key: PermissionKey;
    action: string;
    label: string;
    description: string;
  }>;
  actions: Record<string, PermissionActionGroup>;
};

type PermissionModuleGroup = {
  module: string;
  label: string;
  permissions: Array<{
    key: PermissionKey;
    resource: string;
    action: string;
    label: string;
    description: string;
  }>;
  actions: Record<string, Array<{
    key: PermissionKey;
    resource: string;
    action: string;
    label: string;
    description: string;
  }>>;
  resources: PermissionResourceGroup[];
};

const auditLogDelegate = (prisma as unknown as { auditLog: AuditLogDelegate }).auditLog;
const systemAlertDelegate = (prisma as unknown as { systemAlert: SystemAlertDelegate }).systemAlert;
const workScheduleDelegate = (prisma as unknown as { workSchedule: WorkScheduleDelegate }).workSchedule;
const branchDelegate = (prisma as unknown as { branch: BranchDelegate }).branch;
const invitationDelegate = (prisma as unknown as { agentInvitation: AgentInvitationDelegate }).agentInvitation;
const prismaAny = prisma as any;

const normalizeRole = (role: RoleWithPermissionsRow) => ({
  id: role.id,
  organizationId: role.organizationId,
  name: role.name,
  description: role.description,
  isSystem: role.isSystem,
  canModify: !role.isSystem,
  canDelete: !role.isSystem,
  lockedReason: role.isSystem ? "System roles are read-only" : null,
  createdAt: role.createdAt,
  updatedAt: role.updatedAt,
  permissions: role.permissions.map((row) => row.permission.key),
  permissionGroups: buildPermissionGroups(role.permissions.map((row) => row.permission.key as PermissionKey))
});

const quickActions: QuickAction[] = [
  {
    key: "invite-user",
    title: "Invite user",
    description: "Invite teammates into your tenant.",
    permission: "accounting:agents:view"
  },
  {
    key: "manage-modules",
    title: "Manage modules",
    description: "Enable or disable tenant modules.",
    permission: "admin:system-config:view"
  },
  {
    key: "view-audit-log",
    title: "View audit log",
    description: "Inspect security and change history.",
    permission: "admin:organization:view"
  },
  {
    key: "security-settings",
    title: "Security settings",
    description: "Review auth and permission posture.",
    permission: "admin:roles:view"
  }
];

const workDays = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"] as const;
const appModules = ["HRIS", "ACCOUNTING", "PAYROLL"] as const;
const invitationTtlDays = 7;
const roleTemplateKeys = ["SYSTEM_ADMIN", "MANAGER", "ACCOUNTANT", "EMPLOYEE"] as const;
const managedModuleKeys = ["hris", "accounting", "payroll"] as const;

type AppModule = (typeof appModules)[number];
type RoleTemplateKey = (typeof roleTemplateKeys)[number];
type ManagedModuleKey = (typeof managedModuleKeys)[number];
type ManagedModuleStatus = "ACTIVE" | "INACTIVE" | "COMING_SOON";

type ManagedModuleDefinition = {
  key: ManagedModuleKey;
  name: string;
  description: string;
  tabs: string[];
  defaultStatus: ManagedModuleStatus;
  openPath: string;
};

const managedModules: ManagedModuleDefinition[] = [
  {
    key: "hris",
    name: "HRIS",
    description:
      "Manages the entire employee lifecycle including onboarding, attendance, leave, appraisals, and disciplinary records.",
    tabs: [
      "Employee Lifecycle",
      "Attendance",
      "Leave Management",
      "Performance Appraisals",
      "Discipline Management"
    ],
    defaultStatus: "ACTIVE",
    openPath: "/hris"
  },
  {
    key: "accounting",
    name: "Accounting",
    description:
      "Full featured accounting suite for invoicing, expense tracking, VAT compliance, agent payouts, and financial reporting.",
    tabs: [
      "Invoicing",
      "Expense Tracking",
      "VAT Compliance",
      "Agents",
      "Financial Reporting"
    ],
    defaultStatus: "ACTIVE",
    openPath: "/accounting"
  },
  {
    key: "payroll",
    name: "Payroll",
    description:
      "Automates salary computations, statutory deductions (PAYE, pension, NHF), payslip generation, and bank transfer workflows.",
    tabs: [
      "Salary Computation",
      "PAYE Deductions",
      "Pension Deductions",
      "Payslip Generation",
      "Bank Integration"
    ],
    defaultStatus: "INACTIVE",
    openPath: "/payroll"
  }
];

type BillingSubscriptionStatus = "ACTIVE" | "PENDING" | "EXPIRED" | "CANCELLED" | "TRIALING" | "PAST_DUE";
const billingPlans = sharedBillingPlans;
const moduleAddOnPrices = modulePrices;

const moduleAddOnDefinitions: Partial<
  Record<
    ManagedModuleKey,
    {
      title: string;
      badge: string;
      description: string;
      infoMessage: string;
      icon: string;
      billingCycle: BillingCycle;
    }
  >
> = Object.fromEntries(["hris", "payroll", "accounting"].map((key) => [key, {
  title: `${key === "hris" ? "HRIS" : key[0].toUpperCase() + key.slice(1)} Module`, badge: "Individual module",
  description: "An independent monthly module subscription.", infoMessage: "Added modules are billed monthly.",
  icon: "module", billingCycle: "MONTHLY"
}])) as any;

const billingConfigKeys = {
  subscription: "billing.subscription",
  paymentMethod: "billing.paymentMethod",
  billingAddress: "billing.address",
  invoices: "billing.invoices",
  addOnSubscriptionPrefix: "billing.addons"
} as const;

const countryCodes = [
  "AD",
  "AE",
  "AF",
  "AG",
  "AI",
  "AL",
  "AM",
  "AO",
  "AQ",
  "AR",
  "AS",
  "AT",
  "AU",
  "AW",
  "AX",
  "AZ",
  "BA",
  "BB",
  "BD",
  "BE",
  "BF",
  "BG",
  "BH",
  "BI",
  "BJ",
  "BL",
  "BM",
  "BN",
  "BO",
  "BQ",
  "BR",
  "BS",
  "BT",
  "BV",
  "BW",
  "BY",
  "BZ",
  "CA",
  "CC",
  "CD",
  "CF",
  "CG",
  "CH",
  "CI",
  "CK",
  "CL",
  "CM",
  "CN",
  "CO",
  "CR",
  "CU",
  "CV",
  "CW",
  "CX",
  "CY",
  "CZ",
  "DE",
  "DJ",
  "DK",
  "DM",
  "DO",
  "DZ",
  "EC",
  "EE",
  "EG",
  "EH",
  "ER",
  "ES",
  "ET",
  "FI",
  "FJ",
  "FK",
  "FM",
  "FO",
  "FR",
  "GA",
  "GB",
  "GD",
  "GE",
  "GF",
  "GG",
  "GH",
  "GI",
  "GL",
  "GM",
  "GN",
  "GP",
  "GQ",
  "GR",
  "GS",
  "GT",
  "GU",
  "GW",
  "GY",
  "HK",
  "HM",
  "HN",
  "HR",
  "HT",
  "HU",
  "ID",
  "IE",
  "IL",
  "IM",
  "IN",
  "IO",
  "IQ",
  "IR",
  "IS",
  "IT",
  "JE",
  "JM",
  "JO",
  "JP",
  "KE",
  "KG",
  "KH",
  "KI",
  "KM",
  "KN",
  "KP",
  "KR",
  "KW",
  "KY",
  "KZ",
  "LA",
  "LB",
  "LC",
  "LI",
  "LK",
  "LR",
  "LS",
  "LT",
  "LU",
  "LV",
  "LY",
  "MA",
  "MC",
  "MD",
  "ME",
  "MF",
  "MG",
  "MH",
  "MK",
  "ML",
  "MM",
  "MN",
  "MO",
  "MP",
  "MQ",
  "MR",
  "MS",
  "MT",
  "MU",
  "MV",
  "MW",
  "MX",
  "MY",
  "MZ",
  "NA",
  "NC",
  "NE",
  "NF",
  "NG",
  "NI",
  "NL",
  "NO",
  "NP",
  "NR",
  "NU",
  "NZ",
  "OM",
  "PA",
  "PE",
  "PF",
  "PG",
  "PH",
  "PK",
  "PL",
  "PM",
  "PN",
  "PR",
  "PS",
  "PT",
  "PW",
  "PY",
  "QA",
  "RE",
  "RO",
  "RS",
  "RU",
  "RW",
  "SA",
  "SB",
  "SC",
  "SD",
  "SE",
  "SG",
  "SH",
  "SI",
  "SJ",
  "SK",
  "SL",
  "SM",
  "SN",
  "SO",
  "SR",
  "SS",
  "ST",
  "SV",
  "SX",
  "SY",
  "SZ",
  "TC",
  "TD",
  "TF",
  "TG",
  "TH",
  "TJ",
  "TK",
  "TL",
  "TM",
  "TN",
  "TO",
  "TR",
  "TT",
  "TV",
  "TW",
  "TZ",
  "UA",
  "UG",
  "UM",
  "US",
  "UY",
  "UZ",
  "VA",
  "VC",
  "VE",
  "VG",
  "VI",
  "VN",
  "VU",
  "WF",
  "WS",
  "YE",
  "YT",
  "ZA",
  "ZM",
  "ZW"
] as const;

const stateOptionsByCountry: Record<string, Array<{ value: string; label: string }>> = {
  NG: [
    "Abia",
    "Adamawa",
    "Akwa Ibom",
    "Anambra",
    "Bauchi",
    "Bayelsa",
    "Benue",
    "Borno",
    "Cross River",
    "Delta",
    "Ebonyi",
    "Edo",
    "Ekiti",
    "Enugu",
    "Federal Capital Territory",
    "Gombe",
    "Imo",
    "Jigawa",
    "Kaduna",
    "Kano",
    "Katsina",
    "Kebbi",
    "Kogi",
    "Kwara",
    "Lagos",
    "Nasarawa",
    "Niger",
    "Ogun",
    "Ondo",
    "Osun",
    "Oyo",
    "Plateau",
    "Rivers",
    "Sokoto",
    "Taraba",
    "Yobe",
    "Zamfara"
  ].map((state) => ({ value: state, label: state })),
  US: [
    "Alabama",
    "Alaska",
    "Arizona",
    "Arkansas",
    "California",
    "Colorado",
    "Connecticut",
    "Delaware",
    "District of Columbia",
    "Florida",
    "Georgia",
    "Hawaii",
    "Idaho",
    "Illinois",
    "Indiana",
    "Iowa",
    "Kansas",
    "Kentucky",
    "Louisiana",
    "Maine",
    "Maryland",
    "Massachusetts",
    "Michigan",
    "Minnesota",
    "Mississippi",
    "Missouri",
    "Montana",
    "Nebraska",
    "Nevada",
    "New Hampshire",
    "New Jersey",
    "New Mexico",
    "New York",
    "North Carolina",
    "North Dakota",
    "Ohio",
    "Oklahoma",
    "Oregon",
    "Pennsylvania",
    "Rhode Island",
    "South Carolina",
    "South Dakota",
    "Tennessee",
    "Texas",
    "Utah",
    "Vermont",
    "Virginia",
    "Washington",
    "West Virginia",
    "Wisconsin",
    "Wyoming"
  ].map((state) => ({ value: state, label: state })),
  GB: ["England", "Northern Ireland", "Scotland", "Wales"].map((state) => ({ value: state, label: state })),
  CA: [
    "Alberta",
    "British Columbia",
    "Manitoba",
    "New Brunswick",
    "Newfoundland and Labrador",
    "Northwest Territories",
    "Nova Scotia",
    "Nunavut",
    "Ontario",
    "Prince Edward Island",
    "Quebec",
    "Saskatchewan",
    "Yukon"
  ].map((state) => ({ value: state, label: state })),
  AU: [
    "Australian Capital Territory",
    "New South Wales",
    "Northern Territory",
    "Queensland",
    "South Australia",
    "Tasmania",
    "Victoria",
    "Western Australia"
  ].map((state) => ({ value: state, label: state }))
};

const addDays = (date: Date, days: number) => {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
};

const addMonths = (date: Date, months: number) => {
  const next = new Date(date);
  next.setMonth(next.getMonth() + months);
  return next;
};

const cancellationWarning =
  "All users will lose access at the end of the current billing period. Your data will be retained for 30 days after cancellation.";

const getYearRange = (year: number) => ({
  start: new Date(Date.UTC(year, 0, 1)),
  end: new Date(Date.UTC(year + 1, 0, 1))
});

const getMonthRange = (date: Date) => ({
  start: new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1)),
  end: new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1))
});

const parseExpiryDate = (expiryDate: string) => {
  const normalized = expiryDate.replace(/\s/g, "");
  const match = normalized.match(/^(0[1-9]|1[0-2])\/?([0-9]{2}|[0-9]{4})$/);
  if (!match) throw badRequest("Expiry date must be MM/YY or MM/YYYY");

  const expMonth = Number(match[1]);
  const yearPart = match[2];
  const expYear = yearPart.length === 2 ? 2000 + Number(yearPart) : Number(yearPart);
  const now = new Date();
  const expiryEnd = new Date(Date.UTC(expYear, expMonth, 0, 23, 59, 59));

  if (expiryEnd < now) {
    throw badRequest("Card expiry date must be in the future");
  }

  return { expMonth, expYear };
};

const detectCardBrand = (cardNumber: string) => {
  if (/^4/.test(cardNumber)) return "Visa";
  if (/^(5[1-5]|2[2-7])/.test(cardNumber)) return "Mastercard";
  if (/^3[47]/.test(cardNumber)) return "American Express";
  if (/^6(?:011|5)/.test(cardNumber)) return "Discover";
  if (/^(506|6500|5078|5079|650)/.test(cardNumber)) return "Verve";
  return "Card";
};

const createProviderCardToken = async (payload: {
  organizationId: string;
  last4: string;
  brand: string;
  expMonth: number;
  expYear: number;
}) => {
  const provider = process.env.PAYMENT_PROVIDER || "internal";
  const tokenSeed = `${payload.organizationId}:${payload.brand}:${payload.last4}:${payload.expMonth}:${payload.expYear}:${Date.now()}`;
  const token = `card_${Buffer.from(tokenSeed).toString("base64url").slice(0, 32)}`;

  return {
    provider,
    token
  };
};

type WorkScheduleInput = {
  monday: boolean;
  tuesday: boolean;
  wednesday: boolean;
  thursday: boolean;
  friday: boolean;
  saturday: boolean;
  sunday: boolean;
  workStartTime: string;
  workEndTime: string;
  breakDurationMinutes: number;
};

const roleTemplates: Array<{
  key: RoleTemplateKey;
  name: string;
  description: string;
  permissionKeys: PermissionKey[];
}> = [
  {
    key: "SYSTEM_ADMIN",
    name: "System Admin",
    description: "Full administrative access across all currently available modules and settings.",
    permissionKeys: [...permissions]
  },
  {
    key: "MANAGER",
    name: "Manager",
    description: "Operational manager with HR and team-level administrative access.",
    permissionKeys: [
      "admin:departments:view",
      "admin:departments:create",
      "admin:departments:update",
      "admin:departments:delete",
      "admin:teams:view",
      "admin:teams:create",
      "admin:teams:update",
      "admin:teams:delete",
      "admin:staff:view",
      "admin:staff:create",
      "admin:staff:update",
      "admin:staff:delete",
      "hris:employees:view",
      "hris:employees:create",
      "hris:employees:update",
      "hris:attendance:view",
      "hris:attendance:create",
      "hris:attendance:update",
      "hris:leave:view",
      "hris:leave:create",
      "hris:leave:update",
      "hris:leave:approve",
      "hris:appraisals:view",
      "hris:appraisals:create",
      "hris:appraisals:update",
      "hris:conduct:view",
      "hris:conduct:create",
      "hris:conduct:update"
    ]
  },
  {
    key: "ACCOUNTANT",
    name: "Accountant",
    description: "Finance-focused role covering accounting and payroll administration.",
    permissionKeys: [
      "accounting:clients:view",
      "accounting:clients:create",
      "accounting:clients:update",
      "accounting:clients:delete",
      "accounting:invoices:view",
      "accounting:invoices:create",
      "accounting:invoices:update",
      "accounting:invoices:delete",
      "accounting:payments:view",
      "accounting:payments:create",
      "accounting:payments:update",
      "accounting:payments:approve",
      "accounting:tax:view",
      "accounting:tax:create",
      "accounting:tax:update",
      "accounting:tax:delete",
      "accounting:wallets:view",
      "accounting:wallets:create",
      "accounting:wallets:update",
      "accounting:wallets:delete",
      "accounting:agents:view",
      "payroll:runs:view",
      "payroll:runs:create",
      "payroll:runs:update",
      "payroll:runs:approve",
      "payroll:salary:view",
      "payroll:salary:create",
      "payroll:salary:update",
      "payroll:statutory:view",
      "payroll:statutory:create",
      "payroll:statutory:update",
      "payroll:statutory:delete",
      "payroll:payslips:view",
      "payroll:payslips:create",
      "payroll:payslips:update",
      "payroll:loans:view",
      "payroll:loans:create",
      "payroll:loans:update",
      "payroll:loans:approve"
    ]
  },
  {
    key: "EMPLOYEE",
    name: "Employee",
    description: "Starter template with no admin permissions assigned by default.",
    permissionKeys: []
  }
];

const assertHeadEmployeeInOrganization = async (organizationId: string, headEmployeeId?: string) => {
  if (!headEmployeeId) return;

  const headEmployee = await prisma.employee.findFirst({
    where: { id: headEmployeeId, organizationId },
    select: { id: true }
  });

  if (!headEmployee) {
    throw badRequest(
      "Selected head employee was not found in this organization. Create an employee first or submit without headEmployeeId"
    );
  }
};

const summarizeWorkSchedule = (schedule: WorkScheduleInput) => {
  const workingDays = workDays.filter((day) => schedule[day]).length;

  return {
    workingDays,
    workStartTime: schedule.workStartTime,
    workEndTime: schedule.workEndTime,
    breakDurationMinutes: schedule.breakDurationMinutes
  };
};

const deriveModulesFromPermissions = (permissions: string[]): AppModule[] => {
  const modules = new Set<AppModule>();

  if (permissions.some((permission) => permission.startsWith("hris:"))) modules.add("HRIS");
  if (permissions.some((permission) => permission.startsWith("accounting:"))) modules.add("ACCOUNTING");
  if (permissions.some((permission) => permission.startsWith("payroll:"))) modules.add("PAYROLL");

  return [...modules];
};

const titleCase = (value: string) =>
  value
    .split(/[-_]/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");

const preferredActionOrder = ["view", "create", "update", "delete", "approve"] as const;

const sortActionKeys = (left: string, right: string) => {
  const leftRank = preferredActionOrder.indexOf(left as (typeof preferredActionOrder)[number]);
  const rightRank = preferredActionOrder.indexOf(right as (typeof preferredActionOrder)[number]);

  const normalizedLeftRank = leftRank === -1 ? preferredActionOrder.length : leftRank;
  const normalizedRightRank = rightRank === -1 ? preferredActionOrder.length : rightRank;

  if (normalizedLeftRank !== normalizedRightRank) {
    return normalizedLeftRank - normalizedRightRank;
  }

  return left.localeCompare(right);
};

const getRoleTemplateByKey = (templateKey: RoleTemplateKey) => {
  const template = roleTemplates.find((roleTemplate) => roleTemplate.key === templateKey);
  if (!template) throw badRequest("Role template not found");
  return template;
};

const findRoleWithPermissions = async (organizationId: string, id: string) => {
  const role = await prisma.role.findFirst({
    where: { id, organizationId },
    include: { permissions: { include: { permission: true } } }
  });

  return role as RoleWithPermissionsRow | null;
};

const assertRoleIsMutable = (role: { isSystem: boolean }) => {
  if (role.isSystem) {
    throw badRequest("System roles cannot be modified or deleted");
  }
};

const resolvePermissionRecords = async (permissionKeys: PermissionKey[]) => {
  const uniquePermissionKeys = [...new Set(permissionKeys)];

  if (!uniquePermissionKeys.length) {
    return {
      permissionRows: [] as Array<{ id: string; key: string }>,
      permissionKeys: uniquePermissionKeys
    };
  }

  const permissionRows = await prisma.permission.findMany({
    where: { key: { in: uniquePermissionKeys } },
    select: { id: true, key: true }
  });

  const foundKeys = new Set(permissionRows.map((permission) => permission.key));
  const invalidPermissionKeys = uniquePermissionKeys.filter((permissionKey) => !foundKeys.has(permissionKey));

  if (invalidPermissionKeys.length > 0) {
    throw badRequest("Some permission keys are invalid or not initialized", { invalidPermissionKeys });
  }

  return { permissionRows, permissionKeys: uniquePermissionKeys };
};

const resolveCreateRolePermissionKeys = async (organizationId: string, payload: ReturnType<typeof roleCreateSchema.parse>) => {
  if (payload.permissionKeys.length > 0) return payload.permissionKeys;

  if (payload.cloneFromRoleId) {
    const sourceRole = await findRoleWithPermissions(organizationId, payload.cloneFromRoleId);
    if (!sourceRole) throw badRequest("Source role not found in this organization");
    return sourceRole.permissions.map((row) => row.permission.key as PermissionKey);
  }

  if (payload.templateKey) {
    return getRoleTemplateByKey(payload.templateKey).permissionKeys;
  }

  return [];
};

const hasFullPermissionAccess = (permissionKeys: PermissionKey[]) => {
  const uniquePermissionKeys = new Set(permissionKeys);
  return permissions.every((permission) => uniquePermissionKeys.has(permission));
};

const assertNonSystemRoleAccessScope = (permissionKeys: PermissionKey[]) => {
  if (hasFullPermissionAccess(permissionKeys)) {
    throw badRequest("Only the Owner system role can have unrestricted access across all modules and actions");
  }
};

const buildRoleCopyName = async (organizationId: string, baseName: string) => {
  let candidate = baseName;
  let suffix = 2;

  while (await prisma.role.findFirst({ where: { organizationId, name: candidate }, select: { id: true } })) {
    candidate = `${baseName} ${suffix}`;
    suffix += 1;
  }

  return candidate;
};

const buildPermissionCatalog = () => {
  const groupedCatalog = new Map<
    string,
    {
      module: string;
      label: string;
      resources: Map<
        string,
        {
          resource: string;
          label: string;
          permissions: Array<{
            key: PermissionKey;
            resource: string;
            action: string;
            label: string;
            description: string;
          }>;
          actions: Map<
            string,
            {
              key: PermissionKey;
              resource: string;
              action: string;
              label: string;
              description: string;
            }
          >;
        }
      >;
      actions: Map<
        string,
        Array<{
          key: PermissionKey;
          resource: string;
          action: string;
          label: string;
          description: string;
        }>
      >;
      permissions: Array<{
        key: PermissionKey;
        resource: string;
        action: string;
        label: string;
        description: string;
      }>;
    }
  >();

  for (const permissionKey of permissions) {
    const [module, resource, action] = permissionKey.split(":") as [string, string, string];
    const groupKey = module.toUpperCase();
    const existingGroup = groupedCatalog.get(groupKey) ?? {
      module: groupKey,
      label: titleCase(module),
      resources: new Map(),
      actions: new Map(),
      permissions: [] as Array<{
        key: PermissionKey;
        resource: string;
        action: string;
        label: string;
        description: string;
      }>
    };

    const permissionEntry = {
      key: permissionKey,
      resource,
      action,
      label: `${titleCase(action)} ${titleCase(resource)}`,
      description: `${titleCase(action)} access for ${titleCase(resource)} in the ${titleCase(module)} module`
    };

    existingGroup.permissions.push(permissionEntry);

    const actionPermissions = existingGroup.actions.get(action) ?? [];
    actionPermissions.push(permissionEntry);
    existingGroup.actions.set(action, actionPermissions);

    const resourceEntry = existingGroup.resources.get(resource) ?? {
      resource,
      label: titleCase(resource),
      permissions: [] as Array<{
        key: PermissionKey;
        resource: string;
        action: string;
        label: string;
        description: string;
      }>,
      actions: new Map()
    };

    resourceEntry.permissions.push(permissionEntry);
    resourceEntry.actions.set(action, permissionEntry);
    existingGroup.resources.set(resource, resourceEntry);

    groupedCatalog.set(groupKey, existingGroup);
  }

  return [...groupedCatalog.values()].map((group) => ({
    ...group,
    permissions: group.permissions.sort((left, right) => left.label.localeCompare(right.label)),
    actions: Object.fromEntries(
      [...group.actions.entries()]
        .sort(([leftAction], [rightAction]) => sortActionKeys(leftAction, rightAction))
        .map(([action, actionPermissions]) => [
          action,
          actionPermissions.sort((left, right) => left.label.localeCompare(right.label))
        ])
    ),
    resources: [...group.resources.values()]
      .map((resource) => ({
        resource: resource.resource,
        label: resource.label,
        permissions: resource.permissions.sort((left, right) => left.label.localeCompare(right.label)),
        actions: Object.fromEntries(
          [...resource.actions.entries()]
            .sort(([leftAction], [rightAction]) => sortActionKeys(leftAction, rightAction))
            .map(([action, permission]) => [action, permission])
        )
      }))
      .sort((left, right) => left.label.localeCompare(right.label))
  }));
};

const buildPermissionGroups = (permissionKeys: PermissionKey[]): PermissionModuleGroup[] => {
  const groupedPermissions = new Map<
    string,
    {
      module: string;
      label: string;
      permissions: Array<{
        key: PermissionKey;
        resource: string;
        action: string;
        label: string;
        description: string;
      }>;
      actions: Map<
        string,
        Array<{
          key: PermissionKey;
          resource: string;
          action: string;
          label: string;
          description: string;
        }>
      >;
      resources: Map<
        string,
        {
          resource: string;
          label: string;
          permissions: Array<{
            key: PermissionKey;
            action: string;
            label: string;
            description: string;
          }>;
          actions: Map<string, PermissionActionGroup>;
        }
      >;
    }
  >();

  for (const permissionKey of permissionKeys) {
    const [module, resource, action] = permissionKey.split(":") as [string, string, string];
    const groupKey = module.toUpperCase();

    const existingGroup = groupedPermissions.get(groupKey) ?? {
      module: groupKey,
      label: titleCase(module),
      permissions: [] as Array<{
        key: PermissionKey;
        resource: string;
        action: string;
        label: string;
        description: string;
      }>,
      actions: new Map(),
      resources: new Map()
    };

    const entry = {
      key: permissionKey,
      resource,
      action,
      label: `${titleCase(action)} ${titleCase(resource)}`,
      description: `${titleCase(action)} access for ${titleCase(resource)} in the ${titleCase(module)} module`
    };

    existingGroup.permissions.push(entry);

    const actionEntries = existingGroup.actions.get(action) ?? [];
    actionEntries.push(entry);
    existingGroup.actions.set(action, actionEntries);

    const resourceEntry = existingGroup.resources.get(resource) ?? {
      resource,
      label: titleCase(resource),
      permissions: [] as Array<{
        key: PermissionKey;
        action: string;
        label: string;
        description: string;
      }>,
      actions: new Map()
    };

    resourceEntry.permissions.push({
      key: permissionKey,
      action,
      label: entry.label,
      description: entry.description
    });
    resourceEntry.actions.set(action, entry);
    existingGroup.resources.set(resource, resourceEntry);

    groupedPermissions.set(groupKey, existingGroup);
  }

  return [...groupedPermissions.values()].map((group) => ({
    ...group,
    permissions: group.permissions.sort((left, right) => left.label.localeCompare(right.label)),
    actions: Object.fromEntries(
      [...group.actions.entries()]
        .sort(([leftAction], [rightAction]) => sortActionKeys(leftAction, rightAction))
        .map(([action, actionPermissions]) => [
          action,
          actionPermissions.sort((left, right) => left.label.localeCompare(right.label))
        ])
    ),
    resources: [...group.resources.values()]
      .map((resource) => ({
        resource: resource.resource,
        label: resource.label,
        permissions: resource.permissions.sort((left, right) => left.label.localeCompare(right.label)),
        actions: Object.fromEntries(
          [...resource.actions.entries()]
            .sort(([leftAction], [rightAction]) => sortActionKeys(leftAction, rightAction))
            .map(([action, permission]) => [action, permission])
        )
      }))
      .sort((left, right) => left.label.localeCompare(right.label))
  }));
};

const getRoleUsageStats = async (organizationId: string, roleId: string) => {
  const [assignedUsers, pendingInvitations] = await Promise.all([
    prisma.user.count({ where: { organizationId, roleId } }),
    prisma.agentInvitation.count({ where: { organizationId, roleId, status: "PENDING" } })
  ]);

  return { assignedUsers, pendingInvitations };
};

const deriveInvitationStatus = (status: string, expiresAt: Date): "PENDING" | "EXPIRED" => {
  if (status === "PENDING" && expiresAt < new Date()) {
    return "EXPIRED";
  }

  return status === "EXPIRED" ? "EXPIRED" : "PENDING";
};

const parseManagedModuleStatus = (
  rawStatus: unknown,
  fallbackEnabled: boolean | undefined,
  defaultStatus: ManagedModuleStatus
): ManagedModuleStatus => {
  if (typeof rawStatus === "string") {
    const normalized = rawStatus.trim().toUpperCase();
    if (normalized === "ACTIVE" || normalized === "INACTIVE" || normalized === "COMING_SOON") {
      return normalized;
    }
  }

  if (typeof fallbackEnabled === "boolean") {
    return fallbackEnabled ? "ACTIVE" : "INACTIVE";
  }

  return defaultStatus;
};

const getManagedModuleStatusConfigKeys = () =>
  managedModules.flatMap((module) => [`module.${module.key}.status`, `module.${module.key}.enabled`]);

const countActiveUsersByModule = async (organizationId: string, moduleKey: ManagedModuleKey): Promise<number> => {
  return prisma.user.count({
    where: {
      organizationId,
      isActive: true,
      role: {
        permissions: {
          some: {
            permission: {
              key: {
                startsWith: `${moduleKey}:`
              }
            }
          }
        }
      }
    }
  });
};

const buildModuleAction = (status: ManagedModuleStatus) => {
  if (status === "COMING_SOON") {
    return {
      label: "Coming Soon",
      kind: "COMING_SOON" as const,
      canOpen: false
    };
  }

  if (status === "INACTIVE") {
    return {
      label: "Enable Module",
      kind: "ENABLE_MODULE" as const,
      canOpen: false
    };
  }

  return {
    label: "Open Module",
    kind: "OPEN_MODULE" as const,
    canOpen: true
  };
};

const getBillingPlan = async (planKey: BillingPlanKey, organizationId?: string) => {
  const plan = billingPlans.find((item) => item.key === planKey);
  if (!plan) throw badRequest("Billing plan not found");
  const managed = (await getEffectivePlanCatalogue()).find((item) => item.key === planKey);
  let monthlyCost = managed?.monthlyPrice ?? plan.monthlyCost;
  if (organizationId) {
    const resolved = await resolveRecurringPrices([{ organizationId, planKey, source: "BASE_PLAN", fallbackMonthlyPrice: monthlyCost }]);
    monthlyCost = resolved.get(`${organizationId}:${planKey}:BASE_PLAN`) ?? monthlyCost;
  }
  return { ...plan, monthlyCost, yearlyCost: monthlyCost * 12 };
};

const normalizeBillingCycle = (value: unknown): BillingCycle => {
  return value === "YEARLY" ? "YEARLY" : "MONTHLY";
};

const getConfiguredBillingValue = async <T>(organizationId: string, key: string): Promise<T | null> => {
  const row = await prisma.systemConfig.findUnique({
    where: {
      organizationId_key: {
        organizationId,
        key
      }
    },
    select: { value: true }
  });

  return (row?.value as T | undefined) ?? null;
};

const getCountryOptions = () => {
  const displayNames = new Intl.DisplayNames(["en"], { type: "region" });

  return countryCodes
    .map((code) => ({
      value: code,
      label: displayNames.of(code) ?? code
    }))
    .sort((left, right) => left.label.localeCompare(right.label));
};

const getStateOptionsForCountry = (country?: string) => {
  if (!country) {
    return {
      disabled: true,
      options: [] as Array<{ value: string; label: string }>,
      emptyState: "Select a country before choosing a state.",
      allowManualInput: false
    };
  }

  const normalizedCountry = country.toUpperCase();
  const options = stateOptionsByCountry[normalizedCountry] ?? [];

  return {
    disabled: false,
    options,
    emptyState: options.length ? null : "No states or regions are available for the selected country. Enter the state or region manually.",
    allowManualInput: options.length === 0
  };
};

const upsertBillingConfig = async (organizationId: string, key: string, value: unknown) => {
  return prisma.systemConfig.upsert({
    where: {
      organizationId_key: {
        organizationId,
        key
      }
    },
    create: {
      organizationId,
      key,
      value: value as any
    },
    update: {
      value: value as any
    }
  });
};

const getSubscriptionState = async (organizationId: string, currency: string) => {
  await applyDuePlanChanges(organizationId);
  const configured = await getConfiguredBillingValue<Record<string, unknown>>(organizationId, billingConfigKeys.subscription);
  const now = new Date();
  const renewalDate = typeof configured?.renewalDate === "string" ? new Date(configured.renewalDate) : addMonths(now, 1);
  const planKey = (typeof configured?.planKey === "string" ? configured.planKey : "hris") as BillingPlanKey;
  if (!billingPlans.some((plan) => plan.key === planKey)) {
    throw badRequest("Stored subscription plan is invalid; run the subscription plan data migration", { errorCode: "INVALID_PLAN_CONFIGURATION" });
  }

  let status = (typeof configured?.status === "string" ? configured.status : "ACTIVE") as BillingSubscriptionStatus;
  const cancelAtPeriodEnd = configured?.cancelAtPeriodEnd === true;
  const paymentVerifiedAt = typeof configured?.paymentVerifiedAt === "string" ? new Date(configured.paymentVerifiedAt) : null;
  status = deriveSubscriptionStatus({ status, now, renewalDate, cancelAtPeriodEnd, paymentVerifiedAt });
  if (configured && status !== configured.status) {
    await upsertBillingConfig(organizationId, billingConfigKeys.subscription, { ...configured, status, automaticRenewal: status === "CANCELLED" ? false : configured.automaticRenewal, lifecycleUpdatedAt: now.toISOString() });
    if (status === "CANCELLED" || status === "EXPIRED") {
      await prisma.$transaction(managedModuleKeys.flatMap((moduleKey) => [
        prisma.systemConfig.upsert({ where: { organizationId_key: { organizationId, key: `module.${moduleKey}.status` } }, create: { organizationId, key: `module.${moduleKey}.status`, value: "INACTIVE" }, update: { value: "INACTIVE" } }),
        prisma.systemConfig.upsert({ where: { organizationId_key: { organizationId, key: `module.${moduleKey}.enabled` } }, create: { organizationId, key: `module.${moduleKey}.enabled`, value: false }, update: { value: false } })
      ]));
    }
  }

  return {
    status,
    planKey,
    billingCycle: normalizeBillingCycle(configured?.billingCycle),
    currency: typeof configured?.currency === "string" ? configured.currency : currency,
    renewalDate: Number.isNaN(renewalDate.getTime()) ? addMonths(now, 1) : renewalDate,
    cancelAtPeriodEnd,
    automaticRenewal: configured?.automaticRenewal !== false
  };
};

const createInvoiceNumber = () => `INV-${new Date().toISOString().replace(/\D/g, "").slice(0, 14)}-${crypto.randomBytes(3).toString("hex").toUpperCase()}`;

const applyDuePlanChanges = async (organizationId?: string) => {
  const now = new Date();
  const changes = await prismaAny.subscriptionPlanChange.findMany({
    where: { ...(organizationId ? { organizationId } : {}), status: "PENDING", effectiveAt: { lte: now } },
    orderBy: { effectiveAt: "asc" }
  });
  for (const change of changes) {
    const plan = await getBillingPlan(change.toPlanKey as BillingPlanKey, change.organizationId);
    await prismaAny.$transaction(async (tx: any) => {
      const config = await tx.systemConfig.findUnique({ where: { organizationId_key: { organizationId: change.organizationId, key: billingConfigKeys.subscription } } });
      const value = (config?.value as Record<string, unknown> | undefined) ?? {};
      await tx.systemConfig.upsert({
        where: { organizationId_key: { organizationId: change.organizationId, key: billingConfigKeys.subscription } },
        create: { organizationId: change.organizationId, key: billingConfigKeys.subscription, value: { planKey: plan.key, status: "ACTIVE", billingCycle: change.billingCycle, currency: change.currency, renewalDate: addMonths(change.effectiveAt, change.billingCycle === "YEARLY" ? 12 : 1).toISOString(), automaticRenewal: change.automaticRenewal, activatedAt: change.effectiveAt.toISOString(), paymentVerifiedAt: change.confirmedAt?.toISOString() } },
        update: { value: { ...value, planKey: plan.key, status: "ACTIVE", billingCycle: change.billingCycle, currency: change.currency, renewalDate: addMonths(change.effectiveAt, change.billingCycle === "YEARLY" ? 12 : 1).toISOString(), cancelAtPeriodEnd: false, automaticRenewal: change.automaticRenewal, activatedAt: change.effectiveAt.toISOString(), paymentVerifiedAt: change.confirmedAt?.toISOString() } }
      });
      for (const moduleKey of plan.includedModules) {
        await tx.systemConfig.upsert({ where: { organizationId_key: { organizationId: change.organizationId, key: `module.${moduleKey}.status` } }, create: { organizationId: change.organizationId, key: `module.${moduleKey}.status`, value: "ACTIVE" }, update: { value: "ACTIVE" } });
        await tx.systemConfig.upsert({ where: { organizationId_key: { organizationId: change.organizationId, key: `module.${moduleKey}.enabled` } }, create: { organizationId: change.organizationId, key: `module.${moduleKey}.enabled`, value: true }, update: { value: true } });
      }
      await tx.subscriptionPlanChange.update({ where: { id: change.id }, data: { status: "APPLIED", appliedAt: now } });
    });
  }
  return { applied: changes.length };
};

export const processMyPlanLifecycle = async () => {
  const appliedPlanChanges = await applyDuePlanChanges();
  const subscriptions = await prisma.systemConfig.findMany({ where: { key: billingConfigKeys.subscription }, select: { organizationId: true } });
  for (const subscription of subscriptions) await getSubscriptionState(subscription.organizationId, "NGN");
  return { processed: subscriptions.length, appliedPlanChanges: appliedPlanChanges.applied };
};

const getPaymentMethodState = async (organizationId: string, fallbackEmail?: string | null) => {
  const defaultCard = await prismaAny.paymentCard.findFirst({
    where: { organizationId, isDefault: true },
    orderBy: { createdAt: "desc" }
  });
  const configured = defaultCard
    ? null
    : await getConfiguredBillingValue<Record<string, unknown>>(organizationId, billingConfigKeys.paymentMethod);
  const currentCard =
    defaultCard
      ? {
          id: defaultCard.id,
          type: "CARD",
          brand: defaultCard.brand,
          last4: defaultCard.last4,
          expMonth: defaultCard.expMonth,
          expYear: defaultCard.expYear,
          cardholderName: defaultCard.cardHolderName,
          isDefault: defaultCard.isDefault,
          label: "Default card"
        }
      : configured && typeof configured.brand === "string" && typeof configured.last4 === "string"
      ? {
          type: "CARD",
          brand: configured.brand,
          last4: configured.last4,
          expMonth: typeof configured.expMonth === "number" ? configured.expMonth : null,
          expYear: typeof configured.expYear === "number" ? configured.expYear : null,
          cardholderName: typeof configured.cardHolderName === "string" ? configured.cardHolderName : typeof configured.cardholderName === "string" ? configured.cardholderName : null,
          isDefault: true,
          label: "Default card"
        }
      : null;

  return {
    selectedMethod: "CARD",
    methods: [
      {
        key: "CARD",
        label: "Card Payment",
        selected: true,
        isDefault: true
      }
    ],
    currentCard,
    hasDefaultCard: Boolean(currentCard),
    addNewCard: {
      label: "Add New Card",
      presentation: "modal",
      action: {
        method: "POST",
        href: "/admin/my-plan/payment-method/cards"
      },
      fields: [
        { name: "cardNumber", label: "Card Number", type: "text", required: true },
        { name: "cardHolderName", label: "Card Holder Name", type: "text", required: true },
        { name: "expiryDate", label: "Expiry Date", type: "text", required: true },
        { name: "cvv", label: "CVV", type: "password", required: true }
      ]
    },
    billingEmail: fallbackEmail ?? null
  };
};

const getBillingAddressState = async (organizationId: string, fallbackEmail?: string | null) => {
  const configured = await getConfiguredBillingValue<Record<string, unknown>>(organizationId, billingConfigKeys.billingAddress);
  const country = typeof configured?.country === "string" ? configured.country : "";

  return {
    values: {
      companyName: typeof configured?.companyName === "string" ? configured.companyName : "",
      billingEmail: typeof configured?.billingEmail === "string" ? configured.billingEmail : fallbackEmail ?? "",
      address: typeof configured?.address === "string" ? configured.address : "",
      country,
      state: typeof configured?.state === "string" ? configured.state : ""
    },
    fields: [
      { name: "companyName", label: "Company Name", type: "text", required: true },
      { name: "billingEmail", label: "Billing Email", type: "email", required: true },
      { name: "address", label: "Address", type: "textarea", required: true },
      { name: "country", label: "Country", type: "searchable-select", required: true },
      { name: "state", label: "State", type: "select", required: true, disabledWhen: "country is empty" }
    ],
    countryDropdown: {
      searchable: true,
      options: getCountryOptions()
    },
    stateDropdown: getStateOptionsForCountry(country || undefined),
    saveAction: {
      label: "Save Address",
      method: "PATCH",
      href: "/admin/my-plan/payment-method/billing-address",
      loadingLabel: "Saving address..."
    },
    feedback: {
      successMessage: "Billing address saved successfully.",
      errorMessage: "Billing address could not be saved. Please review the form and try again."
    }
  };
};

const getModuleStatusMap = async (organizationId: string) => {
  const configRows = await prisma.systemConfig.findMany({
    where: {
      organizationId,
      key: { in: getManagedModuleStatusConfigKeys() }
    },
    select: { key: true, value: true }
  });
  const configMap = new Map(configRows.map((row) => [row.key, row.value]));

  return new Map(
    managedModules.map((module) => {
      const rawStatus = configMap.get(`module.${module.key}.status`);
      const rawEnabled = configMap.get(`module.${module.key}.enabled`);
      const enabled = typeof rawEnabled === "boolean" ? rawEnabled : undefined;
      return [module.key, parseManagedModuleStatus(rawStatus, enabled, module.defaultStatus)] as const;
    })
  );
};

const getAddOnSubscriptionKey = (moduleKey: ManagedModuleKey) =>
  `${billingConfigKeys.addOnSubscriptionPrefix}.${moduleKey}.subscription`;

const getAddOnSubscriptionState = async (organizationId: string, moduleKey: ManagedModuleKey) => {
  const configured = await getConfiguredBillingValue<Record<string, unknown>>(organizationId, getAddOnSubscriptionKey(moduleKey));
  const renewalDate = typeof configured?.renewalDate === "string" ? new Date(configured.renewalDate) : null;

  return {
    status: typeof configured?.status === "string" ? configured.status : "INACTIVE",
    billingCycle: normalizeBillingCycle(configured?.billingCycle),
    renewalDate: renewalDate && !Number.isNaN(renewalDate.getTime()) ? renewalDate : null,
    cancelAtPeriodEnd: configured?.cancelAtPeriodEnd === true,
    subscribedAt: typeof configured?.subscribedAt === "string" ? configured.subscribedAt : null,
    cancelledAt: typeof configured?.cancelledAt === "string" ? configured.cancelledAt : null
  };
};

const buildIncludedModuleFeature = (feature: string) => ({
  name: feature,
  status: "ACTIVE" as const,
  badge: {
    label: "Active",
    tone: "success" as const
  },
  label: "Included in Plan",
  isIncludedInPlan: true,
  isPurchasable: false,
  control: {
    type: "toggle" as const,
    disabled: true,
    checked: true,
    label: "Already available"
  }
});

const resolveActiveBillingModules = async (organizationId: string, plan: BillingPlanDefinition) => {
  const [subscriptionConfig, organization] = await Promise.all([
    prisma.systemConfig.findUnique({ where: { organizationId_key: { organizationId, key: billingConfigKeys.subscription } }, select: { createdAt: true, value: true } }),
    prisma.organization.findUnique({ where: { id: organizationId }, select: { createdAt: true } })
  ]);
  const configuredActivation = (subscriptionConfig?.value as Record<string, unknown> | undefined)?.activatedAt;
  const planActivationDate = typeof configuredActivation === "string" ? configuredActivation : (subscriptionConfig?.createdAt ?? organization?.createdAt)?.toISOString() ?? null;
  const managedPrices = new Map((await getEffectivePlanCatalogue()).map((item) => [item.key, item.monthlyPrice]));
  const resolvedAddOnPrices = await resolveRecurringPrices(managedModules.map((module) => ({
    organizationId, planKey: module.key, source: "ADD_ON" as const,
    fallbackMonthlyPrice: managedPrices.get(module.key) ?? moduleAddOnPrices[module.key]
  })));
  const modules = await Promise.all(
    managedModules.map(async (module) => {
      const includedInPlan = plan.includedModules.includes(module.key);
      const addOnSubscription = includedInPlan ? null : await getAddOnSubscriptionState(organizationId, module.key);
      const addOnIsActive = addOnSubscription?.status === "ACTIVE";
      const isActive = includedInPlan || addOnIsActive;
      const modulePrice = resolvedAddOnPrices.get(`${organizationId}:${module.key}:ADD_ON`) ?? managedPrices.get(module.key) ?? moduleAddOnPrices[module.key];
      const monthlyCost = includedInPlan ? 0 : modulePrice;

      return {
        key: module.key,
        name: module.name,
        status: isActive ? "ACTIVE" : module.defaultStatus,
        includedInPlan,
        monthlyCost,
        monthlyPrice: modulePrice,
        billingFrequency: "MONTHLY" as const,
        activationDate: includedInPlan ? planActivationDate : addOnSubscription?.subscribedAt ?? null,
        canManage: module.defaultStatus !== "COMING_SOON",
        description: module.description
      };
    })
  );

  return modules.filter((module) => module.status === "ACTIVE");
};

const buildCostBreakdown = (
  plan: BillingPlanDefinition,
  billingCycle: BillingCycle,
  activeModules: Array<{ key: ManagedModuleKey; name: string; includedInPlan: boolean; monthlyCost: number }>
) => {
  const addOns = activeModules.filter((module) => !module.includedInPlan);
  const activeModuleTotal = sumMoney(addOns.map((module) => module.monthlyCost));
  const pricing = {
    basePlanCost: plan.monthlyCost,
    activeModuleTotal,
    grandMonthlyTotal: sumMoney([plan.monthlyCost, activeModuleTotal]),
    addOns: addOns.map((module) => ({ key: module.key, name: module.name, monthlyCost: module.monthlyCost }))
  };
  const planCost = calculateBillingAmount(pricing.basePlanCost, billingCycle);
  const addOnsCost = calculateBillingAmount(pricing.activeModuleTotal, billingCycle);

  return {
    plan: {
      label: `${plan.name} plan`,
      amount: planCost
    },
    addOns: pricing.addOns.map((module) => ({ key: module.key, label: module.name, amount: calculateBillingAmount(module.monthlyCost, billingCycle) })),
    discount: 0,
    subtotal: planCost + addOnsCost,
    total: planCost + addOnsCost,
    basePlanCost: pricing.basePlanCost,
    activeModuleTotal: pricing.activeModuleTotal,
    grandMonthlyTotal: pricing.grandMonthlyTotal
  };
};

const normalizeBillingStatus = (status: string) => status.toLowerCase();

export const logAdminActivity = async (input: AdminAuditLogInput) => {
  if (!input.organizationId) return;

  await createAuditLog({
    organizationId: input.organizationId,
    actorUserId: input.actorUserId,
    action: input.action,
    resource: input.resource,
    resourceId: input.resourceId,
    summary: input.summary,
    metadata: input.metadata
  });
};

export const getDashboardData = async (req: Request) => {
  const [currentUser, organization] = await Promise.all([
    prisma.user.findFirst({
      where: { id: req.user?.id, organizationId: req.organizationId },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        profileImageUrl: true,
        lastLoginAt: true
      }
    }),
    prisma.organization.findUnique({
      where: { id: req.organizationId },
      select: { id: true, name: true, profileImageUrl: true }
    })
  ]);

  if (!currentUser || !organization) throw notFound();

  const [totalUsers, activeUsers, pendingInvitations, moduleConfigs] = await prisma.$transaction([
    prisma.user.count({ where: { organizationId: req.organizationId } }),
    prisma.user.count({ where: { organizationId: req.organizationId, isActive: true } }),
    prisma.agentInvitation.count({ where: { organizationId: req.organizationId, status: "PENDING" } }),
    prisma.systemConfig.findMany({
      where: {
        organizationId: req.organizationId,
        key: { in: ["module.admin.enabled", "module.hris.enabled", "module.accounting.enabled", "module.payroll.enabled"] }
      },
      select: { key: true, value: true }
    })
  ]);

  const modules = deriveActiveModules(req.user?.permissions ?? [], moduleConfigs);
  const systemAlerts = await syncSystemAlerts({
    organizationId: req.organizationId!,
    actorUserId: req.user?.id,
    activeUsers,
    totalUsers,
    pendingInvitations,
    activeModules: modules
  });

  const auditLogs = await auditLogDelegate.findMany({
    where: { organizationId: req.organizationId },
    orderBy: { createdAt: "desc" },
    take: 15,
    include: {
      actorUser: {
        select: { firstName: true, lastName: true }
      }
    }
  });

  return {
    search: {
      placeholder: "Search users, modules, alerts and activities"
    },
    welcome: {
      tenantAdminName: `${currentUser.firstName} ${currentUser.lastName}`.trim(),
      profileImageUrl: currentUser.profileImageUrl ?? organization.profileImageUrl,
      lastLoginAt: currentUser.lastLoginAt
    },
    analytics: {
      totalUsers,
      activeUsers,
      activeModules: modules.filter((module) => module.enabled).length,
      pendingInvitations
    },
    quickActions: quickActions.map((action) => ({
      key: action.key,
      title: action.title,
      description: action.description,
      allowed: (req.user?.permissions ?? []).includes(action.permission)
    })),
    activeModules: modules,
    recentActivities: auditLogs.map((log) => ({
      id: log.id,
      action: log.action,
      resource: log.resource,
      summary: log.summary,
      actorName: log.actorUser ? `${log.actorUser.firstName} ${log.actorUser.lastName}`.trim() : null,
      createdAt: log.createdAt
    })),
    systemAlerts: systemAlerts.map((alert) => ({
      id: alert.id,
      key: alert.key,
      title: alert.title,
      message: alert.message,
      severity: alert.severity,
      status: alert.status,
      createdAt: alert.createdAt,
      updatedAt: alert.updatedAt
    }))
  };
};

export const getModuleSectionData = async (req: Request) => {
  const configRows = await prisma.systemConfig.findMany({
    where: {
      organizationId: req.organizationId,
      key: {
        in: getManagedModuleStatusConfigKeys()
      }
    },
    select: { key: true, value: true }
  });

  const configMap = new Map(configRows.map((row) => [row.key, row.value]));

  const activeUsersByModule = await Promise.all(
    managedModules.map(async (module) => ({
      key: module.key,
      count: await countActiveUsersByModule(req.organizationId!, module.key)
    }))
  );

  const activeUsersMap = new Map(activeUsersByModule.map((row) => [row.key, row.count]));

  const modules = managedModules.map((module) => {
    const rawStatus = configMap.get(`module.${module.key}.status`);
    const rawEnabled = configMap.get(`module.${module.key}.enabled`);
    const enabled = typeof rawEnabled === "boolean" ? rawEnabled : undefined;
    const status = parseManagedModuleStatus(rawStatus, enabled, module.defaultStatus);
    const action = buildModuleAction(status);

    return {
      key: module.key,
      name: module.name,
      status,
      description: module.description,
      tabs: module.tabs,
      activeUsers: activeUsersMap.get(module.key) ?? 0,
      action,
      openPath: module.openPath,
      canLaunch: action.canOpen,
      isEnabled: status === "ACTIVE"
    };
  });

  return {
    analytics: {
      totalModules: modules.length,
      activeModules: modules.filter((module) => module.status === "ACTIVE").length,
      comingSoonModules: modules.filter((module) => module.status === "COMING_SOON").length,
      inactiveModules: modules.filter((module) => module.status === "INACTIVE").length
    },
    modules
  };
};

export const updateModuleStatus = async (req: Request) => {
  const moduleKey = String(req.params.moduleKey).toLowerCase() as ManagedModuleKey;
  const payload = req.body as { status: ManagedModuleStatus };

  const moduleDefinition = managedModules.find((module) => module.key === moduleKey);
  if (!moduleDefinition) {
    throw notFound();
  }

  const statusValue = payload.status.toUpperCase() as ManagedModuleStatus;
  const enabledValue = statusValue === "ACTIVE";

  await prisma.$transaction([
    prisma.systemConfig.upsert({
      where: {
        organizationId_key: {
          organizationId: req.organizationId!,
          key: `module.${moduleKey}.status`
        }
      },
      create: {
        organizationId: req.organizationId!,
        key: `module.${moduleKey}.status`,
        value: statusValue
      },
      update: {
        value: statusValue
      }
    }),
    prisma.systemConfig.upsert({
      where: {
        organizationId_key: {
          organizationId: req.organizationId!,
          key: `module.${moduleKey}.enabled`
        }
      },
      create: {
        organizationId: req.organizationId!,
        key: `module.${moduleKey}.enabled`,
        value: enabledValue
      },
      update: {
        value: enabledValue
      }
    })
  ]);

  await logAdminActivity({
    organizationId: req.organizationId,
    actorUserId: req.user?.id,
    action: "MODULE_STATUS_UPDATED",
    resource: "MODULE",
    resourceId: moduleKey,
    summary: `Updated ${moduleDefinition.name} module status to ${statusValue}`,
    metadata: {
      moduleKey,
      moduleName: moduleDefinition.name,
      status: statusValue,
      enabled: enabledValue
    }
  });

  const section = await getModuleSectionData(req);
  const updatedModule = section.modules.find((module) => module.key === moduleKey);

  if (!updatedModule) {
    throw badRequest("Unable to resolve updated module state");
  }

  return {
    message: `${moduleDefinition.name} module status updated`,
    module: updatedModule,
    analytics: section.analytics
  };
};

export const getMyPlanOverview = async (req: Request) => {
  const organization = await prisma.organization.findUnique({
    where: { id: req.organizationId! },
    select: { id: true, name: true, currency: true, email: true }
  });

  if (!organization) throw notFound("Organization not found");

  const subscription = await getSubscriptionState(req.organizationId!, organization.currency);
  const plan = await getBillingPlan(subscription.planKey, req.organizationId!);
  const billingModules = await resolveActiveBillingModules(req.organizationId!, plan);
  const activeModules = subscription.status === "ACTIVE" || subscription.status === "TRIALING" ? billingModules : [];
  const costBreakdown = buildCostBreakdown(plan, subscription.billingCycle, billingModules);
  const paymentMethod = await getPaymentMethodState(req.organizationId!, organization.email);
  const reminderDate = addDays(subscription.renewalDate, -15);
  const numberOfEmployees = await prisma.employee.count({ where: { organizationId: req.organizationId! } });
  const planIndex = billingPlans.findIndex((item) => item.key === plan.key);
  const hasLowerPlan = planIndex > 0;
  const hasHigherPlan = planIndex >= 0 && planIndex < billingPlans.length - 1;
  const changePlanLabel = hasLowerPlan && hasHigherPlan ? "Change plan" : hasHigherPlan ? "Upgrade plan" : "Downgrade plan";

  return {
    section: "overview",
    tenant: {
      id: organization.id,
      name: organization.name
    },
    subscription: {
      status: subscription.status,
      planKey: plan.key,
      planName: plan.name,
      renewalDate: subscription.renewalDate,
      reminderDate,
      reminderLeadDays: 15,
      reminderEnabled: true,
      monthlyCost: plan.monthlyCost,
      billingCycle: subscription.billingCycle,
      currency: subscription.currency,
      cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
      automaticRenewal: subscription.automaticRenewal
    },
    activeModules,
    activeModuleCount: activeModules.length,
    analytics: {
      currentPlan: plan.name,
      subscriptionStatus: subscription.status,
      statusCounts: {
        active: subscription.status === "ACTIVE" ? 1 : 0,
        pending: subscription.status === "PENDING" ? 1 : 0,
        expired: subscription.status === "EXPIRED" ? 1 : 0,
        cancelled: subscription.status === "CANCELLED" ? 1 : 0
      },
      renewalDate: subscription.renewalDate,
      monthlyCost: costBreakdown.grandMonthlyTotal,
      numberOfEmployees,
      numberOfActiveModules: activeModules.length
    },
    costBreakdown,
    paymentMethod,
    quickActions: [
      {
        key: "change-plan",
        label: changePlanLabel,
        method: "PATCH",
        href: "/admin/my-plan/subscription/plan"
      },
      {
        key: "add-module",
        label: "Add module",
        method: "PATCH",
        href: "/admin/my-plan/module-add-ons/{moduleKey}"
      },
      {
        key: "download-invoice",
        label: "Download invoice",
        method: "GET",
        href: "/admin/my-plan/billing-history"
      },
      {
        key: "cancel-subscription",
        label: "Cancel subscription",
        method: "POST",
        href: "/admin/my-plan/subscription/cancel"
      }
    ]
  };
};

export const getMyPlanPlans = async (req: Request) => {
  const organization = await prisma.organization.findUnique({
    where: { id: req.organizationId! },
    select: { currency: true }
  });
  const subscription = await getSubscriptionState(req.organizationId!, organization?.currency ?? "NGN");
  const effectivePrices = new Map((await getEffectivePlanCatalogue()).map((plan) => [plan.key, plan.monthlyPrice]));

  return {
    section: "plans-and-upgrade",
    currentPlanKey: subscription.planKey,
    billingCycle: subscription.billingCycle,
    currency: subscription.currency,
    purpose: "Choose an individual module or the complete All-in-One Suite that best fits your organisation.",
    plans: billingPlans.map((cataloguePlan) => {
      const monthlyCost = effectivePrices.get(cataloguePlan.key) ?? cataloguePlan.monthlyCost;
      const plan = { ...cataloguePlan, monthlyCost, yearlyCost: monthlyCost * 12 };
      return {
      ...plan,
      isCurrent: plan.key === subscription.planKey,
      monthlyEquivalentOnYearly: Math.round(plan.yearlyCost / 12),
      annualSavings: plan.monthlyCost * 12 - plan.yearlyCost,
      annualDiscountPercent: 0,
      canUpgrade: plan.key === "all-in-one" && subscription.planKey !== "all-in-one",
      canDowngrade: false,
      canAdd: plan.key !== "all-in-one" && !plan.includedModules.some((key) => key === subscription.planKey)
    };
    })
  };
};

export const changeMyPlan = async (req: Request) => {
  const payload = myPlanChangeSchema.parse(req.body);
  const organization = await prisma.organization.findUnique({
    where: { id: req.organizationId! },
    select: { currency: true }
  });
  const existing = await getSubscriptionState(req.organizationId!, organization?.currency ?? "NGN");
  const nextPlan = await getBillingPlan(payload.planKey);
  const currentPlan = await getBillingPlan(existing.planKey, req.organizationId!);
  if (existing.status !== "ACTIVE" && existing.status !== "TRIALING") throw badRequest("Only an active subscription can be upgraded", { errorCode: "INVALID_SUBSCRIPTION_STATE" });
  if (nextPlan.key === currentPlan.key) throw badRequest("Organization is already subscribed to this plan", { errorCode: "DUPLICATE_SUBSCRIPTION" });
  if (nextPlan.key !== "all-in-one") {
    throw badRequest("Plan upgrades are only supported to the All-in-One Suite; use Add Plan to purchase another module", { errorCode: "UPGRADE_NOT_ELIGIBLE" });
  }
  const activeModules = await resolveActiveBillingModules(req.organizationId!, currentPlan);
  const currentMonthlyCost = buildCostBreakdown(currentPlan, "MONTHLY", activeModules).grandMonthlyTotal ?? 0;
  const preview = {
    currentPlan: { key: currentPlan.key, name: currentPlan.name }, currentMonthlyCost,
    selectedPlan: { key: nextPlan.key, name: nextPlan.name }, selectedMonthlyCost: nextPlan.monthlyCost,
    totalMonthlyCostAfterChange: nextPlan.monthlyCost, effectiveDate: existing.renewalDate,
    billingImpact: nextPlan.monthlyCost - currentMonthlyCost,
    proratedCharges: 0, currency: existing.currency, requiresConfirmation: true
  };
  if (!payload.confirm) return { message: "Review plan change before confirmation.", preview, confirmationRequired: true };
  const pendingChange = await prismaAny.subscriptionPlanChange.findFirst({ where: { organizationId: req.organizationId!, status: "PENDING" } });
  if (pendingChange) throw badRequest("A plan change is already scheduled", { errorCode: "PLAN_CHANGE_ALREADY_PENDING", planChangeId: pendingChange.id });
  const paymentMethod = await getPaymentMethodState(req.organizationId!, undefined);
  if (!paymentMethod.hasDefaultCard && !payload.paymentReference) {
    throw badRequest("A verified payment method or payment reference is required", { errorCode: "PAYMENT_VERIFICATION_REQUIRED" });
  }
  const confirmedAt = new Date();
  const billingCycle = payload.billingCycle ?? existing.billingCycle;
  const billingAmount = billingCycle === "YEARLY" ? nextPlan.yearlyCost : nextPlan.monthlyCost;
  const [scheduledChange, billingRecord] = await prismaAny.$transaction([
    prismaAny.subscriptionPlanChange.create({ data: {
      organizationId: req.organizationId!, fromPlanKey: currentPlan.key, toPlanKey: nextPlan.key, billingCycle,
      currentMonthlyCost, selectedMonthlyCost: nextPlan.monthlyCost, billingImpact: nextPlan.monthlyCost - currentMonthlyCost,
      proratedCharge: 0, currency: existing.currency, effectiveAt: existing.renewalDate, status: "PENDING",
      paymentReference: payload.paymentReference, automaticRenewal: payload.automaticRenewal,
      confirmedByUserId: req.user?.id, confirmedAt
    } }),
    prismaAny.billingHistory.create({ data: {
      organizationId: req.organizationId!, description: `${nextPlan.name} subscription`, amount: billingAmount,
      currency: existing.currency, status: "paid", billedAt: confirmedAt, providerRef: payload.paymentReference ?? createInvoiceNumber(),
      metadata: { type: "PLAN_UPGRADE", fromPlanKey: currentPlan.key, planKey: nextPlan.key, billingCycle, effectiveAt: existing.renewalDate.toISOString(), basePlanCost: nextPlan.monthlyCost }
    } })
  ]);

  await logAdminActivity({
    organizationId: req.organizationId,
    actorUserId: req.user?.id,
    action: "BILLING_PLAN_CHANGED",
    resource: "BILLING_SUBSCRIPTION",
    resourceId: nextPlan.key,
    summary: `Changed subscription plan to ${nextPlan.name}`,
    metadata: { ...payload, effectiveAt: existing.renewalDate, scheduledChangeId: scheduledChange.id, billingHistoryId: billingRecord.id }
  });

  return { message: "Plan upgrade confirmed and scheduled for the current billing period end.", preview, scheduledChange, billingRecord };
};

export const purchaseMyPlan = async (req: Request) => {
  const payload = myPlanPurchaseSchema.parse(req.body);
  const existing = await prisma.systemConfig.findUnique({ where: { organizationId_key: { organizationId: req.organizationId!, key: billingConfigKeys.subscription } } });
  if (existing) throw badRequest("Organization already has a subscription; add a module or upgrade to All-in-One", { errorCode: "DUPLICATE_SUBSCRIPTION" });
  const organization = await prisma.organization.findUnique({ where: { id: req.organizationId! }, select: { currency: true } });
  if (!organization) throw notFound("Organization not found");
  const plan = await getBillingPlan(payload.planKey);
  const billingCycle = payload.billingCycle ?? "MONTHLY";
  const effectiveDate = new Date();
  const preview = { currentPlan: null, currentMonthlyCost: 0, selectedPlan: { key: plan.key, name: plan.name }, selectedMonthlyCost: plan.monthlyCost, totalMonthlyCostAfterChange: plan.monthlyCost, effectiveDate, billingImpact: plan.monthlyCost, proratedCharges: 0, currency: organization.currency };
  if (!payload.confirm) return { message: "Review subscription purchase before confirmation.", preview, confirmationRequired: true };
  const paymentMethod = await getPaymentMethodState(req.organizationId!, undefined);
  if (!paymentMethod.hasDefaultCard && !payload.paymentReference) throw badRequest("A verified payment method or payment reference is required", { errorCode: "PAYMENT_VERIFICATION_REQUIRED" });
  const renewalDate = addMonths(effectiveDate, billingCycle === "YEARLY" ? 12 : 1);
  const amount = billingCycle === "YEARLY" ? plan.yearlyCost : plan.monthlyCost;
  const purchaseOperations: any[] = [
    prisma.systemConfig.create({ data: { organizationId: req.organizationId!, key: billingConfigKeys.subscription, value: { planKey: plan.key, status: "PENDING", billingCycle, currency: organization.currency, renewalDate: renewalDate.toISOString(), cancelAtPeriodEnd: false, automaticRenewal: payload.automaticRenewal, activatedAt: effectiveDate.toISOString(), paymentVerifiedAt: effectiveDate.toISOString() } } }),
    prisma.billingHistory.create({ data: { organizationId: req.organizationId!, description: `${plan.name} subscription`, amount, currency: organization.currency, status: "paid", billedAt: effectiveDate, providerRef: payload.paymentReference ?? createInvoiceNumber(), metadata: { type: "PLAN_PURCHASE", planKey: plan.key, billingCycle, basePlanCost: plan.monthlyCost } } })
  ];
  for (const moduleKey of plan.includedModules) purchaseOperations.push(
    prisma.systemConfig.upsert({ where: { organizationId_key: { organizationId: req.organizationId!, key: `module.${moduleKey}.status` } }, create: { organizationId: req.organizationId!, key: `module.${moduleKey}.status`, value: "ACTIVE" }, update: { value: "ACTIVE" } }),
    prisma.systemConfig.upsert({ where: { organizationId_key: { organizationId: req.organizationId!, key: `module.${moduleKey}.enabled` } }, create: { organizationId: req.organizationId!, key: `module.${moduleKey}.enabled`, value: true }, update: { value: true } })
  );
  const purchaseResults = await prisma.$transaction(purchaseOperations);
  const billingRecord = purchaseResults[1] as any;
  await getSubscriptionState(req.organizationId!, organization.currency);
  await logAdminActivity({ organizationId: req.organizationId, actorUserId: req.user?.id, action: "BILLING_PLAN_PURCHASED", resource: "BILLING_SUBSCRIPTION", resourceId: plan.key, summary: `Purchased ${plan.name}`, metadata: { billingHistoryId: billingRecord.id } });
  return { message: "Subscription purchased successfully.", preview, billingRecord };
};

export const cancelMyPlanChange = async (req: Request) => {
  const change = await prismaAny.subscriptionPlanChange.findFirst({ where: { id: String(req.params.changeId), organizationId: req.organizationId!, status: "PENDING" } });
  if (!change) throw notFound("Pending plan change not found");
  const cancelled = await prismaAny.subscriptionPlanChange.update({ where: { id: change.id }, data: { status: "CANCELLED", cancelledAt: new Date() } });
  await logAdminActivity({ organizationId: req.organizationId, actorUserId: req.user?.id, action: "BILLING_PLAN_CHANGE_CANCELLED", resource: "BILLING_SUBSCRIPTION", resourceId: change.id, summary: `Cancelled scheduled change to ${change.toPlanKey}` });
  return cancelled;
};

export const getMyPlanModuleAddOns = async (req: Request) => {
  const organization = await prisma.organization.findUnique({
    where: { id: req.organizationId! },
    select: { currency: true }
  });
  const subscription = await getSubscriptionState(req.organizationId!, organization?.currency ?? "NGN");
  const plan = await getBillingPlan(subscription.planKey, req.organizationId!);
  const effectivePrices = new Map((await getEffectivePlanCatalogue()).map((item) => [item.key, item.monthlyPrice]));
  const agreedAddOnPrices = await resolveRecurringPrices(managedModules.map((module) => ({
    organizationId: req.organizationId!, planKey: module.key, source: "ADD_ON" as const,
    fallbackMonthlyPrice: effectivePrices.get(module.key) ?? moduleAddOnPrices[module.key]
  })));
  const includedModules = managedModules.filter((module) => plan.includedModules.includes(module.key));
  const optionalModules = managedModules.filter((module) => !plan.includedModules.includes(module.key));
  const optionalAddOns = await Promise.all(
    optionalModules
      .filter((module) => moduleAddOnDefinitions[module.key])
      .map(async (module) => {
        const addOnDefinition = moduleAddOnDefinitions[module.key]!;
        const addOnSubscription = await getAddOnSubscriptionState(req.organizationId!, module.key);
        const isActive = addOnSubscription.status === "ACTIVE";
        const isLocked = !isActive;

        return {
          key: module.key,
          title: addOnDefinition.title,
          name: module.name,
          description: module.description,
          badge: addOnDefinition.badge,
          status: isActive ? "ACTIVE" : "INACTIVE",
          lockStatus: isLocked ? "LOCKED" : "UNLOCKED",
          isLocked,
          isIncludedInPlan: false,
          isPurchasable: true,
          independentSubscription: true,
          billingImpact: "Purchasing this add-on does not change the user's current plan.",
          monthlyCost: agreedAddOnPrices.get(`${req.organizationId!}:${module.key}:ADD_ON`) ?? effectivePrices.get(module.key) ?? moduleAddOnPrices[module.key],
          currency: subscription.currency,
          billingCycle: addOnDefinition.billingCycle,
          priceLabel: `₦${(agreedAddOnPrices.get(`${req.organizationId!}:${module.key}:ADD_ON`) ?? effectivePrices.get(module.key) ?? moduleAddOnPrices[module.key]).toLocaleString("en-NG")}/month`,
          features: module.tabs,
          icon: addOnDefinition.icon,
          infoMessage: addOnDefinition.infoMessage,
          subscription: addOnSubscription,
          action: {
            label: isActive ? "Cancel add-on" : "Subscribe",
            method: "PATCH",
            href: `/admin/my-plan/module-add-ons/${module.key}`,
            body: { enabled: !isActive }
          }
        };
      })
  );
  const resolvedModules = await resolveActiveBillingModules(req.organizationId!, plan);
  const activeModules = subscription.status === "ACTIVE" || subscription.status === "TRIALING" ? resolvedModules : [];
  const availableModules = optionalAddOns
    .filter((module) => module.status !== "ACTIVE")
    .map((module) => ({
      moduleId: module.key, moduleName: module.name, monthlyPrice: module.monthlyCost,
      currency: subscription.currency, alreadyIncluded: false, eligibilityStatus: "ELIGIBLE",
      canAddImmediately: subscription.status === "ACTIVE"
    }));

  return {
    section: "module-add-ons",
    title: "Module Add-ons",
    currency: subscription.currency,
    activePlan: {
      key: plan.key,
      name: plan.name
    },
    currentActiveModules: activeModules.map((module) => ({
      moduleId: module.key, moduleName: module.name, monthlyPrice: module.monthlyPrice,
      billingFrequency: module.billingFrequency, status: module.status,
      activationDate: module.activationDate, includedInCurrentSubscription: module.includedInPlan
    })),
    availableModules,
    includedInYourPlan: {
      title: "Included in Your Plan",
      description: "Modules included in the selected plan are active, included in plan, and cannot be purchased separately.",
      visualTreatment: "included-card",
      modules: includedModules.map((module) => ({
        key: module.key,
        title: `${module.name} Modules`,
        name: module.name,
        status: "ACTIVE",
        badge: {
          label: "Active",
          tone: "success"
        },
        label: "Included in Plan",
        isIncludedInPlan: true,
        isPurchasable: false,
        canDisable: false,
        monthlyCost: 0,
        control: {
          type: "button",
          disabled: true,
          label: "Already available"
        },
        features: module.tabs.map(buildIncludedModuleFeature)
      })),
      infoMessage: "Upgrade your subscription plan to access additional HR modules."
    },
    optionalAddOns: {
      title: "Optional Add-ons",
      description:
        "These modules are not included in the current plan and require an independent recurring subscription.",
      visualTreatment: "premium-addon-section",
      modules: optionalAddOns
    },
    businessRules: [
      "Modules included in a plan are always active and cannot be disabled or purchased separately.",
      "Add-on modules are independent subscriptions.",
      "Each add-on has its own monthly billing cycle, separate from the active plan.",
      "Purchasing an add-on does not change the user's active plan.",
      "Cancelling an add-on subscription does not affect access to modules included in the active plan."
    ]
  };
};

export const updateMyPlanModuleAddOn = async (req: Request) => {
  const moduleKey = String(req.params.moduleKey).toLowerCase() as ManagedModuleKey;
  const payload = myPlanAddonUpdateSchema.parse(req.body);
  const organization = await prisma.organization.findUnique({
    where: { id: req.organizationId! },
    select: { currency: true }
  });
  const subscription = await getSubscriptionState(req.organizationId!, organization?.currency ?? "NGN");
  const plan = await getBillingPlan(subscription.planKey, req.organizationId!);
  const effectiveModulePrice = (await getEffectivePlanCatalogue()).find((item) => item.key === moduleKey)?.monthlyPrice ?? moduleAddOnPrices[moduleKey];
  const moduleDefinition = managedModules.find((module) => module.key === moduleKey);

  if (!moduleDefinition) throw notFound("Module not found");
  if (plan.includedModules.includes(moduleKey)) {
    throw badRequest("Modules included in the current plan cannot be removed as add-ons");
  }
  const addOnDefinition = moduleAddOnDefinitions[moduleKey];
  if (!addOnDefinition) {
    throw badRequest("This module is not available as an add-on");
  }

  const statusValue: ManagedModuleStatus = payload.enabled ? "ACTIVE" : "INACTIVE";
  const now = new Date();
  const existingAddOn = await getAddOnSubscriptionState(req.organizationId!, moduleKey);
  if (payload.enabled && existingAddOn.status === "ACTIVE") {
    throw badRequest("Module is already active", { errorCode: "DUPLICATE_MODULE_PURCHASE" });
  }
  if (payload.enabled && subscription.status !== "ACTIVE") {
    throw badRequest("Modules can only be added to an active subscription", { errorCode: "INVALID_SUBSCRIPTION_STATE" });
  }
  if (payload.enabled && !payload.confirm) {
    const currentModules = await resolveActiveBillingModules(req.organizationId!, plan);
    const currentMonthlyCost = buildCostBreakdown(plan, "MONTHLY", currentModules).grandMonthlyTotal ?? 0;
    return {
      message: "Review module addition before confirmation.", confirmationRequired: true,
      preview: {
        currentPlan: { key: plan.key, name: plan.name }, currentMonthlyCost,
        selectedPlan: { key: moduleKey, name: moduleDefinition.name }, selectedMonthlyCost: effectiveModulePrice,
        totalMonthlyCostAfterChange: currentMonthlyCost + effectiveModulePrice, effectiveDate: now,
        billingImpact: effectiveModulePrice, proratedCharges: 0, currency: subscription.currency
      }
    };
  }
  if (payload.enabled) {
    const paymentMethod = await getPaymentMethodState(req.organizationId!, undefined);
    if (!paymentMethod.hasDefaultCard && !payload.paymentReference) {
      throw badRequest("A verified payment method or payment reference is required", { errorCode: "PAYMENT_VERIFICATION_REQUIRED" });
    }
  }
  const nextRenewalDate = existingAddOn.renewalDate ?? addMonths(now, 1);
  const addOnSubscription = payload.enabled
    ? {
        moduleKey,
        status: "ACTIVE",
        monthlyCost: effectiveModulePrice,
        currency: subscription.currency,
        billingCycle: addOnDefinition.billingCycle,
        renewalDate: nextRenewalDate.toISOString(),
        cancelAtPeriodEnd: false,
        automaticRenewal: payload.automaticRenewal,
        independentSubscription: true,
        parentPlanKey: plan.key,
        subscribedAt: existingAddOn.subscribedAt ?? now.toISOString(),
        updatedAt: now.toISOString()
      }
    : {
        moduleKey,
        status: "CANCELLED",
        monthlyCost: effectiveModulePrice,
        currency: subscription.currency,
        billingCycle: addOnDefinition.billingCycle,
        renewalDate: existingAddOn.renewalDate?.toISOString() ?? null,
        cancelAtPeriodEnd: false,
        independentSubscription: true,
        parentPlanKey: plan.key,
        subscribedAt: existingAddOn.subscribedAt,
        cancelledAt: now.toISOString(),
        updatedAt: now.toISOString()
      };

  const transactionOperations: any[] = [
    prisma.systemConfig.upsert({
      where: { organizationId_key: { organizationId: req.organizationId!, key: `module.${moduleKey}.status` } },
      create: { organizationId: req.organizationId!, key: `module.${moduleKey}.status`, value: statusValue },
      update: { value: statusValue }
    }),
    prisma.systemConfig.upsert({
      where: { organizationId_key: { organizationId: req.organizationId!, key: `module.${moduleKey}.enabled` } },
      create: { organizationId: req.organizationId!, key: `module.${moduleKey}.enabled`, value: payload.enabled },
      update: { value: payload.enabled }
    }),
    prisma.systemConfig.upsert({
      where: { organizationId_key: { organizationId: req.organizationId!, key: getAddOnSubscriptionKey(moduleKey) } },
      create: {
        organizationId: req.organizationId!,
        key: getAddOnSubscriptionKey(moduleKey),
        value: addOnSubscription
      },
      update: { value: addOnSubscription }
    })
  ];
  if (payload.enabled) transactionOperations.push(prisma.billingHistory.create({ data: {
    organizationId: req.organizationId!, description: `${moduleDefinition.name} module subscription`,
    amount: effectiveModulePrice, currency: subscription.currency, status: "paid", billedAt: now,
    providerRef: payload.paymentReference ?? createInvoiceNumber(),
    metadata: { type: "MODULE_PURCHASE", moduleKey, parentPlanKey: plan.key, billingCycle: "MONTHLY", monthlyCost: effectiveModulePrice }
  } }));
  await prisma.$transaction(transactionOperations);

  await logAdminActivity({
    organizationId: req.organizationId,
    actorUserId: req.user?.id,
    action: payload.enabled ? "BILLING_ADDON_ENABLED" : "BILLING_ADDON_DISABLED",
    resource: "BILLING_ADD_ON",
    resourceId: moduleKey,
    summary: `${payload.enabled ? "Enabled" : "Disabled"} ${moduleDefinition.name} add-on`,
    metadata: { moduleKey, enabled: payload.enabled, monthlyCost: effectiveModulePrice, billingCycle: addOnDefinition.billingCycle }
  });

  return getMyPlanModuleAddOns(req);
};

export const getMyPlanPaymentMethod = async (req: Request) => {
  const organization = await prisma.organization.findUnique({
    where: { id: req.organizationId! },
    select: { email: true, name: true }
  });

  return {
    section: "payment-method",
    title: "Payment",
    paymentMethod: await getPaymentMethodState(req.organizationId!, organization?.email),
    billingAddress: await getBillingAddressState(req.organizationId!, organization?.email),
    ui: {
      defaultSelectedPaymentMethod: "CARD",
      defaultSelectedPaymentMethodLabel: "Card Payment",
      distinguishCurrentCardFromNewCard: true
    }
  };
};

export const updateMyPlanPaymentMethod = async (req: Request) => {
  const payload = myPlanPaymentMethodSchema.parse(req.body);
  const organization = await prisma.organization.findUnique({
    where: { id: req.organizationId! },
    select: { email: true }
  });
  const ownedCard = await prisma.paymentCard.findFirst({ where: { id: payload.paymentCardId, organizationId: req.organizationId! } });
  if (!ownedCard) throw notFound("Payment card not found");
  await prisma.$transaction([
    prisma.paymentCard.updateMany({ where: { organizationId: req.organizationId!, isDefault: true }, data: { isDefault: false } }),
    prisma.paymentCard.update({ where: { id: ownedCard.id }, data: { isDefault: true } })
  ]);

  await logAdminActivity({
    organizationId: req.organizationId,
    actorUserId: req.user?.id,
    action: "BILLING_PAYMENT_METHOD_UPDATED",
    resource: "BILLING_PAYMENT_METHOD",
    resourceId: ownedCard.id,
    summary: `Changed default payment method to card ending in ${ownedCard.last4}`,
    metadata: { paymentCardId: ownedCard.id, brand: ownedCard.brand, last4: ownedCard.last4 }
  });

  return {
    section: "payment-method",
    title: "Payment",
    paymentMethod: await getPaymentMethodState(req.organizationId!, organization?.email),
    billingAddress: await getBillingAddressState(req.organizationId!, organization?.email),
    ui: {
      defaultSelectedPaymentMethod: "CARD",
      defaultSelectedPaymentMethodLabel: "Card Payment",
      distinguishCurrentCardFromNewCard: true
    }
  };
};

export const listMyPlanPaymentCards = async (req: Request) => {
  const cards = await prisma.paymentCard.findMany({ where: { organizationId: req.organizationId! }, orderBy: [{ isDefault: "desc" }, { createdAt: "desc" }] });
  return cards.map(({ providerCardToken: _token, ...card }) => card);
};

export const updateMyPlanPaymentCard = async (req: Request) => {
  const payload = myPlanCardUpdateSchema.parse(req.body);
  const card = await prisma.paymentCard.findFirst({ where: { id: String(req.params.cardId), organizationId: req.organizationId! } });
  if (!card) throw notFound("Payment card not found");
  const updated = await prismaAny.$transaction(async (tx: any) => {
    if (payload.makeDefault) await tx.paymentCard.updateMany({ where: { organizationId: req.organizationId!, isDefault: true }, data: { isDefault: false } });
    return tx.paymentCard.update({ where: { id: card.id }, data: { cardHolderName: payload.cardHolderName, expMonth: payload.expMonth, expYear: payload.expYear, ...(payload.makeDefault === true ? { isDefault: true } : {}) } });
  });
  const { providerCardToken: _token, ...safeCard } = updated;
  return safeCard;
};

export const deleteMyPlanPaymentCard = async (req: Request) => {
  const card = await prisma.paymentCard.findFirst({ where: { id: String(req.params.cardId), organizationId: req.organizationId! } });
  if (!card) throw notFound("Payment card not found");
  const count = await prisma.paymentCard.count({ where: { organizationId: req.organizationId! } });
  if (count === 1) throw badRequest("The only payment card cannot be removed", { errorCode: "DEFAULT_PAYMENT_METHOD_REQUIRED" });
  await prismaAny.$transaction(async (tx: any) => {
    await tx.paymentCard.delete({ where: { id: card.id } });
    if (card.isDefault) {
      const replacement = await tx.paymentCard.findFirst({ where: { organizationId: req.organizationId! }, orderBy: { createdAt: "desc" } });
      if (replacement) await tx.paymentCard.update({ where: { id: replacement.id }, data: { isDefault: true } });
    }
  });
};

export const addMyPlanPaymentCard = async (req: Request) => {
  const payload = myPlanAddCardSchema.parse(req.body);
  const organization = await prisma.organization.findUnique({
    where: { id: req.organizationId! },
    select: { email: true }
  });
  const cardNumber = payload.cardNumber.replace(/\s/g, "");
  const { expMonth, expYear } = parseExpiryDate(payload.expiryDate);
  const brand = detectCardBrand(cardNumber);
  const last4 = cardNumber.slice(-4);
  const providerCard = await createProviderCardToken({
    organizationId: req.organizationId!,
    brand,
    last4,
    expMonth,
    expYear
  });

  const card = await prismaAny.$transaction(async (tx: any) => {
    if (payload.makeDefault) {
      await tx.paymentCard.updateMany({
        where: { organizationId: req.organizationId!, isDefault: true },
        data: { isDefault: false }
      });
    }

    const existingCardCount = await tx.paymentCard.count({ where: { organizationId: req.organizationId! } });

    return tx.paymentCard.create({
      data: {
        organizationId: req.organizationId!,
        cardHolderName: payload.cardHolderName,
        brand,
        last4,
        expMonth,
        expYear,
        provider: providerCard.provider,
        providerCardToken: providerCard.token,
        createdByUserId: req.user?.id,
        isDefault: payload.makeDefault || existingCardCount === 0
      }
    });
  });

  await upsertBillingConfig(req.organizationId!, billingConfigKeys.paymentMethod, {
    brand: card.brand,
    last4: card.last4,
    expMonth: card.expMonth,
    expYear: card.expYear,
    cardHolderName: card.cardHolderName,
    provider: card.provider,
    providerCardToken: card.providerCardToken,
    paymentCardId: card.id,
    updatedAt: new Date().toISOString()
  });

  await logAdminActivity({
    organizationId: req.organizationId,
    actorUserId: req.user?.id,
    action: "BILLING_PAYMENT_CARD_ADDED",
    resource: "PAYMENT_CARD",
    resourceId: card.id,
    summary: `Added ${card.brand} card ending in ${card.last4}`,
    metadata: {
      brand: card.brand,
      last4: card.last4,
      expMonth: card.expMonth,
      expYear: card.expYear,
      isDefault: card.isDefault,
      provider: card.provider
    }
  });

  return {
    message: "Payment card saved successfully.",
    card: {
      id: card.id,
      cardHolderName: card.cardHolderName,
      brand: card.brand,
      last4: card.last4,
      expMonth: card.expMonth,
      expYear: card.expYear,
      isDefault: card.isDefault,
      provider: card.provider
    },
    paymentMethod: await getPaymentMethodState(req.organizationId!, organization?.email)
  };
};

export const cancelMyPlanPaymentCardCreation = async (req: Request) => {
  const payload = myPlanCancelCardCreationSchema.parse(req.body ?? {});
  const organization = await prisma.organization.findUnique({
    where: { id: req.organizationId! },
    select: { email: true }
  });

  await logAdminActivity({
    organizationId: req.organizationId,
    actorUserId: req.user?.id,
    action: "BILLING_PAYMENT_CARD_CREATION_CANCELLED",
    resource: "PAYMENT_CARD",
    summary: "Cancelled payment card creation flow",
    metadata: payload
  });

  return {
    message: "Card creation cancelled.",
    paymentMethod: await getPaymentMethodState(req.organizationId!, organization?.email)
  };
};

export const getMyPlanPaymentLocationOptions = async (req: Request) => {
  const query = myPlanLocationOptionsQuerySchema.parse(req.query);

  return {
    countries: {
      searchable: true,
      options: getCountryOptions()
    },
    states: getStateOptionsForCountry(query.country)
  };
};

export const updateMyPlanBillingAddress = async (req: Request) => {
  const payload = myPlanBillingAddressSchema.parse(req.body);
  const normalizedCountry = payload.country.toUpperCase();
  const stateOptions = getStateOptionsForCountry(normalizedCountry);

  if (!stateOptions.allowManualInput && !stateOptions.options.some((option) => option.value === payload.state)) {
    throw badRequest("Selected state is not valid for the selected country");
  }

  const billingAddress = {
    ...payload,
    country: normalizedCountry,
    updatedAt: new Date().toISOString()
  };

  await upsertBillingConfig(req.organizationId!, billingConfigKeys.billingAddress, billingAddress);

  await logAdminActivity({
    organizationId: req.organizationId,
    actorUserId: req.user?.id,
    action: "BILLING_ADDRESS_UPDATED",
    resource: "BILLING_ADDRESS",
    summary: "Updated billing address",
    metadata: {
      companyName: billingAddress.companyName,
      billingEmail: billingAddress.billingEmail,
      country: billingAddress.country,
      state: billingAddress.state
    }
  });

  return {
    message: "Billing address saved successfully.",
    billingAddress: await getBillingAddressState(req.organizationId!, billingAddress.billingEmail)
  };
};

export const getMyPlanBillingHistory = async (req: Request) => {
  const query = myPlanBillingHistoryQuerySchema.parse(req.query);
  const selectedYear = query.year ?? new Date().getFullYear();
  const range = getYearRange(selectedYear);
  const whereClause = {
    organizationId: req.organizationId!,
    billedAt: { gte: range.start, lt: range.end },
    ...(query.status ? { status: query.status } : {})
  };

  const [total, rows] = await prismaAny.$transaction([
    prismaAny.billingHistory.count({ where: whereClause }),
    prismaAny.billingHistory.findMany({
      where: whereClause,
      orderBy: { billedAt: "desc" },
      skip: (query.page - 1) * query.limit,
      take: query.limit
    })
  ]);

  return {
    section: "billing-history",
    year: selectedYear,
    page: query.page,
    limit: query.limit,
    total,
    data: rows.map((row: any) => ({
      id: row.id,
      date: row.billedAt,
      description: row.description,
      amount: Number(row.amount),
      amountPaid: Number(row.amount),
      currency: row.currency,
      paymentStatus: normalizeBillingStatus(row.status),
      providerRef: row.providerRef,
      invoiceNumber: row.providerRef ?? `INV-${String(row.id).toUpperCase()}`,
      invoiceId: row.id,
      downloadUrl: `/admin/my-plan/invoices/${row.id}/download`,
      pricingComponents: row.metadata ?? null
    }))
  };
};

export const getMyPlanBillingAnalytics = async (req: Request) => {
  const query = myPlanBillingAnalyticsQuerySchema.parse(req.query);
  const selectedYear = query.year ?? new Date().getFullYear();
  const yearRange = getYearRange(selectedYear);
  const monthRange = getMonthRange(new Date());
  const organization = await prisma.organization.findUnique({
    where: { id: req.organizationId! },
    select: { currency: true }
  });
  const subscription = await getSubscriptionState(req.organizationId!, organization?.currency ?? "NGN");
  const plan = await getBillingPlan(subscription.planKey, req.organizationId!);
  const activeModules = await resolveActiveBillingModules(req.organizationId!, plan);
  const costBreakdown = buildCostBreakdown(plan, "MONTHLY", activeModules);

  const [yearlyPaid, monthlyPaid] = await prismaAny.$transaction([
    prismaAny.billingHistory.aggregate({
      where: {
        organizationId: req.organizationId!,
        status: "paid",
        billedAt: { gte: yearRange.start, lt: yearRange.end }
      },
      _sum: { amount: true }
    }),
    prismaAny.billingHistory.aggregate({
      where: {
        organizationId: req.organizationId!,
        status: "paid",
        billedAt: { gte: monthRange.start, lt: monthRange.end }
      },
      _sum: { amount: true }
    })
  ]);

  const activeMonthlySubscription = subscription.status === "ACTIVE" || subscription.status === "TRIALING" ? costBreakdown.grandMonthlyTotal : 0;

  return {
    section: "billing-analytics",
    year: selectedYear,
    currency: subscription.currency,
    totalPaidYearly: Number(yearlyPaid._sum.amount ?? 0),
    monthlyPaid: Number(monthlyPaid._sum.amount ?? 0),
    annualEstimate: activeMonthlySubscription === null ? null : activeMonthlySubscription * 12,
    activeMonthlySubscription,
    rules: {
      totalPaidYearly: "Successful payments within the selected year.",
      monthlyPaid: "Successful payments within the current month.",
      annualEstimate: "Current active monthly subscription and active add-ons multiplied by 12."
    }
  };
};

const escapePdfText = (value: string) => value.replace(/([\\()])/g, "\\$1");

export const downloadMyPlanInvoice = async (req: Request) => {
  const invoice = await prisma.billingHistory.findFirst({
    where: { id: String(req.params.invoiceId), organizationId: req.organizationId! }
  });
  if (!invoice) throw notFound("Invoice not found");
  const invoiceNumber = invoice.providerRef ?? `INV-${invoice.id.toUpperCase()}`;
  const lines = ["Sinkronis Invoice", `Invoice: ${invoiceNumber}`, `Date: ${invoice.billedAt.toISOString().slice(0, 10)}`,
    `Description: ${invoice.description}`, `Amount: ${invoice.currency} ${Number(invoice.amount).toFixed(2)}`, `Status: ${invoice.status}`];
  const stream = `BT /F1 12 Tf 50 760 Td ${lines.map((line, index) => `${index ? "0 -24 Td " : ""}(${escapePdfText(line)}) Tj`).join(" ")} ET`;
  const objects = ["1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj", "2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj",
    "3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >> endobj",
    "4 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj", `5 0 obj << /Length ${Buffer.byteLength(stream)} >> stream\n${stream}\nendstream endobj`];
  let pdf = "%PDF-1.4\n"; const offsets = [0];
  for (const object of objects) { offsets.push(Buffer.byteLength(pdf)); pdf += `${object}\n`; }
  const xref = Buffer.byteLength(pdf); pdf += `xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map((offset) => `${String(offset).padStart(10, "0")} 00000 n `).join("\n")}\ntrailer << /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return { buffer: Buffer.from(pdf), filename: `${invoiceNumber}.pdf` };
};

export const processMyPlanRenewalNotifications = async (asOf = new Date(), channels: Array<"EMAIL" | "IN_APP" | "PUSH"> = ["EMAIL", "IN_APP"], organizationId?: string) => {
  const rows = await prisma.systemConfig.findMany({ where: { key: billingConfigKeys.subscription, ...(organizationId ? { organizationId } : {}) } });
  let created = 0; let sent = 0; let failed = 0;
  for (const row of rows) {
    const value = row.value as Record<string, unknown>;
    if (value.cancelAtPeriodEnd === true || value.status === "CANCELLED" || typeof value.renewalDate !== "string") continue;
    const renewalDate = new Date(value.renewalDate);
    const notificationDate = addDays(renewalDate, -15);
    if (!isRenewalReminderDue(renewalDate, asOf)) continue;
    let notification = await prismaAny.billingNotification.findUnique({ where: { organizationId_type_renewalDate: { organizationId: row.organizationId, type: "SUBSCRIPTION_RENEWAL_REMINDER", renewalDate } } });
    if (notification?.status === "SENT" || Number(notification?.attempts ?? 0) >= 3) continue;
    if (!notification) {
      notification = await prismaAny.billingNotification.create({ data: { organizationId: row.organizationId, type: "SUBSCRIPTION_RENEWAL_REMINDER", renewalDate, scheduledFor: notificationDate, channels: channels.map((channel) => ({ channel, status: "PENDING", attempts: 0 })) } });
      created++;
    }
    const organization = await prisma.organization.findUnique({ where: { id: row.organizationId }, select: { name: true, email: true, currency: true } });
    const planKey = value.planKey as BillingPlanKey;
    const plan = billingPlans.find((candidate) => candidate.key === planKey);
    const channelStates = (notification.channels as Array<Record<string, unknown>>).map((state) => ({ ...state }));
    let deliveryFailed = false;
    for (const state of channelStates) {
      if (state.status === "SENT") continue;
      const channel = String(state.channel);
      try {
        if (channel === "EMAIL") {
          if (!organization?.email) throw new Error("Organization billing email is not configured");
          await sendSubscriptionRenewalEmail({ to: organization.email, organizationName: organization.name, renewalDate, amount: plan?.monthlyCost ?? 0, currency: organization.currency });
        } else if (channel === "IN_APP") {
          await prisma.systemAlert.upsert({ where: { organizationId_key: { organizationId: row.organizationId, key: `SUBSCRIPTION_RENEWAL_${renewalDate.toISOString().slice(0, 10)}` } },
            create: { organizationId: row.organizationId, key: `SUBSCRIPTION_RENEWAL_${renewalDate.toISOString().slice(0, 10)}`, title: "Subscription renewal in 15 days", message: `Your ${plan?.name ?? "subscription"} renews on ${renewalDate.toISOString().slice(0, 10)}.`, severity: "INFO", status: "OPEN", isActive: true },
            update: { title: "Subscription renewal in 15 days", message: `Your ${plan?.name ?? "subscription"} renews on ${renewalDate.toISOString().slice(0, 10)}.`, status: "OPEN", isActive: true } });
        } else if (channel === "PUSH") throw new Error("Push delivery provider is not configured");
        state.status = "SENT"; state.sentAt = new Date().toISOString();
      } catch (error) {
        deliveryFailed = true; state.status = "FAILED"; state.error = error instanceof Error ? error.message : "Delivery failed";
      }
      state.attempts = Number(state.attempts ?? 0) + 1;
    }
    const allSent = channelStates.every((state) => state.status === "SENT");
    await prismaAny.billingNotification.update({ where: { id: notification.id }, data: { channels: channelStates, status: allSent ? "SENT" : "FAILED", attempts: { increment: 1 }, lastAttemptAt: new Date(), sentAt: allSent ? new Date() : null, failedAt: deliveryFailed ? new Date() : null, errorMessage: deliveryFailed ? "One or more channels failed" : null } });
    if (allSent) sent++; else failed++;
  }
  return { processedAt: asOf, leadDays: 15, created, sent, failed, duplicateNotificationsPrevented: true };
};

export const triggerMyPlanRenewalNotifications = async (req: Request) => {
  const payload = myPlanRenewalNotificationSchema.parse(req.body ?? {});
  return processMyPlanRenewalNotifications(payload.asOf ? new Date(payload.asOf) : new Date(), payload.channels, req.organizationId!);
};

export const cancelMyPlanSubscription = async (req: Request) => {
  const payload = myPlanCancelSubscriptionSchema.parse(req.body ?? {});
  if (payload.keepPlan) {
    const organization = await prisma.organization.findUnique({
      where: { id: req.organizationId! },
      select: { currency: true }
    });
    const existing = await getSubscriptionState(req.organizationId!, organization?.currency ?? "NGN");

    await upsertBillingConfig(req.organizationId!, billingConfigKeys.subscription, {
      status: "ACTIVE",
      planKey: existing.planKey,
      billingCycle: existing.billingCycle,
      currency: existing.currency,
      renewalDate: existing.renewalDate.toISOString(),
      cancelAtPeriodEnd: false,
      automaticRenewal: true,
      cancellationStatus: null,
      cancellationRequestedAt: null,
      cancellationEffectiveDate: null,
      dataRetentionExpiresAt: null
    });

    await logAdminActivity({
      organizationId: req.organizationId,
      actorUserId: req.user?.id,
      action: "BILLING_SUBSCRIPTION_CANCEL_ABORTED",
      resource: "BILLING_SUBSCRIPTION",
      summary: "Kept subscription plan active",
      metadata: {
        planKey: existing.planKey,
        renewalDate: existing.renewalDate.toISOString()
      }
    });

    return {
      message: "Subscription remains active.",
      subscription: (await getMyPlanOverview(req)).subscription
    };
  }

  const confirmed = payload.confirmCancel === true || payload.confirmationText?.toLowerCase() === "cancel";
  if (!confirmed) {
    throw badRequest("Cancellation confirmation is required", {
      warning: cancellationWarning,
      acceptedConfirmation: {
        confirmationText: "cancel",
        confirmCancel: true
      }
    });
  }

  const organization = await prisma.organization.findUnique({
    where: { id: req.organizationId! },
    select: { currency: true }
  });
  const existing = await getSubscriptionState(req.organizationId!, organization?.currency ?? "NGN");
  if (existing.cancelAtPeriodEnd) {
    throw badRequest("Subscription cancellation is already scheduled", { errorCode: "INVALID_STATE_TRANSITION" });
  }
  const cancellationEffectiveDate = existing.renewalDate;
  const dataRetentionExpiresAt = addDays(cancellationEffectiveDate, 30);
  const cancelled = {
    ...existing,
    cancelAtPeriodEnd: true,
    automaticRenewal: false,
    status: "ACTIVE" as BillingSubscriptionStatus,
    cancellationStatus: "SCHEDULED",
    cancellationRequestedAt: new Date().toISOString(),
    cancellationEffectiveDate: cancellationEffectiveDate.toISOString(),
    dataRetentionExpiresAt: dataRetentionExpiresAt.toISOString()
  };

  await upsertBillingConfig(req.organizationId!, billingConfigKeys.subscription, {
    ...cancelled,
    renewalDate: cancelled.renewalDate.toISOString()
  });

  await logAdminActivity({
    organizationId: req.organizationId,
    actorUserId: req.user?.id,
    action: "BILLING_SUBSCRIPTION_CANCEL_REQUESTED",
    resource: "BILLING_SUBSCRIPTION",
    summary: "Requested subscription cancellation at period end",
    metadata: {
      cancellationEffectiveDate: cancelled.cancellationEffectiveDate,
      dataRetentionExpiresAt: cancelled.dataRetentionExpiresAt
    }
  });

  return {
    message: "Subscription cancellation scheduled.",
    warning: cancellationWarning,
    cancellationEffectiveDate,
    dataRetentionExpiresAt,
    subscription: (await getMyPlanOverview(req)).subscription
  };
};

const getAuditDateRange = (dateFilter?: "day" | "month" | "year", dateValue?: string) => {
  if (!dateFilter && !dateValue) return null;
  if (!dateFilter || !dateValue) throw badRequest("Both dateFilter and date are required for audit date filtering");

  if (dateFilter === "day") {
    const start = new Date(`${dateValue}T00:00:00.000Z`);
    if (Number.isNaN(start.getTime())) throw badRequest("Date must be YYYY-MM-DD when dateFilter is day");
    return { gte: start, lt: addDays(start, 1) };
  }

  if (dateFilter === "month") {
    const match = /^(\d{4})-(\d{2})$/.exec(dateValue);
    if (!match) throw badRequest("Date must be YYYY-MM when dateFilter is month");
    const year = Number(match[1]);
    const month = Number(match[2]);
    if (month < 1 || month > 12) throw badRequest("Month must be between 01 and 12");
    return {
      gte: new Date(Date.UTC(year, month - 1, 1)),
      lt: new Date(Date.UTC(year, month, 1))
    };
  }

  const year = Number(dateValue);
  if (!Number.isInteger(year) || year < 2000 || year > 2100) {
    throw badRequest("Date must be YYYY when dateFilter is year");
  }

  return {
    gte: new Date(Date.UTC(year, 0, 1)),
    lt: new Date(Date.UTC(year + 1, 0, 1))
  };
};

const extractAuditIpAddress = (metadata: unknown) => {
  if (!metadata || typeof metadata !== "object") return null;
  const record = metadata as Record<string, unknown>;
  const value = record.ipAddress ?? record.ip;
  return typeof value === "string" ? value : null;
};

export const getAuditLogs = async (req: Request) => {
  const query = auditLogQuerySchema.parse(req.query);
  const { skip, take } = getPagination(query);
  const dateRange = getAuditDateRange(query.dateFilter, query.date);
  const whereClause: any = { organizationId: req.organizationId };

  if (query.userId && query.userId !== "ALL") whereClause.actorUserId = query.userId;
  if (query.action && query.action !== "ALL") whereClause.action = query.action;
  if (query.module && query.module !== "ALL") whereClause.resource = query.module;
  if (dateRange) whereClause.createdAt = dateRange;
  if (query.search) {
    whereClause.OR = [
      { summary: { contains: query.search } },
      { actorUser: { firstName: { contains: query.search } } },
      { actorUser: { lastName: { contains: query.search } } },
      { actorUser: { email: { contains: query.search } } }
    ];
  }

  const [totalRecords, logs, users, actions, modules] = await Promise.all([
    prismaAny.auditLog.count({ where: whereClause }),
    prismaAny.auditLog.findMany({
      where: whereClause,
      orderBy: { createdAt: "desc" },
      skip,
      take,
      include: {
        actorUser: {
          select: { id: true, firstName: true, lastName: true, email: true }
        }
      }
    }),
    prisma.user.findMany({
      where: { organizationId: req.organizationId!, isActive: true },
      orderBy: [{ firstName: "asc" }, { lastName: "asc" }],
      select: { id: true, firstName: true, lastName: true, email: true }
    }),
    prismaAny.auditLog.findMany({
      where: { organizationId: req.organizationId },
      distinct: ["action"],
      orderBy: { action: "asc" },
      select: { action: true }
    }),
    prismaAny.auditLog.findMany({
      where: { organizationId: req.organizationId },
      distinct: ["resource"],
      orderBy: { resource: "asc" },
      select: { resource: true }
    })
  ]);

  const totalPages = Math.max(1, Math.ceil(totalRecords / query.limit));
  const records = logs.map((log: AuditLogRow) => {
    const actorName = log.actorUser ? `${log.actorUser.firstName} ${log.actorUser.lastName}`.trim() : "System";
    return {
      id: log.id,
      sequence: log.sequence ?? null,
      timestamp: log.createdAt,
      user: log.actorUser
        ? { id: log.actorUser.id, name: actorName || log.actorUser.email, email: log.actorUser.email }
        : { id: null, name: "System", email: null },
      action: log.action,
      module: log.resource,
      details: log.summary,
      ipAddress: extractAuditIpAddress(log.metadata),
      resourceId: log.resourceId,
      tamperEvidence: {
        hash: log.hash ?? null,
        previousHash: log.previousHash ?? null,
        algorithm: "sha256"
      }
    };
  });

  return {
    section: "audit-log",
    records,
    data: records,
    filters: {
      search: query.search ?? "",
      selectedUserId: query.userId ?? "ALL",
      selectedAction: query.action ?? "ALL",
      selectedModule: query.module ?? "ALL",
      dateFilter: query.dateFilter ?? null,
      date: query.date ?? null,
      users: [
        { value: "ALL", label: "All Users" },
        ...users.map((user) => ({
          value: user.id,
          label: `${user.firstName} ${user.lastName}`.trim() || user.email,
          email: user.email
        }))
      ],
      actions: [
        { value: "ALL", label: "All Actions" },
        ...actions.map((item: { action: string }) => ({ value: item.action, label: item.action }))
      ],
      modules: [
        { value: "ALL", label: "All Modules" },
        ...modules.map((item: { resource: string }) => ({ value: item.resource, label: item.resource }))
      ],
      dateFilters: [
        { value: "day", label: "Day" },
        { value: "month", label: "Month" },
        { value: "year", label: "Year" }
      ]
    },
    resetAction: {
      method: "GET",
      href: "/admin/audit-log",
      clears: ["search", "userId", "action", "module", "dateFilter", "date"]
    },
    pagination: {
      currentPage: query.page,
      pageSize: query.limit,
      totalRecords,
      totalPages,
      hasNextPage: query.page < totalPages,
      hasPreviousPage: query.page > 1
    },
    sorting: {
      default: "timestamp",
      direction: "desc"
    },
    readOnly: true
  };
};

export const getSystemAlerts = async (organizationId: string) => {
  return systemAlertDelegate.findMany({
    where: { organizationId },
    orderBy: [{ isActive: "desc" }, { updatedAt: "desc" }]
  });
};

export const acknowledgeSystemAlert = async (organizationId: string, actorUserId: string | undefined, id: string) => {
  const existing = await systemAlertDelegate.findFirst({
    where: { id, organizationId }
  });

  if (!existing) throw notFound();

  const alert = await systemAlertDelegate.update({
    where: { id },
    data: {
      status: "ACKNOWLEDGED",
      acknowledgedAt: new Date(),
      acknowledgedByUserId: actorUserId
    }
  });

  await logAdminActivity({
    organizationId,
    actorUserId,
    action: "ALERT_ACKNOWLEDGED",
    resource: "SYSTEM_ALERT",
    resourceId: alert.id,
    summary: `Acknowledged system alert: ${alert.title}`
  });

  return alert;
};

export const getOrganization = async (organizationId: string) => {
  return prisma.organization.findUnique({
    where: { id: organizationId },
    select: {
      id: true,
      name: true,
      profileImageUrl: true,
      email: true,
      phone: true,
      industry: true,
      address: true,
      registrationAddress: true,
      country: true,
      currency: true,
      taxId: true,
      cacNumber: true,
      website: true,
      fiscalYearStart: true,
      companySize: true,
      status: true,
      createdAt: true,
      updatedAt: true
    }
  });
};

export const updateOrganization = async (req: Request) => {
  const organization = await prisma.organization.update({
    where: { id: req.organizationId },
    data: req.body
  });

  await logAdminActivity({
    organizationId: req.organizationId,
    actorUserId: req.user?.id,
    action: "ORGANIZATION_UPDATED",
    resource: "ORGANIZATION",
    resourceId: organization.id,
    summary: "Updated organization profile settings",
    metadata: req.body
  });

  return organization;
};

export const getUserManagementAnalytics = async (req: Request) => {
  const moduleFilter = (req.query.module as AppModule | undefined) ?? undefined;

  const userFilter = moduleFilter
    ? {
        role: {
          permissions: {
            some: {
              permission: {
                key: {
                  startsWith: moduleFilter.toLowerCase() + ":"
                }
              }
            }
          }
        }
      }
    : {};

  const [totalUsers, activeUsers, pendingInvitations] = await Promise.all([
    prisma.user.count({ where: { organizationId: req.organizationId, ...userFilter } }),
    prisma.user.count({ where: { organizationId: req.organizationId, isActive: true, ...userFilter } }),
    invitationDelegate.count({
      where: {
        organizationId: req.organizationId,
        status: "PENDING",
        expiresAt: { gte: new Date() },
        ...(moduleFilter
          ? {
              moduleAccess: {
                path: "$",
                array_contains: moduleFilter
              }
            }
          : {})
      }
    })
  ]);

  return {
    totalUsers,
    activeUsers,
    pendingInvitations
  };
};

export const listUsersTable = async (req: Request) => {
  const search = (req.query.search as string | undefined)?.trim();
  const roleFilter = (req.query.role as string | undefined)?.trim();
  const statusFilter = (req.query.status as "ACTIVE" | "INACTIVE" | undefined) ?? undefined;
  const moduleFilter = (req.query.module as AppModule | undefined) ?? undefined;
  const page = Number(req.query.page ?? 1);
  const limit = Number(req.query.limit ?? 25);

  const users = await prisma.user.findMany({
    where: {
      organizationId: req.organizationId,
      ...(search
        ? {
            OR: [
              { firstName: { contains: search } },
              { lastName: { contains: search } },
              { email: { contains: search } }
            ]
          }
        : {}),
      ...(roleFilter
        ? {
            role: {
              name: {
                equals: roleFilter
              }
            }
          }
        : {}),
      ...(statusFilter
        ? {
            isActive: statusFilter === "ACTIVE"
          }
        : {})
    },
    include: {
      role: {
        include: {
          permissions: {
            include: {
              permission: true
            }
          }
        }
      }
    },
    orderBy: { createdAt: "desc" }
  });

  const tableRows = users
    .map((user) => {
      const permissionKeys = user.role.permissions.map((row) => row.permission.key);
      const modules = deriveModulesFromPermissions(permissionKeys);

      return {
        id: user.id,
        user: {
          fullName: `${user.firstName} ${user.lastName}`.trim(),
          email: user.email
        },
        role: user.role.name,
        modules,
        status: user.isActive ? "ACTIVE" : "INACTIVE",
        lastActive: user.lastLoginAt
      };
    })
    .filter((row) => (moduleFilter ? row.modules.includes(moduleFilter) : true));

  const total = tableRows.length;
  const pagination = getPagination({ page, limit, search });
  const data = tableRows.slice(pagination.skip, pagination.skip + pagination.take);

  return {
    data,
    meta: {
      page,
      limit,
      total
    }
  };
};

export const updateUserAccess = async (req: Request) => {
  const payload = userManagementUpdateUserSchema.parse(req.body);
  const id = String(req.params.id);

  const existing = await prisma.user.findFirst({
    where: { id, organizationId: req.organizationId },
    include: {
      role: true
    }
  });

  if (!existing) throw notFound("User not found");

  const data: { roleId?: string; isActive?: boolean } = {};

  if (payload.roleId) {
    const role = await prisma.role.findFirst({
      where: { id: payload.roleId, organizationId: req.organizationId },
      select: { id: true }
    });

    if (!role) {
      throw badRequest("Selected role does not belong to this organization");
    }

    data.roleId = payload.roleId;
  }

  if (typeof payload.isActive === "boolean") {
    data.isActive = payload.isActive;
  }

  const updated = await prisma.user.update({
    where: { id },
    data,
    include: {
      role: true
    }
  });

  await logAdminActivity({
    organizationId: req.organizationId,
    actorUserId: req.user?.id,
    action: "USER_UPDATED",
    resource: "USER",
    resourceId: updated.id,
    summary: `Updated user access for ${updated.email}`,
    metadata: payload
  });

  return updated;
};

export const removeUser = async (req: Request) => {
  const id = String(req.params.id);

  const existing = await prisma.user.findFirst({
    where: { id, organizationId: req.organizationId },
    include: { role: true }
  });

  if (!existing) throw notFound("User not found");
  if (existing.id === req.user?.id) throw badRequest("You cannot remove your own account");
  if (existing.role.isSystem) throw badRequest("System roles cannot be removed");

  await prisma.user.update({
    where: { id: existing.id },
    data: { isActive: false }
  });

  await logAdminActivity({
    organizationId: req.organizationId,
    actorUserId: req.user?.id,
    action: "USER_REMOVED",
    resource: "USER",
    resourceId: existing.id,
    summary: `Deactivated user ${existing.email}`
  });
};

export const inviteUser = async (req: Request) => {
  const payload = userManagementInviteSchema.parse(req.body);

  const role = await prisma.role.findFirst({
    where: { id: payload.roleId, organizationId: req.organizationId },
    include: {
      permissions: {
        include: {
          permission: true
        }
      }
    }
  });

  if (!role) throw badRequest("Role not found in this organization");

  const roleModules = deriveModulesFromPermissions(role.permissions.map((row) => row.permission.key));
  const invalidModules = payload.moduleAccess.filter((module) => !roleModules.includes(module));
  if (invalidModules.length > 0) {
    throw badRequest("Selected module access is not allowed by the selected role", { invalidModules, roleModules });
  }

  const existingUser = await prisma.user.findFirst({
    where: {
      organizationId: req.organizationId,
      email: payload.email.toLowerCase()
    },
    select: { id: true }
  });

  if (existingUser) {
    throw badRequest("A user with this email already exists in this organization");
  }

  const invitation = await invitationDelegate.create({
    data: {
      organizationId: req.organizationId!,
      roleId: payload.roleId,
      invitedByUserId: req.user?.id,
      email: payload.email.toLowerCase(),
      token: crypto.randomBytes(32).toString("hex"),
      moduleAccess: payload.moduleAccess,
      status: "PENDING",
      expiresAt: new Date(Date.now() + invitationTtlDays * 24 * 60 * 60 * 1000)
    },
    include: {
      role: {
        select: { id: true, name: true }
      }
    }
  });

  await logAdminActivity({
    organizationId: req.organizationId,
    actorUserId: req.user?.id,
    action: "USER_INVITED",
    resource: "INVITATION",
    resourceId: invitation.id,
    summary: `Invited ${invitation.email} to workspace`,
    metadata: {
      roleId: invitation.roleId,
      moduleAccess: payload.moduleAccess
    }
  });

  return {
    id: invitation.id,
    email: invitation.email,
    role: invitation.role?.name ?? null,
    moduleAccess: payload.moduleAccess,
    sentDate: invitation.createdAt,
    status: deriveInvitationStatus(invitation.status, invitation.expiresAt)
  };
};

export const listPendingInvitations = async (req: Request) => {
  const search = (req.query.search as string | undefined)?.trim();
  const statusFilter = (req.query.status as "PENDING" | "EXPIRED" | undefined) ?? undefined;
  const page = Number(req.query.page ?? 1);
  const limit = Number(req.query.limit ?? 25);

  const invitations = await invitationDelegate.findMany({
    where: {
      organizationId: req.organizationId,
      status: {
        in: ["PENDING", "EXPIRED"]
      },
      ...(search
        ? {
            email: {
              contains: search
            }
          }
        : {})
    },
    include: {
      role: {
        select: {
          name: true
        }
      }
    },
    orderBy: { createdAt: "desc" }
  });

  const rows = invitations
    .map((invitation) => ({
      id: invitation.id,
      email: invitation.email,
      role: invitation.role?.name ?? null,
      moduleAccess: Array.isArray(invitation.moduleAccess) ? invitation.moduleAccess : [],
      sentDate: invitation.createdAt,
      status: deriveInvitationStatus(invitation.status, invitation.expiresAt)
    }))
    .filter((row) => (statusFilter ? row.status === statusFilter : true));

  const total = rows.length;
  const pagination = getPagination({ page, limit, search });
  const data = rows.slice(pagination.skip, pagination.skip + pagination.take);

  return {
    data,
    meta: {
      page,
      limit,
      total
    }
  };
};

export const resendInvitation = async (req: Request) => {
  const id = String(req.params.id);

  const existing = await invitationDelegate.findFirst({
    where: { id, organizationId: req.organizationId },
    include: {
      role: {
        select: { name: true }
      }
    }
  });

  if (!existing) throw notFound("Invitation not found");

  const updated = await invitationDelegate.update({
    where: { id },
    data: {
      token: crypto.randomBytes(32).toString("hex"),
      status: "PENDING",
      expiresAt: new Date(Date.now() + invitationTtlDays * 24 * 60 * 60 * 1000)
    }
  });

  await logAdminActivity({
    organizationId: req.organizationId,
    actorUserId: req.user?.id,
    action: "INVITATION_RESENT",
    resource: "INVITATION",
    resourceId: updated.id,
    summary: `Resent invitation to ${updated.email}`
  });

  return {
    id: updated.id,
    email: updated.email,
    message: "Invitation resent successfully",
    lastSentAt: updated.updatedAt
  };
};

export const listUserGroups = async (req: Request) => {
  const search = (req.query.search as string | undefined)?.trim();
  const typeFilter = (req.query.type as "DEPARTMENT" | "FUNCTION" | undefined) ?? undefined;
  const page = Number(req.query.page ?? 1);
  const limit = Number(req.query.limit ?? 25);

  const [departments, functions] = await Promise.all([
    prisma.department.findMany({
      where: {
        organizationId: req.organizationId,
        ...(search
          ? {
              name: {
                contains: search
              }
            }
          : {})
      },
      select: {
        id: true,
        name: true,
        _count: {
          select: {
            employees: true
          }
        },
        createdAt: true
      }
    }),
    prisma.team.findMany({
      where: {
        organizationId: req.organizationId,
        ...(search
          ? {
              name: {
                contains: search
              }
            }
          : {})
      },
      select: {
        id: true,
        name: true,
        _count: {
          select: {
            employees: true
          }
        },
        createdAt: true
      }
    })
  ]);

  const rows = [
    ...departments.map((department) => ({
      id: department.id,
      name: department.name,
      type: "DEPARTMENT" as const,
      members: department._count.employees,
      createdAt: department.createdAt
    })),
    ...functions.map((team) => ({
      id: team.id,
      name: team.name,
      type: "FUNCTION" as const,
      members: team._count.employees,
      createdAt: team.createdAt
    }))
  ]
    .filter((row) => (typeFilter ? row.type === typeFilter : true))
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

  const total = rows.length;
  const pagination = getPagination({ page, limit, search });
  const data = rows.slice(pagination.skip, pagination.skip + pagination.take);

  return {
    data,
    meta: {
      page,
      limit,
      total
    }
  };
};

export const createUserGroup = async (req: Request) => {
  const payload = userManagementCreateGroupSchema.parse(req.body);

  if (payload.type === "DEPARTMENT") {
    const created = await prisma.department.create({
      data: {
        organizationId: req.organizationId!,
        name: payload.name,
        description: payload.description
      }
    });

    await logAdminActivity({
      organizationId: req.organizationId,
      actorUserId: req.user?.id,
      action: "USER_GROUP_CREATED",
      resource: "DEPARTMENT",
      resourceId: created.id,
      summary: `Created department group ${created.name}`,
      metadata: { type: payload.type }
    });

    return {
      id: created.id,
      name: created.name,
      type: payload.type,
      members: 0,
      createdAt: created.createdAt
    };
  }

  const created = await prisma.team.create({
    data: {
      organizationId: req.organizationId!,
      name: payload.name,
      description: payload.description
    }
  });

  await logAdminActivity({
    organizationId: req.organizationId,
    actorUserId: req.user?.id,
    action: "USER_GROUP_CREATED",
    resource: "TEAM",
    resourceId: created.id,
    summary: `Created function group ${created.name}`,
    metadata: { type: payload.type }
  });

  return {
    id: created.id,
    name: created.name,
    type: payload.type,
    members: 0,
    createdAt: created.createdAt
  };
};

export const updateUserGroup = async (req: Request) => {
  const id = String(req.params.id);
  const payload = userManagementUpdateGroupSchema.parse(req.body);

  const department = await prisma.department.findFirst({
    where: { id, organizationId: req.organizationId }
  });

  if (department) {
    const updated = await prisma.department.update({
      where: { id: department.id },
      data: {
        name: payload.name,
        description: payload.description
      },
      include: {
        _count: {
          select: {
            employees: true
          }
        }
      }
    });

    await logAdminActivity({
      organizationId: req.organizationId,
      actorUserId: req.user?.id,
      action: "USER_GROUP_UPDATED",
      resource: "DEPARTMENT",
      resourceId: updated.id,
      summary: `Updated department group ${updated.name}`
    });

    return {
      id: updated.id,
      name: updated.name,
      type: "DEPARTMENT" as const,
      description: updated.description,
      memberCount: updated._count.employees,
      updatedAt: updated.updatedAt,
      message: `${updated.name} updated successfully`
    };
  }

  const team = await prisma.team.findFirst({
    where: { id, organizationId: req.organizationId }
  });

  if (!team) throw notFound("Group not found");

  const updated = await prisma.team.update({
    where: { id: team.id },
    data: {
      name: payload.name,
      description: payload.description
    },
    include: {
      _count: {
        select: {
          employees: true
        }
      }
    }
  });

  await logAdminActivity({
    organizationId: req.organizationId,
    actorUserId: req.user?.id,
    action: "USER_GROUP_UPDATED",
    resource: "TEAM",
    resourceId: updated.id,
    summary: `Updated function group ${updated.name}`
  });

  return {
    id: updated.id,
    name: updated.name,
    type: "FUNCTION" as const,
    description: updated.description,
    memberCount: updated._count.employees,
    updatedAt: updated.updatedAt,
    message: `${updated.name} updated successfully`
  };
};

export const deleteUserGroup = async (req: Request) => {
  const id = String(req.params.id);

  const department = await prisma.department.findFirst({
    where: { id, organizationId: req.organizationId }
  });

  if (department) {
    await prisma.department.delete({ where: { id: department.id } });

    await logAdminActivity({
      organizationId: req.organizationId,
      actorUserId: req.user?.id,
      action: "USER_GROUP_DELETED",
      resource: "DEPARTMENT",
      resourceId: department.id,
      summary: `Deleted department group ${department.name}`
    });

    return {
      message: "User group deleted successfully"
    };
  }

  const team = await prisma.team.findFirst({
    where: { id, organizationId: req.organizationId }
  });

  if (!team) throw notFound("Group not found");

  await prisma.team.delete({ where: { id: team.id } });

  await logAdminActivity({
    organizationId: req.organizationId,
    actorUserId: req.user?.id,
    action: "USER_GROUP_DELETED",
    resource: "TEAM",
    resourceId: team.id,
    summary: `Deleted function group ${team.name}`
  });

  return {
    message: "User group deleted successfully"
  };
};

export const listDepartmentsTable = async (req: Request) => {
  const search = (req.query.search as string | undefined)?.trim();
  const page = Number(req.query.page ?? 1);
  const limit = Number(req.query.limit ?? 25);
  const pagination = getPagination({ page, limit, search });

  const where = {
    organizationId: req.organizationId,
    ...(search
      ? {
          name: {
            contains: search
          }
        }
      : {})
  };

  const [departments, total] = await Promise.all([
    prisma.department.findMany({
      where,
      ...pagination,
      orderBy: { createdAt: "desc" },
      include: {
        headEmployee: {
          select: {
            firstName: true,
            lastName: true
          }
        },
        _count: {
          select: {
            employees: true
          }
        }
      }
    }),
    prisma.department.count({ where })
  ]);

  return {
    data: departments.map((department) => {
      const headEmployee = (department as { headEmployee?: { firstName?: string; lastName?: string } | null }).headEmployee;

      return {
      id: department.id,
      departmentName: department.name,
      headOfDepartment: headEmployee
        ? `${headEmployee.firstName ?? ""} ${headEmployee.lastName ?? ""}`.trim() || null
        : null,
      employeeCount: department._count.employees,
      dateCreated: department.createdAt
      };
    }),
    meta: {
      page,
      limit,
      total
    }
  };
};

export const listBranches = async (req: Request) => {
  const search = (req.query.search as string | undefined)?.trim();
  const page = Number(req.query.page ?? 1);
  const limit = Number(req.query.limit ?? 25);
  const pagination = getPagination({ page, limit, search });

  const where = {
    organizationId: req.organizationId,
    ...(search
      ? {
          OR: [{ name: { contains: search } }, { address: { contains: search } }]
        }
      : {})
  };

  const [data, total] = await Promise.all([
    branchDelegate.findMany({
      where,
      ...pagination,
      orderBy: { createdAt: "desc" }
    }),
    branchDelegate.count({ where })
  ]);

  return { data, meta: { page, limit, total } };
};

export const listBranchesTable = async (req: Request) => {
  const search = (req.query.search as string | undefined)?.trim();
  const page = Number(req.query.page ?? 1);
  const limit = Number(req.query.limit ?? 25);
  const pagination = getPagination({ page, limit, search });

  const where = {
    organizationId: req.organizationId,
    ...(search
      ? {
          OR: [{ name: { contains: search } }, { address: { contains: search } }]
        }
      : {})
  };

  const [branches, total] = await Promise.all([
    branchDelegate.findMany({
      where,
      ...pagination,
      orderBy: { createdAt: "desc" }
    }),
    branchDelegate.count({ where })
  ]);

  return {
    data: branches.map((branch) => ({
      id: String((branch as { id?: unknown }).id ?? ""),
      branchName: String((branch as { name?: unknown }).name ?? ""),
      address: String((branch as { address?: unknown }).address ?? ""),
      phone: ((branch as { phone?: unknown }).phone as string | null | undefined) ?? null,
      dateCreated: (branch as { createdAt?: unknown }).createdAt ?? null
    })),
    meta: {
      page,
      limit,
      total
    }
  };
};

export const getBranch = async (organizationId: string, id: string) => {
  const branch = await branchDelegate.findFirst({
    where: { id, organizationId }
  });

  if (!branch) throw notFound("Branch not found");
  return branch;
};

export const createBranch = async (req: Request) => {
  const branch = await branchDelegate.create({
    data: {
      organizationId: req.organizationId,
      ...req.body
    }
  });

  await logAdminActivity({
    organizationId: req.organizationId,
    actorUserId: req.user?.id,
    action: "BRANCH_CREATED",
    resource: "BRANCH",
    resourceId: extractEntityId(branch),
    summary: "Created a branch location"
  });

  return branch;
};

export const updateBranch = async (req: Request) => {
  const id = String(req.params.id);
  const existing = await branchDelegate.findFirst({
    where: { id, organizationId: req.organizationId }
  });

  if (!existing) throw notFound("Branch not found");

  const branch = await branchDelegate.update({
    where: { id },
    data: req.body
  });

  await logAdminActivity({
    organizationId: req.organizationId,
    actorUserId: req.user?.id,
    action: "BRANCH_UPDATED",
    resource: "BRANCH",
    resourceId: id,
    summary: "Updated a branch location"
  });

  return branch;
};

export const deleteBranch = async (req: Request) => {
  const id = String(req.params.id);
  const existing = await branchDelegate.findFirst({
    where: { id, organizationId: req.organizationId }
  });

  if (!existing) throw notFound("Branch not found");

  await branchDelegate.delete({ where: { id } });

  await logAdminActivity({
    organizationId: req.organizationId,
    actorUserId: req.user?.id,
    action: "BRANCH_DELETED",
    resource: "BRANCH",
    resourceId: id,
    summary: "Deleted a branch location"
  });
};

export const getRoleById = async (organizationId: string, roleId: string) => {
  const role = await findRoleWithPermissions(organizationId, roleId);
  if (!role) throw notFound("Role not found");
  return normalizeRole(role);
};

export const listRoles = async (organizationId: string) => {
  const roles = await prisma.role.findMany({
    where: { organizationId },
    include: { permissions: { include: { permission: true } } },
    orderBy: [{ isSystem: "desc" }, { createdAt: "desc" }]
  });

  return roles.map((role) => normalizeRole(role as RoleWithPermissionsRow));
};

export const createRole = async (req: Request) => {
  const payload = roleCreateSchema.parse(req.body);
  const resolvedPermissionKeys = await resolveCreateRolePermissionKeys(req.organizationId!, payload);
  assertNonSystemRoleAccessScope(resolvedPermissionKeys);
  const { permissionRows, permissionKeys } = await resolvePermissionRecords(resolvedPermissionKeys);

  const role = await prisma.role.create({
    data: {
      organizationId: req.organizationId!,
      name: payload.name,
      description: payload.description,
      permissions: {
        create: permissionRows.map((permission) => ({ permissionId: permission.id }))
      }
    },
    include: { permissions: { include: { permission: true } } }
  });

  await logAdminActivity({
    organizationId: req.organizationId,
    actorUserId: req.user?.id,
    action: "ROLE_CREATED",
    resource: "ROLE",
    resourceId: role.id,
    summary: `Created role ${role.name}`,
    metadata: {
      permissionKeys,
      templateKey: payload.templateKey ?? null,
      cloneFromRoleId: payload.cloneFromRoleId ?? null
    }
  });

  return normalizeRole(role as RoleWithPermissionsRow);
};

export const updateRole = async (req: Request) => {
  const id = String(req.params.id);
  const payload = roleUpdateSchema.parse(req.body);
  const existing = await prisma.role.findFirst({
    where: { id, organizationId: req.organizationId },
    select: { id: true, isSystem: true }
  });
  if (!existing) throw notFound();
  assertRoleIsMutable(existing);

  const resolvedPermissions = payload.permissionKeys ? await resolvePermissionRecords(payload.permissionKeys) : undefined;

  if (resolvedPermissions) {
    assertNonSystemRoleAccessScope(resolvedPermissions.permissionKeys as PermissionKey[]);
  }

  const role = await prisma.role.update({
    where: { id },
    data: {
      name: payload.name,
      description: payload.description,
      permissions: resolvedPermissions
        ? {
            deleteMany: {},
            create: resolvedPermissions.permissionRows.map((permission) => ({ permissionId: permission.id }))
          }
        : undefined
    },
    include: { permissions: { include: { permission: true } } }
  });

  await logAdminActivity({
    organizationId: req.organizationId,
    actorUserId: req.user?.id,
    action: "ROLE_UPDATED",
    resource: "ROLE",
    resourceId: role.id,
    summary: `Updated role ${role.name}`,
    metadata: { permissionKeys: resolvedPermissions?.permissionKeys }
  });

  return normalizeRole(role as RoleWithPermissionsRow);
};

export const cloneRole = async (req: Request) => {
  const id = String(req.params.id);
  const payload = roleCloneSchema.parse(req.body);
  const sourceRole = await findRoleWithPermissions(req.organizationId!, id);
  if (!sourceRole) throw notFound("Role not found");

  const sourcePermissionKeys = sourceRole.permissions.map((row) => row.permission.key as PermissionKey);
  assertNonSystemRoleAccessScope(sourcePermissionKeys);
  const { permissionRows, permissionKeys } = await resolvePermissionRecords(sourcePermissionKeys);
  const name = payload.name ?? (await buildRoleCopyName(req.organizationId!, `${sourceRole.name} Copy`));

  const role = await prisma.role.create({
    data: {
      organizationId: req.organizationId!,
      name,
      description: payload.description ?? sourceRole.description,
      permissions: {
        create: permissionRows.map((permission) => ({ permissionId: permission.id }))
      }
    },
    include: { permissions: { include: { permission: true } } }
  });

  await logAdminActivity({
    organizationId: req.organizationId,
    actorUserId: req.user?.id,
    action: "ROLE_CLONED",
    resource: "ROLE",
    resourceId: role.id,
    summary: `Cloned role ${sourceRole.name} into ${role.name}`,
    metadata: { sourceRoleId: sourceRole.id, permissionKeys }
  });

  return normalizeRole(role as RoleWithPermissionsRow);
};

export const deleteRole = async (req: Request) => {
  const id = String(req.params.id);
  const existing = await prisma.role.findFirst({
    where: { id, organizationId: req.organizationId },
    select: { id: true, name: true, isSystem: true }
  });
  if (!existing) throw notFound();
  assertRoleIsMutable(existing);

  const usage = await getRoleUsageStats(req.organizationId!, id);
  if (usage.assignedUsers > 0) {
    throw badRequest("Cannot delete a role that is assigned to users", usage);
  }

  if (usage.pendingInvitations > 0) {
    throw badRequest("Cannot delete a role with pending invitations", usage);
  }

  await prisma.role.delete({ where: { id } });

  await logAdminActivity({
    organizationId: req.organizationId,
    actorUserId: req.user?.id,
    action: "ROLE_DELETED",
    resource: "ROLE",
    resourceId: id,
    summary: `Deleted role ${existing.name}`
  });
};

export const departmentsCrudOptions = {
  model: "department" as const,
  createSchema: departmentCreateSchema,
  updateSchema: departmentUpdateSchema,
  permission: "admin:departments:view" as const,
  searchableFields: ["name"],
  include: {
    headEmployee: {
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true
      }
    },
    _count: {
      select: {
        employees: true
      }
    }
  },
  beforeCreate: async (data: Record<string, unknown>, req: Request) => {
    await assertHeadEmployeeInOrganization(req.organizationId!, data.headEmployeeId as string | undefined);
    return data;
  },
  beforeUpdate: async (data: Record<string, unknown>, req: Request) => {
    await assertHeadEmployeeInOrganization(req.organizationId!, data.headEmployeeId as string | undefined);
    return data;
  },
  afterCreate: async ({ req, created }: { req: Request; created: unknown }) => {
    await logAdminActivity({
      organizationId: req.organizationId,
      actorUserId: req.user?.id,
      action: "DEPARTMENT_CREATED",
      resource: "DEPARTMENT",
      resourceId: extractEntityId(created),
      summary: "Created a department"
    });
  },
  afterUpdate: async ({ req, updated }: { req: Request; updated: unknown }) => {
    await logAdminActivity({
      organizationId: req.organizationId,
      actorUserId: req.user?.id,
      action: "DEPARTMENT_UPDATED",
      resource: "DEPARTMENT",
      resourceId: extractEntityId(updated),
      summary: "Updated a department"
    });
  },
  afterDelete: async ({ req, id }: { req: Request; id: string }) => {
    await logAdminActivity({
      organizationId: req.organizationId,
      actorUserId: req.user?.id,
      action: "DEPARTMENT_DELETED",
      resource: "DEPARTMENT",
      resourceId: id,
      summary: "Deleted a department"
    });
  }
};

export const branchesCrudOptions = {
  model: "branch" as const,
  createSchema: branchCreateSchema,
  updateSchema: branchUpdateSchema,
  permission: "admin:organization:view" as const,
  searchableFields: ["name", "address"],
  afterCreate: async ({ req, created }: { req: Request; created: unknown }) => {
    await logAdminActivity({
      organizationId: req.organizationId,
      actorUserId: req.user?.id,
      action: "BRANCH_CREATED",
      resource: "BRANCH",
      resourceId: extractEntityId(created),
      summary: "Created a branch location"
    });
  },
  afterUpdate: async ({ req, updated }: { req: Request; updated: unknown }) => {
    await logAdminActivity({
      organizationId: req.organizationId,
      actorUserId: req.user?.id,
      action: "BRANCH_UPDATED",
      resource: "BRANCH",
      resourceId: extractEntityId(updated),
      summary: "Updated a branch location"
    });
  },
  afterDelete: async ({ req, id }: { req: Request; id: string }) => {
    await logAdminActivity({
      organizationId: req.organizationId,
      actorUserId: req.user?.id,
      action: "BRANCH_DELETED",
      resource: "BRANCH",
      resourceId: id,
      summary: "Deleted a branch location"
    });
  }
};

export const getWorkSchedule = async (organizationId: string) => {
  const schedule = await workScheduleDelegate.findUnique({
    where: { organizationId },
    select: {
      id: true,
      monday: true,
      tuesday: true,
      wednesday: true,
      thursday: true,
      friday: true,
      saturday: true,
      sunday: true,
      workStartTime: true,
      workEndTime: true,
      breakDurationMinutes: true,
      updatedAt: true
    }
  });

  if (!schedule) {
    const fallback = {
      monday: true,
      tuesday: true,
      wednesday: true,
      thursday: true,
      friday: true,
      saturday: false,
      sunday: false,
      workStartTime: "09:00",
      workEndTime: "17:00",
      breakDurationMinutes: 60
    };

    return {
      ...fallback,
      summary: summarizeWorkSchedule(fallback)
    };
  }

  return {
    ...schedule,
    summary: summarizeWorkSchedule(schedule as unknown as WorkScheduleInput)
  };
};

export const saveWorkSchedule = async (req: Request) => {
  const payload = workScheduleUpsertSchema.parse(req.body);
  const schedule = await workScheduleDelegate.upsert({
    where: { organizationId: req.organizationId! },
    create: {
      organizationId: req.organizationId!,
      ...payload
    },
    update: payload
  });

  await logAdminActivity({
    organizationId: req.organizationId,
    actorUserId: req.user?.id,
    action: "WORK_SCHEDULE_UPDATED",
    resource: "WORK_SCHEDULE",
    resourceId: extractEntityId(schedule),
    summary: "Updated organization work schedule",
    metadata: payload
  });

  return {
    ...schedule,
    summary: summarizeWorkSchedule(payload)
  };
};

export const getRoleTemplates = async () => {
  return roleTemplates.map((template) => ({
    ...template,
    permissionCount: template.permissionKeys.length,
    modules: deriveModulesFromPermissions(template.permissionKeys)
  }));
};

export const getRolePermissionCatalog = async () => buildPermissionCatalog();

const defaultSecurityPolicy = {
  minPasswordLength: 8,
  passwordExpiryDays: 90,
  lockoutMaxAttempts: 5,
  requireUppercase: true,
  requireLowercase: true,
  requireNumber: true,
  requireSpecialCharacter: true,
  twoFactorEnabled: false,
  enforceTwoFactorForAllUsers: false,
  allowAuthenticatorApp: true,
  allowSmsOtp: false,
  allowEmailOtp: true,
  ipAllowlistEnabled: false
};

const resolveDeviceName = (userAgent?: string | null): string => {
  if (!userAgent) return "Unknown device";

  const normalized = userAgent.toLowerCase();

  const browser = normalized.includes("edg/") || normalized.includes("edge/")
    ? "Edge"
    : normalized.includes("opr/") || normalized.includes("opera")
      ? "Opera"
      : normalized.includes("firefox/") || normalized.includes("fxios/")
        ? "Firefox"
        : normalized.includes("chrome/") || normalized.includes("crios/")
          ? "Chrome"
          : normalized.includes("safari/") && !normalized.includes("chrome/") && !normalized.includes("crios/")
            ? "Safari"
            : normalized.includes("postmanruntime")
              ? "Postman"
              : normalized.includes("insomnia")
                ? "Insomnia"
                : "Browser";

  const os = normalized.includes("windows")
    ? "Windows"
    : normalized.includes("mac os x") || normalized.includes("macintosh")
      ? "MacOS"
      : normalized.includes("android")
        ? "Android"
        : normalized.includes("iphone") || normalized.includes("ipad") || normalized.includes("ios")
          ? "iOS"
          : normalized.includes("linux")
            ? "Linux"
            : "OS";

  return `${browser} / ${os}`;
};

export const getSecurityPolicy = async (organizationId: string) => {
  const policy = await prismaAny.securityPolicy.findUnique({
    where: { organizationId }
  });

  if (!policy) return defaultSecurityPolicy;

  const { id: _id, organizationId: _orgId, updatedByUserId: _updatedBy, createdAt: _createdAt, updatedAt: _updatedAt, ...rest } =
    policy;
  return rest;
};

export const updateSecurityPasswordPolicy = async (req: Request) => {
  const payload = securityPasswordPolicySchema.parse(req.body);

  const policy = await prismaAny.securityPolicy.upsert({
    where: { organizationId: req.organizationId! },
    create: {
      organizationId: req.organizationId!,
      updatedByUserId: req.user?.id,
      ...defaultSecurityPolicy,
      ...payload
    },
    update: {
      updatedByUserId: req.user?.id,
      ...payload
    }
  });

  await logAdminActivity({
    organizationId: req.organizationId,
    actorUserId: req.user?.id,
    action: "SECURITY_PASSWORD_POLICY_UPDATED",
    resource: "SECURITY_POLICY",
    resourceId: policy.id,
    summary: "Updated tenant password policy",
    metadata: payload
  });

  return payload;
};

export const updateSecurityTwoFactorPolicy = async (req: Request) => {
  const payload = securityTwoFactorSchema.parse(req.body);

  const policy = await prismaAny.securityPolicy.upsert({
    where: { organizationId: req.organizationId! },
    create: {
      organizationId: req.organizationId!,
      updatedByUserId: req.user?.id,
      ...defaultSecurityPolicy,
      ...payload
    },
    update: {
      updatedByUserId: req.user?.id,
      ...payload
    }
  });

  await logAdminActivity({
    organizationId: req.organizationId,
    actorUserId: req.user?.id,
    action: "SECURITY_2FA_POLICY_UPDATED",
    resource: "SECURITY_POLICY",
    resourceId: policy.id,
    summary: "Updated tenant two-factor policy",
    metadata: payload
  });

  return payload;
};

export const listActiveSessions = async (req: Request) => {
  const query = securitySessionsQuerySchema.parse(req.query);
  const pagination = getPagination(query);

  const whereClause = {
    organizationId: req.organizationId!,
    ...(query.userId ? { userId: query.userId } : {}),
    ...(query.status === "ACTIVE"
      ? { revokedAt: null }
      : query.status === "REVOKED"
        ? { revokedAt: { not: null } }
        : {})
  };

  const [total, rows] = await prismaAny.$transaction([
    prismaAny.userSession.count({ where: whereClause }),
    prismaAny.userSession.findMany({
      where: whereClause,
      orderBy: { lastSeenAt: "desc" },
      skip: pagination.skip,
      take: pagination.take,
      include: {
        user: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true
          }
        }
      }
    })
  ]);

  return {
    page: query.page,
    limit: query.limit,
    total,
    data: rows.map((row: any) => ({
      id: row.id,
      userId: row.userId,
      userName: `${row.user.firstName} ${row.user.lastName}`.trim(),
      email: row.user.email,
      status: row.revokedAt ? "REVOKED" : row.isCurrent ? "CURRENT" : "ACTIVE",
      device: row.deviceName ?? resolveDeviceName(row.userAgent),
      ipAddress: row.ipAddress,
      location: {
        state: row.locationState,
        country: row.locationCountry
      },
      lastSeenAt: row.lastSeenAt,
      createdAt: row.createdAt,
      expiresAt: row.expiresAt,
      revokedAt: row.revokedAt,
      revokeReason: row.revokeReason
    }))
  };
};

export const revokeSession = async (req: Request) => {
  const payload = securityRevokeSessionSchema.parse(req.body ?? {});
  const sessionId = String(req.params.id);

  const existing = await prismaAny.userSession.findFirst({
    where: {
      id: sessionId,
      organizationId: req.organizationId!
    }
  });

  if (!existing) throw notFound();

  const updated = await prismaAny.userSession.update({
    where: { id: sessionId },
    data: {
      revokedAt: new Date(),
      revokeReason: payload.reason ?? "Revoked by tenant admin",
      isCurrent: false
    }
  });

  await prismaAny.authEvent.create({
    data: {
      organizationId: req.organizationId!,
      userId: existing.userId,
      eventType: "SESSION_REVOKED",
      status: "SUCCESS",
      reasonCode: "ADMIN_ACTION",
      ipAddress: existing.ipAddress,
      userAgent: existing.userAgent,
      deviceName: existing.deviceName,
      locationState: existing.locationState,
      locationCountry: existing.locationCountry
    }
  });

  await logAdminActivity({
    organizationId: req.organizationId,
    actorUserId: req.user?.id,
    action: "SECURITY_SESSION_REVOKED",
    resource: "USER_SESSION",
    resourceId: updated.id,
    summary: "Revoked an active user session",
    metadata: {
      reason: updated.revokeReason
    }
  });

  return {
    id: updated.id,
    revokedAt: updated.revokedAt,
    revokeReason: updated.revokeReason,
    message: "Session revoked"
  };
};

export const revokeSessionsBulk = async (req: Request) => {
  const payload = securityRevokeSessionsBulkSchema.parse(req.body);
  const now = new Date();

  const updateResult = await prismaAny.userSession.updateMany({
    where: {
      organizationId: req.organizationId!,
      id: { in: payload.sessionIds }
    },
    data: {
      revokedAt: now,
      revokeReason: payload.reason ?? "Revoked in bulk by tenant admin",
      isCurrent: false
    }
  });

  await logAdminActivity({
    organizationId: req.organizationId,
    actorUserId: req.user?.id,
    action: "SECURITY_SESSIONS_BULK_REVOKED",
    resource: "USER_SESSION",
    summary: `Revoked ${updateResult.count} session(s)`,
    metadata: {
      count: updateResult.count,
      sessionIds: payload.sessionIds,
      reason: payload.reason
    }
  });

  return {
    revokedCount: updateResult.count,
    message: "Sessions revoked"
  };
};

export const getIpAllowlist = async (organizationId: string) => {
  const [policy, entries] = await prismaAny.$transaction([
    prismaAny.securityPolicy.findUnique({
      where: { organizationId },
      select: { ipAllowlistEnabled: true }
    }),
    prismaAny.ipAllowlistEntry.findMany({
      where: { organizationId },
      orderBy: { createdAt: "desc" }
    })
  ]);

  return {
    enabled: policy?.ipAllowlistEnabled ?? false,
    entries
  };
};

export const toggleIpAllowlist = async (req: Request) => {
  const payload = ipAllowlistToggleSchema.parse(req.body);

  const policy = await prismaAny.securityPolicy.upsert({
    where: { organizationId: req.organizationId! },
    create: {
      organizationId: req.organizationId!,
      updatedByUserId: req.user?.id,
      ...defaultSecurityPolicy,
      ipAllowlistEnabled: payload.enabled
    },
    update: {
      updatedByUserId: req.user?.id,
      ipAllowlistEnabled: payload.enabled
    }
  });

  await logAdminActivity({
    organizationId: req.organizationId,
    actorUserId: req.user?.id,
    action: "SECURITY_IP_ALLOWLIST_TOGGLED",
    resource: "SECURITY_POLICY",
    resourceId: policy.id,
    summary: payload.enabled ? "Enabled IP allowlist" : "Disabled IP allowlist",
    metadata: payload
  });

  return {
    enabled: policy.ipAllowlistEnabled
  };
};

export const addIpAllowlistEntry = async (req: Request) => {
  const payload = ipAllowlistEntryCreateSchema.parse(req.body);

  const entry = await prismaAny.ipAllowlistEntry.create({
    data: {
      organizationId: req.organizationId!,
      value: payload.value,
      label: payload.label,
      createdByUserId: req.user?.id
    }
  });

  await logAdminActivity({
    organizationId: req.organizationId,
    actorUserId: req.user?.id,
    action: "SECURITY_IP_ALLOWLIST_ENTRY_ADDED",
    resource: "IP_ALLOWLIST_ENTRY",
    resourceId: entry.id,
    summary: "Added IP allowlist entry",
    metadata: payload
  });

  return entry;
};

export const removeIpAllowlistEntry = async (req: Request) => {
  const id = String(req.params.id);

  const existing = await prismaAny.ipAllowlistEntry.findFirst({
    where: {
      id,
      organizationId: req.organizationId!
    }
  });

  if (!existing) throw notFound();

  await prismaAny.ipAllowlistEntry.delete({ where: { id } });

  await logAdminActivity({
    organizationId: req.organizationId,
    actorUserId: req.user?.id,
    action: "SECURITY_IP_ALLOWLIST_ENTRY_REMOVED",
    resource: "IP_ALLOWLIST_ENTRY",
    resourceId: id,
    summary: "Removed IP allowlist entry",
    metadata: {
      value: existing.value
    }
  });

  return {
    message: "IP allowlist entry removed"
  };
};

export const listLoginActivity = async (req: Request) => {
  const query = loginActivityQuerySchema.parse(req.query);
  const pagination = getPagination(query);

  const whereClause = {
    organizationId: req.organizationId!,
    ...(query.status ? { status: query.status } : {}),
    ...(query.userId ? { userId: query.userId } : {}),
    ...(query.from || query.to
      ? {
          occurredAt: {
            ...(query.from ? { gte: new Date(query.from) } : {}),
            ...(query.to ? { lte: new Date(query.to) } : {})
          }
        }
      : {})
  };

  const [total, rows] = await prismaAny.$transaction([
    prismaAny.authEvent.count({ where: whereClause }),
    prismaAny.authEvent.findMany({
      where: whereClause,
      orderBy: { occurredAt: "desc" },
      skip: pagination.skip,
      take: pagination.take,
      include: {
        user: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true
          }
        }
      }
    })
  ]);

  return {
    page: query.page,
    limit: query.limit,
    total,
    data: rows.map((row: any) => ({
      id: row.id,
      eventType: row.eventType,
      status: row.status,
      reasonCode: row.reasonCode,
      user: row.user
        ? {
            id: row.user.id,
            name: `${row.user.firstName} ${row.user.lastName}`.trim(),
            email: row.user.email
          }
        : null,
      emailAttempted: row.emailAttempted,
      ipAddress: row.ipAddress,
      device: row.deviceName ?? resolveDeviceName(row.userAgent),
      location: {
        state: row.locationState,
        country: row.locationCountry
      },
      occurredAt: row.occurredAt
    }))
  };
};

export const teamsCrudOptions = {
  model: "team" as const,
  createSchema: teamCreateSchema,
  updateSchema: teamUpdateSchema,
  permission: "admin:teams:view" as const,
  searchableFields: ["name"],
  include: { department: true },
  afterCreate: async ({ req, created }: { req: Request; created: unknown }) => {
    await logAdminActivity({
      organizationId: req.organizationId,
      actorUserId: req.user?.id,
      action: "TEAM_CREATED",
      resource: "TEAM",
      resourceId: extractEntityId(created),
      summary: "Created a team"
    });
  },
  afterUpdate: async ({ req, updated }: { req: Request; updated: unknown }) => {
    await logAdminActivity({
      organizationId: req.organizationId,
      actorUserId: req.user?.id,
      action: "TEAM_UPDATED",
      resource: "TEAM",
      resourceId: extractEntityId(updated),
      summary: "Updated a team"
    });
  },
  afterDelete: async ({ req, id }: { req: Request; id: string }) => {
    await logAdminActivity({
      organizationId: req.organizationId,
      actorUserId: req.user?.id,
      action: "TEAM_DELETED",
      resource: "TEAM",
      resourceId: id,
      summary: "Deleted a team"
    });
  }
};

export const staffCrudOptions = {
  model: "employee" as const,
  createSchema: employeeCreateSchema,
  updateSchema: employeeUpdateSchema,
  permission: "admin:staff:view" as const,
  searchableFields: ["firstName", "lastName", "email", "employeeNo"],
  include: { department: true, team: true },
  afterCreate: async ({ req, created }: { req: Request; created: unknown }) => {
    await logAdminActivity({
      organizationId: req.organizationId,
      actorUserId: req.user?.id,
      action: "STAFF_CREATED",
      resource: "STAFF",
      resourceId: extractEntityId(created),
      summary: "Created a staff record"
    });
  },
  afterUpdate: async ({ req, updated }: { req: Request; updated: unknown }) => {
    await logAdminActivity({
      organizationId: req.organizationId,
      actorUserId: req.user?.id,
      action: "STAFF_UPDATED",
      resource: "STAFF",
      resourceId: extractEntityId(updated),
      summary: "Updated a staff record"
    });
  },
  afterDelete: async ({ req, id }: { req: Request; id: string }) => {
    await logAdminActivity({
      organizationId: req.organizationId,
      actorUserId: req.user?.id,
      action: "STAFF_DELETED",
      resource: "STAFF",
      resourceId: id,
      summary: "Deleted a staff record"
    });
  }
};

export const systemConfigCrudOptions = {
  model: "systemConfig" as const,
  createSchema: systemConfigCreateSchema,
  updateSchema: systemConfigUpdateSchema,
  permission: "admin:system-config:view" as const,
  searchableFields: ["key"],
  afterCreate: async ({ req, created }: { req: Request; created: unknown }) => {
    await logAdminActivity({
      organizationId: req.organizationId,
      actorUserId: req.user?.id,
      action: "SYSTEM_CONFIG_CREATED",
      resource: "SYSTEM_CONFIG",
      resourceId: extractEntityId(created),
      summary: "Created a system configuration entry"
    });
  },
  afterUpdate: async ({ req, updated }: { req: Request; updated: unknown }) => {
    await logAdminActivity({
      organizationId: req.organizationId,
      actorUserId: req.user?.id,
      action: "SYSTEM_CONFIG_UPDATED",
      resource: "SYSTEM_CONFIG",
      resourceId: extractEntityId(updated),
      summary: "Updated a system configuration entry"
    });
  },
  afterDelete: async ({ req, id }: { req: Request; id: string }) => {
    await logAdminActivity({
      organizationId: req.organizationId,
      actorUserId: req.user?.id,
      action: "SYSTEM_CONFIG_DELETED",
      resource: "SYSTEM_CONFIG",
      resourceId: id,
      summary: "Deleted a system configuration entry"
    });
  }
};

const defaultNotificationPreferenceEnabled = true;
export const deriveNotificationModuleToggleState = (states: readonly boolean[]) => ({
  moduleStatus: states.every(Boolean) ? "ENABLED" as const : states.every((state) => !state) ? "DISABLED" as const : "PARTIAL" as const,
  toggleAll: states.length > 0 && states.every(Boolean)
});
const activeAnnouncementWhere = (now: Date) => ({ isPublished: true, publishedAt: { not: null, lte: now }, OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] });

const getNotificationChannel = async (channelKey: string) => {
  const channel = await prisma.notificationChannel.findUnique({ where: { key: channelKey } });
  if (!channel?.isActive) throw notFound("Notification channel not found");
  return channel;
};

const getNotificationModuleCategories = async (moduleKey: string) => {
  const categories = await prisma.notificationCategory.findMany({ where: { moduleKey, isActive: true }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }] });
  if (categories.length === 0) throw notFound("Notification module not found");
  return categories;
};

export const getTenantNotificationPreferences = async (organizationId: string, channelKey: TenantNotificationChannelKey): Promise<NotificationChannelPreferences> => {
  const channel = await getNotificationChannel(channelKey);
  const categories = await prisma.notificationCategory.findMany({ where: { isActive: true }, orderBy: [{ moduleKey: "asc" }, { sortOrder: "asc" }] });
  const preferences = await prisma.tenantNotificationPreference.findMany({ where: { organizationId, channelId: channel.id, categoryId: { in: categories.map((category) => category.id) } } });
  const enabledByCategory = new Map(preferences.map((preference) => [preference.categoryId, preference.enabled]));
  const grouped = new Map<string, typeof categories>();
  for (const category of categories) grouped.set(category.moduleKey, [...(grouped.get(category.moduleKey) ?? []), category]);
  return {
    channel: { id: channel.id, key: channel.key, name: channel.name, description: channel.description },
    modules: [...grouped.entries()].map(([moduleKey, moduleCategories]) => {
      const notifications = moduleCategories.map((category) => ({ notificationId: category.id, categoryKey: category.key, categoryName: category.name, description: category.description, enabled: enabledByCategory.get(category.id) ?? defaultNotificationPreferenceEnabled }));
      return { moduleKey, moduleName: moduleCategories[0].moduleName, ...deriveNotificationModuleToggleState(notifications.map((notification) => notification.enabled)), notifications };
    })
  };
};

export const getNotificationsAlertsOverview = async (req: Request) => {
  const [inApp, email, announcements] = await Promise.all([
    getTenantNotificationPreferences(req.organizationId!, "IN_APP"),
    getTenantNotificationPreferences(req.organizationId!, "EMAIL"),
    listPlatformAnnouncements(req, { limitOverride: 5 })
  ]);
  return { sections: { inApp, email, announcements: announcements.data }, unreadAnnouncementCount: announcements.metadata.unreadCount };
};

export const toggleTenantNotificationCategory = async (req: Request) => {
  const payload = notificationToggleSchema.parse(req.body);
  const channel = await getNotificationChannel(String(req.params.channelKey));
  const category = await prisma.notificationCategory.findFirst({ where: { id: String(req.params.categoryId), moduleKey: String(req.params.moduleKey), isActive: true } });
  if (!category) throw notFound("Notification category not found in the selected module");
  const current = await prisma.tenantNotificationPreference.findUnique({ where: { organizationId_channelId_categoryId: { organizationId: req.organizationId!, channelId: channel.id, categoryId: category.id } } });
  if ((current?.enabled ?? defaultNotificationPreferenceEnabled) === payload.enabled) throw badRequest("Notification category already has the requested state", { errorCode: "DUPLICATE_OPERATION" });
  await prisma.tenantNotificationPreference.upsert({ where: { organizationId_channelId_categoryId: { organizationId: req.organizationId!, channelId: channel.id, categoryId: category.id } }, create: { organizationId: req.organizationId!, channelId: channel.id, categoryId: category.id, enabled: payload.enabled }, update: { enabled: payload.enabled } });
  await createAuditLog({ organizationId: req.organizationId!, actorUserId: req.user?.id, action: "NOTIFICATION_PREFERENCE_UPDATED", resource: "NOTIFICATION_PREFERENCE", resourceId: category.id, summary: `${payload.enabled ? "Enabled" : "Disabled"} ${category.name} for ${channel.name}`, metadata: { channelKey: channel.key, moduleKey: category.moduleKey, categoryKey: category.key, enabled: payload.enabled } });
  return getTenantNotificationPreferences(req.organizationId!, channel.key as TenantNotificationChannelKey);
};

export const toggleTenantNotificationModule = async (req: Request) => {
  const payload = notificationToggleSchema.parse(req.body);
  const channel = await getNotificationChannel(String(req.params.channelKey));
  const categories = await getNotificationModuleCategories(String(req.params.moduleKey));
  const existing = await prisma.tenantNotificationPreference.findMany({ where: { organizationId: req.organizationId!, channelId: channel.id, categoryId: { in: categories.map((category) => category.id) } } });
  const byCategory = new Map(existing.map((preference) => [preference.categoryId, preference.enabled]));
  if (categories.every((category) => (byCategory.get(category.id) ?? defaultNotificationPreferenceEnabled) === payload.enabled)) throw badRequest("Notification module already has the requested state", { errorCode: "DUPLICATE_OPERATION" });
  await prisma.$transaction(categories.map((category) => prisma.tenantNotificationPreference.upsert({ where: { organizationId_channelId_categoryId: { organizationId: req.organizationId!, channelId: channel.id, categoryId: category.id } }, create: { organizationId: req.organizationId!, channelId: channel.id, categoryId: category.id, enabled: payload.enabled }, update: { enabled: payload.enabled } })));
  await createAuditLog({ organizationId: req.organizationId!, actorUserId: req.user?.id, action: "NOTIFICATION_MODULE_PREFERENCES_UPDATED", resource: "NOTIFICATION_PREFERENCE", resourceId: String(req.params.moduleKey), summary: `${payload.enabled ? "Enabled" : "Disabled"} all ${req.params.moduleKey} notifications for ${channel.name}`, metadata: { channelKey: channel.key, moduleKey: req.params.moduleKey, enabled: payload.enabled, categoryCount: categories.length } });
  return getTenantNotificationPreferences(req.organizationId!, channel.key as TenantNotificationChannelKey);
};

type AnnouncementWithRead = Prisma.PlatformAnnouncementGetPayload<{ include: { readStatuses: { select: { readAt: true } } } }>;
const mapPlatformAnnouncement = (announcement: AnnouncementWithRead): PlatformAnnouncementResponse => ({
  announcementId: announcement.id, title: announcement.title, summary: announcement.summary, fullDescription: announcement.description,
  announcementType: announcement.type, contentFormat: announcement.contentFormat, createdDate: announcement.createdAt,
  publishedDate: announcement.publishedAt, readStatus: announcement.readStatuses.length > 0 ? "READ" : "UNREAD",
  readAt: announcement.readStatuses[0]?.readAt ?? null, learnMoreUrl: announcement.learnMoreUrl,
  contentReference: announcement.contentReference, expiryDate: announcement.expiresAt
});

export const listPlatformAnnouncements = async (req: Request, options?: { limitOverride?: number }) => {
  const query = announcementListQuerySchema.parse(req.query); const now = new Date();
  const readFilter = query.readStatus === "READ" ? { readStatuses: { some: { userId: req.user!.id, organizationId: req.organizationId! } } } : query.readStatus === "UNREAD" ? { readStatuses: { none: { userId: req.user!.id } } } : {};
  const where = { ...activeAnnouncementWhere(now), ...(query.type ? { type: query.type } : {}), ...readFilter };
  const limit = options?.limitOverride ?? query.limit;
  const [total, rows, unreadCount] = await prisma.$transaction([
    prisma.platformAnnouncement.count({ where }),
    prisma.platformAnnouncement.findMany({ where, include: { readStatuses: { where: { userId: req.user!.id, organizationId: req.organizationId! }, select: { readAt: true } } }, orderBy: { publishedAt: query.sort === "OLDEST" ? "asc" : "desc" }, skip: options?.limitOverride ? 0 : (query.page - 1) * limit, take: limit }),
    prisma.platformAnnouncement.count({ where: { ...activeAnnouncementWhere(now), readStatuses: { none: { userId: req.user!.id } } } })
  ]);
  return { data: rows.map(mapPlatformAnnouncement), pagination: { page: query.page, limit, total, totalPages: Math.ceil(total / limit) }, metadata: { unreadCount, filters: { type: query.type ?? null, readStatus: query.readStatus, sort: query.sort } } };
};

const getVisiblePlatformAnnouncement = async (req: Request) => {
  const announcement = await prisma.platformAnnouncement.findFirst({ where: { id: String(req.params.announcementId), ...activeAnnouncementWhere(new Date()) }, include: { readStatuses: { where: { userId: req.user!.id, organizationId: req.organizationId! }, select: { readAt: true } } } });
  if (!announcement) throw notFound("Announcement not found");
  return announcement;
};

export const getPlatformAnnouncement = async (req: Request) => mapPlatformAnnouncement(await getVisiblePlatformAnnouncement(req));
export const getPlatformAnnouncementLearnMore = async (req: Request) => { const item = mapPlatformAnnouncement(await getVisiblePlatformAnnouncement(req)); return { announcementId: item.announcementId, title: item.title, content: item.fullDescription, contentFormat: item.contentFormat, learnMoreUrl: item.learnMoreUrl, contentReference: item.contentReference }; };
export const markPlatformAnnouncementRead = async (req: Request) => {
  const announcement = await getVisiblePlatformAnnouncement(req);
  const existing = await prisma.announcementReadStatus.findUnique({ where: { userId_announcementId: { userId: req.user!.id, announcementId: announcement.id } } });
  if (existing) throw badRequest("Announcement is already marked as read", { errorCode: "DUPLICATE_OPERATION" });
  return prisma.announcementReadStatus.create({ data: { organizationId: req.organizationId!, userId: req.user!.id, announcementId: announcement.id } });
};
export const markAllPlatformAnnouncementsRead = async (req: Request) => {
  const unread = await prisma.platformAnnouncement.findMany({ where: { ...activeAnnouncementWhere(new Date()), readStatuses: { none: { userId: req.user!.id } } }, select: { id: true } });
  if (unread.length === 0) return { markedRead: 0 };
  const result = await prisma.announcementReadStatus.createMany({ data: unread.map((announcement) => ({ organizationId: req.organizationId!, userId: req.user!.id, announcementId: announcement.id })), skipDuplicates: true });
  return { markedRead: result.count };
};

const defaultGeneralSettings = { timeZone: "Africa/Lagos", language: "en", dateFormat: "DD/MM/YYYY", currency: "NGN", accentColor: "#2563EB" } as const;
const generalSettingsStorageRoot = path.resolve(process.cwd(), env.UPLOAD_DIR, "general-settings");

const getOrganizationGeneralSettingsRecord = async (organizationId: string) => {
  const [organization, settings] = await Promise.all([
    prisma.organization.findUnique({ where: { id: organizationId }, select: { id: true, name: true, currency: true, profileImageUrl: true } }),
    prisma.organizationGeneralSettings.findUnique({ where: { organizationId } })
  ]);
  if (!organization) throw notFound("Organization not found");
  return { organization, settings };
};

export const getGeneralSettingsOverview = async (req: Request) => {
  const { organization, settings } = await getOrganizationGeneralSettingsRecord(req.organizationId!);
  return {
    locale: { timeZone: settings?.timeZone ?? defaultGeneralSettings.timeZone, language: settings?.language ?? defaultGeneralSettings.language, dateFormat: settings?.dateFormat ?? defaultGeneralSettings.dateFormat, currency: settings?.currency ?? organization.currency ?? defaultGeneralSettings.currency },
    branding: { logoUrl: settings?.logoUrl ?? organization.profileImageUrl, fileName: settings?.logoFileName ?? null, uploadTimestamp: settings?.logoUploadedAt ?? null, accentColor: settings?.accentColor ?? defaultGeneralSettings.accentColor, linkText: settings?.linkText ?? null },
    dataPrivacy: { exportEndpoint: "/admin/general-settings/data-privacy/exports", deletionRequestEndpoint: "/admin/general-settings/data-privacy/deletion-request" }
  };
};

export const getLocaleSettings = async (req: Request): Promise<LocaleSettingsResponse> => (await getGeneralSettingsOverview(req)).locale as LocaleSettingsResponse;
export const getLocaleOptions = async (req: Request) => {
  const query = localeOptionsQuerySchema.parse(req.query); const search = query.search?.toLowerCase();
  const zones = Intl.supportedValuesOf("timeZone").filter((zone) => !search || zone.toLowerCase().includes(search)).slice(0, query.limit);
  return { timeZones: zones.map((identifier) => ({ identifier, label: identifier })), languages: supportedLanguages, dateFormats: supportedDateFormats, currencies: supportedCurrencies };
};

export const updateLocaleSettings = async (req: Request) => {
  const payload = localeSettingsSchema.parse(req.body);
  const updated = await prisma.$transaction(async (tx) => {
    await tx.organization.update({ where: { id: req.organizationId! }, data: { currency: payload.currency } });
    return tx.organizationGeneralSettings.upsert({ where: { organizationId: req.organizationId! }, create: { organizationId: req.organizationId!, ...payload }, update: payload });
  });
  await createAuditLog({ organizationId: req.organizationId!, actorUserId: req.user?.id, action: "GENERAL_LOCALE_SETTINGS_UPDATED", resource: "ORGANIZATION_SETTINGS", resourceId: updated.id, summary: "Updated locale and regional settings", metadata: payload });
  return { timeZone: updated.timeZone, language: updated.language, dateFormat: updated.dateFormat, currency: updated.currency };
};

const mapBrandingSettings = (organization: { profileImageUrl: string | null }, settings: Awaited<ReturnType<typeof prisma.organizationGeneralSettings.findUnique>>): BrandingSettingsResponse => ({
  logoUrl: settings?.logoUrl ?? organization.profileImageUrl, fileName: settings?.logoFileName ?? null, uploadTimestamp: settings?.logoUploadedAt ?? null,
  accentColor: settings?.accentColor ?? defaultGeneralSettings.accentColor, linkText: settings?.linkText ?? null,
  logoMetadata: { mimeType: settings?.logoMimeType ?? null, size: settings?.logoSize ?? null, width: settings?.logoWidth ?? null, height: settings?.logoHeight ?? null }
});

export const getBrandingSettings = async (req: Request) => { const record = await getOrganizationGeneralSettingsRecord(req.organizationId!); return mapBrandingSettings(record.organization, record.settings); };
export const updateBrandingSettings = async (req: Request) => {
  const payload = brandingSettingsSchema.parse(req.body);
  const settings = await prisma.organizationGeneralSettings.upsert({ where: { organizationId: req.organizationId! }, create: { organizationId: req.organizationId!, accentColor: payload.accentColor, linkText: payload.linkText }, update: payload });
  await createAuditLog({ organizationId: req.organizationId!, actorUserId: req.user?.id, action: "GENERAL_BRANDING_UPDATED", resource: "ORGANIZATION_SETTINGS", resourceId: settings.id, summary: "Updated organization branding", metadata: payload });
  const organization = await prisma.organization.findUniqueOrThrow({ where: { id: req.organizationId! }, select: { profileImageUrl: true } });
  return mapBrandingSettings(organization, settings);
};

const inspectBrandingImage = (file: Express.Multer.File) => {
  if (file.mimetype === "image/png") {
    const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
    if (file.buffer.length < 24 || !file.buffer.subarray(0, 8).equals(pngSignature)) throw badRequest("Invalid PNG image", { errorCode: "INVALID_LOGO_FILE" });
    return { width: file.buffer.readUInt32BE(16), height: file.buffer.readUInt32BE(20), buffer: file.buffer, extension: ".png" };
  }
  const svg = file.buffer.toString("utf8");
  if (!/<svg\b/i.test(svg) || /<script\b|<!ENTITY|on\w+\s*=|javascript:/i.test(svg)) throw badRequest("Invalid or unsafe SVG image", { errorCode: "INVALID_LOGO_FILE" });
  const viewBox = /viewBox=["']\s*[\d.-]+\s+[\d.-]+\s+([\d.]+)\s+([\d.]+)["']/i.exec(svg);
  const widthMatch = /\bwidth=["']([\d.]+)/i.exec(svg); const heightMatch = /\bheight=["']([\d.]+)/i.exec(svg);
  const width = Number(widthMatch?.[1] ?? viewBox?.[1] ?? 0); const height = Number(heightMatch?.[1] ?? viewBox?.[2] ?? 0);
  const optimized = svg.replace(/<!--([\s\S]*?)-->/g, "").replace(/>\s+</g, "><").trim();
  return { width, height, buffer: Buffer.from(optimized), extension: ".svg" };
};

export const uploadBrandingLogo = async (req: Request) => {
  if (!req.file) throw badRequest("Logo file is required", { errorCode: "LOGO_REQUIRED" });
  const inspected = inspectBrandingImage(req.file); const now = new Date();
  const directory = path.join(generalSettingsStorageRoot, "branding", req.organizationId!); await fs.mkdir(directory, { recursive: true });
  const fileName = `${now.getTime()}-${crypto.randomUUID()}${inspected.extension}`; const absolutePath = path.join(directory, fileName);
  await fs.writeFile(absolutePath, inspected.buffer);
  const publicPath = `${env.UPLOAD_PUBLIC_BASE_PATH}/general-settings/branding/${req.organizationId!}/${fileName}`;
  const logoUrl = `${req.protocol}://${req.get("host")}${publicPath}`;
  const previous = await prisma.organizationGeneralSettings.findUnique({ where: { organizationId: req.organizationId! } });
  try {
    const settings = await prisma.$transaction(async (tx) => {
      await tx.organization.update({ where: { id: req.organizationId! }, data: { profileImageUrl: logoUrl } });
      return tx.organizationGeneralSettings.upsert({ where: { organizationId: req.organizationId! }, create: { organizationId: req.organizationId!, logoUrl, logoFileName: fileName, logoMimeType: req.file!.mimetype, logoSize: inspected.buffer.length, logoWidth: inspected.width || null, logoHeight: inspected.height || null, logoUploadedAt: now }, update: { logoUrl, logoFileName: fileName, logoMimeType: req.file!.mimetype, logoSize: inspected.buffer.length, logoWidth: inspected.width || null, logoHeight: inspected.height || null, logoUploadedAt: now } });
    });
    if (previous?.logoFileName) await fs.rm(path.join(directory, previous.logoFileName), { force: true }).catch(() => undefined);
    await createAuditLog({ organizationId: req.organizationId!, actorUserId: req.user?.id, action: "GENERAL_BRANDING_LOGO_UPDATED", resource: "ORGANIZATION_SETTINGS", resourceId: settings.id, summary: "Updated organization logo", metadata: { fileName, mimeType: req.file.mimetype, size: inspected.buffer.length, width: inspected.width, height: inspected.height } });
    return { ...mapBrandingSettings({ profileImageUrl: logoUrl }, settings), recommendedDimensionsMet: inspected.width >= 200 && inspected.height >= 200 };
  } catch (error) { await fs.rm(absolutePath, { force: true }).catch(() => undefined); throw error; }
};

const jsonBuffer = (value: unknown) => Buffer.from(JSON.stringify(value, (_key, item) => typeof item === "bigint" ? item.toString() : item, 2));
const csvEscape = (value: unknown) => { const text = value == null ? "" : value instanceof Date ? value.toISOString() : String(value); return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text; };
const toCsv = (rows: Array<Record<string, unknown>>) => { if (!rows.length) return Buffer.from(""); const headers = Object.keys(rows[0]); return Buffer.from([headers.join(","), ...rows.map((row) => headers.map((header) => csvEscape(row[header])).join(","))].join("\n")); };
const crcTable = Array.from({ length: 256 }, (_, index) => { let value = index; for (let bit = 0; bit < 8; bit++) value = (value & 1) ? 0xedb88320 ^ (value >>> 1) : value >>> 1; return value >>> 0; });
const crc32 = (buffer: Buffer) => { let crc = 0xffffffff; for (const byte of buffer) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8); return (crc ^ 0xffffffff) >>> 0; };
const createZipArchive = (entries: Array<{ name: string; data: Buffer }>) => {
  const localParts: Buffer[] = []; const centralParts: Buffer[] = []; let offset = 0;
  for (const entry of entries) { const name = Buffer.from(entry.name); const checksum = crc32(entry.data); const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt32LE(checksum, 14); local.writeUInt32LE(entry.data.length, 18); local.writeUInt32LE(entry.data.length, 22); local.writeUInt16LE(name.length, 26); localParts.push(local, name, entry.data); const central = Buffer.alloc(46); central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt32LE(checksum, 16); central.writeUInt32LE(entry.data.length, 20); central.writeUInt32LE(entry.data.length, 24); central.writeUInt16LE(name.length, 28); central.writeUInt32LE(offset, 42); centralParts.push(central, name); offset += local.length + name.length + entry.data.length; }
  const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0); const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10); end.writeUInt32LE(centralSize, 12); end.writeUInt32LE(offset, 16); return Buffer.concat([...localParts, ...centralParts, end]);
};

export const requestOrganizationDataExport = async (req: Request) => {
  const requester = await prisma.user.findFirst({ where: { id: req.user!.id, organizationId: req.organizationId!, isActive: true }, select: { id: true, email: true } });
  if (!requester) throw notFound("Tenant Admin account not found");
  const duplicate = await prisma.organizationDataExport.findFirst({ where: { organizationId: req.organizationId!, requestedByUserId: requester.id, status: "PENDING_PLATFORM_FULFILLMENT" } });
  if (duplicate) throw badRequest("A data export request is already awaiting platform fulfilment", { errorCode: "DUPLICATE_EXPORT_REQUEST", exportId: duplicate.id, deliveryDueAt: duplicate.deliveryDueAt });
  const requestedAt = new Date(); const deliveryDueAt = new Date(requestedAt.getTime() + 24 * 60 * 60 * 1000);
  const exportRecord = await prisma.organizationDataExport.create({ data: { organizationId: req.organizationId!, requestedByUserId: requester.id, status: "PENDING_PLATFORM_FULFILLMENT", deliveryEmail: requester.email, deliveryDueAt, requestedAt } });
  await createAuditLog({ organizationId: req.organizationId!, actorUserId: requester.id, action: "ORGANIZATION_DATA_EXPORT_REQUESTED", resource: "ORGANIZATION_DATA_EXPORT", resourceId: exportRecord.id, summary: "Requested organization data export for platform fulfilment", metadata: { deliveryEmail: requester.email, deliveryDueAt, datasets: ["employees", "invoices", "expenses", "attendance-records", "organization-settings"] } });
  return { exportId: exportRecord.id, exportDate: exportRecord.requestedAt, requestedBy: requester.id, exportStatus: exportRecord.status, deliveryEmail: exportRecord.deliveryEmail, deliveryDueAt: exportRecord.deliveryDueAt, deliveryMethod: "OFFICIAL_TENANT_ADMIN_EMAIL", fileSize: null, downloadUrl: null, fileReference: null, message: "The platform administrator will deliver the organization export to the official Tenant Admin email within 24 hours." };
};

export const getOrganizationDataExportDownload = async (req: Request) => {
  const record = await prisma.organizationDataExport.findFirst({ where: { id: String(req.params.exportId), organizationId: req.organizationId!, status: "COMPLETED" } });
  if (!record?.fileReference || !record.fileName) throw notFound("Organization data export not found");
  const absolutePath = path.resolve(process.cwd(), env.UPLOAD_DIR, record.fileReference); const allowedRoot = path.resolve(generalSettingsStorageRoot, "exports", req.organizationId!);
  if (!absolutePath.startsWith(`${allowedRoot}${path.sep}`)) throw badRequest("Invalid export file reference", { errorCode: "INVALID_FILE_REFERENCE" });
  try { return { buffer: await fs.readFile(absolutePath), fileName: record.fileName }; } catch { throw notFound("Export file is no longer available"); }
};

export const requestOrganizationDeletion = async (req: Request) => {
  const payload = organizationDeletionRequestSchema.parse(req.body);
  const requester = await prisma.user.findFirst({ where: { id: req.user!.id, organizationId: req.organizationId!, isActive: true }, select: { passwordHash: true } });
  if (!requester || !(await bcrypt.compare(payload.password, requester.passwordHash))) throw badRequest("Password confirmation is invalid", { errorCode: "REAUTHENTICATION_FAILED" });
  const existing = await prisma.organizationDeletionRequest.findFirst({ where: { organizationId: req.organizationId!, status: "PENDING_PLATFORM_APPROVAL" } });
  if (existing) throw badRequest("An organization deletion request is already pending", { errorCode: "DUPLICATE_DELETION_REQUEST", requestId: existing.id });
  const deletionRequest = await prisma.organizationDeletionRequest.create({ data: { organizationId: req.organizationId!, requestedByUserId: req.user!.id, reason: payload.reason, status: "PENDING_PLATFORM_APPROVAL" } });
  await createAuditLog({ organizationId: req.organizationId!, actorUserId: req.user?.id, action: "ORGANIZATION_DELETION_REQUESTED", resource: "ORGANIZATION_DELETION_REQUEST", resourceId: deletionRequest.id, summary: "Requested permanent organization deletion", metadata: { status: deletionRequest.status } });
  return { requestId: deletionRequest.id, organizationId: deletionRequest.organizationId, requestedBy: deletionRequest.requestedByUserId, requestedAt: deletionRequest.requestedAt, status: deletionRequest.status, message: "The platform administrator must approve this request before any tenant data is deleted." };
};
