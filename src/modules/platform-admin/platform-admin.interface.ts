import { billingModuleKeys, billingPlanKeys, type BillingModuleKey, type BillingPlanKey } from "../billing/billing.catalog";

export const platformSubscriptionStatuses = ["ACTIVE", "TRIAL", "TRIALING", "PENDING", "EXPIRED", "SUSPENDED", "CANCELLED"] as const;
export const tenantHealthSortFields = ["organizationName", "registrationDate", "lastActiveDate", "monthlyRecurringRevenue", "userCount", "subscriptionStatus"] as const;
export const platformActivityTypes = [
  "ORGANIZATION_CREATED", "ORGANIZATION_DELETED", "SUBSCRIPTION_UPGRADED", "SUBSCRIPTION_CANCELLED",
  "SUBSCRIPTION_RENEWED", "MODULE_PURCHASED", "PAYMENT_COMPLETED", "PAYMENT_FAILED",
  "USER_INVITED", "USER_REMOVED", "BRANDING_UPDATED", "DATA_EXPORT_REQUESTED", "ACCOUNT_DELETION_REQUESTED", "OTHER"
] as const;

export { billingModuleKeys, billingPlanKeys };
export type PlatformSubscriptionStatus = (typeof platformSubscriptionStatuses)[number];
export type TenantHealthSortField = (typeof tenantHealthSortFields)[number];
export type PlatformActivityType = (typeof platformActivityTypes)[number];
export type PlatformModuleKey = BillingModuleKey;
export type PlatformPlanKey = BillingPlanKey;
export type PlatformFeatureFlagKey = "BETA_ANALYTICS_DASHBOARD" | "NEW_INVOICE_EDITOR" | "BULK_USER_IMPORT" | "AI_POWERED_INSIGHTS" | "MULTI_CURRENCY_SUPPORT";
export type PlatformEmailTemplateKey = "ONBOARDING_WELCOME" | "INVOICE_GENERATED" | "PLAN_EXPIRY_REMINDER";
export type SupportTicketStatus = "OPEN" | "IN_PROGRESS" | "RESOLVED";

export interface InvoiceListQuery {
  page: number;
  limit: number;
  search?: string;
  status?: "PAID" | "OVERDUE" | "DRAFT";
  tenantId?: string;
  period?: string;
  billingPeriod?: string;
  year?: number;
  month?: number;
  startDate?: Date;
  endDate?: Date;
  sortBy: "dueDate" | "amount" | "createdAt" | "tenantName";
  sortOrder: "asc" | "desc";
}

export interface PlatformUsersQuery {
  page: number;
  limit: number;
  search?: string;
  tenantId?: string;
  roleId?: string;
  status: "ALL" | "ACTIVE" | "INACTIVE";
  sortBy: "name" | "email" | "tenantName" | "role" | "lastActive" | "status" | "createdAt";
  sortOrder: "asc" | "desc";
}

export interface PlatformModulesQuery {
  page: number;
  limit: number;
  search?: string;
  tenantId?: string;
  tenantStatus: "ALL" | "ACTIVE" | "SUSPENDED";
  module?: BillingModuleKey;
  enabled?: boolean;
  plan?: BillingPlanKey;
  sortBy: "tenantName" | "tenantStatus" | "usage" | "hrisUsers" | "payrollUsers" | "accountingUsers" | "lastUpdatedAt" | "createdAt";
  sortOrder: "asc" | "desc";
}

export interface PlatformSubscriptionSnapshot {
  organizationId: string;
  planKey: BillingPlanKey;
  planName: string;
  status: PlatformSubscriptionStatus;
  renewalDate: Date | null;
  billingCycle: "MONTHLY" | "YEARLY";
  activeModules: BillingModuleKey[];
  monthlyRecurringRevenue: number;
  baseMonthlyRecurringRevenue: number;
  revenueComponents: Array<{ key: string; source: "BASE_PLAN"; monthlyRevenue: number }>;
}
