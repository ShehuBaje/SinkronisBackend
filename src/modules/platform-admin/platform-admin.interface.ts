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
  revenueComponents: Array<{ key: string; source: "BASE_PLAN" | "ADD_ON"; monthlyRevenue: number }>;
  seatAllocation: number | null;
}
