import type { PermissionKey } from "../auth/permissions";
import type { BillingModuleKey } from "./billing.catalog";
import { getBillingPlanDefinition } from "./billing.catalog";
import { prisma } from "../../core/prisma";

const objectValue = (value: unknown) => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const activeValue = (value: unknown) => typeof value === "string" ? value.toUpperCase() === "ACTIVE" : String(objectValue(value).status ?? "").toUpperCase() === "ACTIVE";

export const evaluateEffectiveModuleAccess = async (input: { organizationId: string; userIsActive: boolean; permissions: readonly PermissionKey[]; module: BillingModuleKey }) => {
  if (!input.userIsActive || !input.permissions.some((key) => key.startsWith(`${input.module}:`))) return false;
  const [organization, configs] = await Promise.all([
    prisma.organization.findFirst({ where: { id: input.organizationId, status: "ACTIVE", deletionRequests: { none: { status: "PENDING_PLATFORM_APPROVAL" } } }, select: { id: true } }),
    prisma.systemConfig.findMany({ where: { organizationId: input.organizationId, key: { in: ["billing.subscription", `module.${input.module}.status`] } }, select: { key: true, value: true } })
  ]);
  if (!organization) return false;
  const subscription = objectValue(configs.find((row) => row.key === "billing.subscription")?.value);
  if (String(subscription.status ?? "").toUpperCase() !== "ACTIVE") return false;
  const explicit = configs.find((row) => row.key === `module.${input.module}.status`);
  if (explicit) return activeValue(explicit.value);
  const plan = getBillingPlanDefinition(String(subscription.planKey ?? "") as never);
  return Boolean(plan?.includedModules.includes(input.module));
};

/** Tenant-level entitlement check for cross-module read models such as dashboards. */
export const isOrganizationModuleEnabled = async (organizationId: string, module: BillingModuleKey) => {
  const [organization, configs] = await Promise.all([
    prisma.organization.findFirst({ where: { id: organizationId, status: "ACTIVE", deletionRequests: { none: { status: "PENDING_PLATFORM_APPROVAL" } } }, select: { id: true } }),
    prisma.systemConfig.findMany({ where: { organizationId, key: { in: ["billing.subscription", `module.${module}.status`] } }, select: { key: true, value: true } })
  ]);
  if (!organization) return false;
  const subscription = objectValue(configs.find((row) => row.key === "billing.subscription")?.value);
  if (String(subscription.status ?? "").toUpperCase() !== "ACTIVE") return false;
  const explicit = configs.find((row) => row.key === `module.${module}.status`);
  if (explicit) return activeValue(explicit.value);
  return Boolean(getBillingPlanDefinition(String(subscription.planKey ?? "") as never)?.includedModules.includes(module));
};
