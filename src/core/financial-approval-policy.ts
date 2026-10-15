import type { Prisma } from "@prisma/client";
import { env } from "../config/env";
import { conflict, HttpError } from "./http-error";
import type { AuthUser } from "../types";
import type { PermissionKey } from "../modules/auth/permissions";
import { resolveEffectivePermissions } from "../modules/auth/effective-permissions";
import { getBillingPlanDefinition, type BillingModuleKey } from "../modules/billing/billing.catalog";

export const financialMakerCheckerEnabled = () => env.FINANCIAL_APPROVAL_ENFORCEMENT_MODE === "MAKER_CHECKER";

export const durablePayrollCreatorId = (run: { createdById?: string | null; calculationInput?: Prisma.JsonValue | null }) => {
  if (run.createdById) return run.createdById;
  const input = run.calculationInput;
  return input && typeof input === "object" && !Array.isArray(input) && typeof input.requestedById === "string"
    ? input.requestedById
    : null;
};

export const assertCurrentPermission = (user: AuthUser, permission: PermissionKey) => {
  if (user.organizationId === "" || !user.permissions.includes(permission)) {
    throw new HttpError(403, "Current financial authority is required", { errorCode: "FINANCIAL_EXECUTION_NOT_AUTHORIZED" });
  }
};

const jsonObject = (value: unknown) => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const activeConfig = (value: unknown) => typeof value === "string" ? value.toUpperCase() === "ACTIVE" : String(jsonObject(value).status ?? "").toUpperCase() === "ACTIVE";

export const assertCurrentFinancialAuthority = async (client: Prisma.TransactionClient | import("@prisma/client").PrismaClient, organizationId: string, user: AuthUser, permission: PermissionKey, module: BillingModuleKey) => {
  assertCurrentPermission(user, permission);
  if (!financialMakerCheckerEnabled()) return;
  const [current, organization, configs, testEntitlement] = await Promise.all([
    client.user.findFirst({ where: { id: user.id, organizationId, isActive: true }, select: { moduleAccess: true, role: { select: { name: true, isSystem: true, permissions: { select: { permission: { select: { key: true } } } } } } } }),
    client.organization.findFirst({ where: { id: organizationId, status: "ACTIVE", deletionRequests: { none: { status: "PENDING_PLATFORM_APPROVAL" } } }, select: { id: true } }),
    client.systemConfig.findMany({ where: { organizationId, key: { in: ["billing.subscription", `module.${module}.status`] } }, select: { key: true, value: true } }),
    client.testModuleEntitlement.findFirst({ where: { organizationId, moduleKey: module, active: true, OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] }, select: { id: true } }),
  ]);
  if (!current || !organization) throw new HttpError(403, "Active tenant financial authority is required", { errorCode: "FINANCIAL_EXECUTION_NOT_AUTHORIZED" });
  const permissions = resolveEffectivePermissions({ name: current.role.name, isSystem: current.role.isSystem, permissions: current.role.permissions.map((entry) => entry.permission.key) });
  if (!permissions.includes(permission)) throw new HttpError(403, "Current financial authority is required", { errorCode: "FINANCIAL_EXECUTION_NOT_AUTHORIZED" });
  const moduleAccess = Array.isArray(current.moduleAccess) ? current.moduleAccess.map(String) : null;
  if (moduleAccess && !moduleAccess.some((value) => value.toLowerCase() === module)) throw new HttpError(403, "Financial module access is disabled", { errorCode: "FINANCIAL_EXECUTION_NOT_AUTHORIZED" });
  if (testEntitlement) return;
  const subscription = jsonObject(configs.find((row) => row.key === "billing.subscription")?.value);
  const explicit = configs.find((row) => row.key === `module.${module}.status`);
  const entitled = String(subscription.status ?? "").toUpperCase() === "ACTIVE" && (explicit ? activeConfig(explicit.value) : Boolean(getBillingPlanDefinition(String(subscription.planKey ?? "") as never)?.includedModules.includes(module)));
  if (!entitled) throw new HttpError(403, "Financial module access is disabled", { errorCode: "FINANCIAL_EXECUTION_NOT_AUTHORIZED" });
};

export const assertIndependentFinancialActor = (creatorId: string | null | undefined, actorId: string, action: "DECISION" | "EXECUTION") => {
  if (!financialMakerCheckerEnabled()) return;
  if (!creatorId) {
    throw conflict("A durable transaction creator is required before this action", { errorCode: "FINANCIAL_ACTOR_CONFIGURATION_CONFLICT" });
  }
  if (creatorId === actorId) {
    throw conflict(action === "DECISION" ? "Transaction creators cannot decide their own financial transaction" : "Transaction creators cannot execute their own financial transaction", {
      errorCode: action === "DECISION" ? "FINANCIAL_SELF_APPROVAL_NOT_ALLOWED" : "FINANCIAL_EXECUTION_NOT_AUTHORIZED",
      requiresIndependentApprover: true,
    });
  }
};

export const financialActionEligibility = (input: {
  creatorId?: string | null;
  actorId: string;
  status: string;
  canApprove: boolean;
  canExecute: boolean;
  decisionStatus?: string;
}) => {
  const active = financialMakerCheckerEnabled();
  const missingCreator = active && !input.creatorId;
  const sameActor = active && input.creatorId === input.actorId;
  const pending = input.status === (input.decisionStatus ?? "PENDING_APPROVAL");
  const approved = input.status === "APPROVED";
  const canApprove = pending && input.canApprove && !missingCreator && !sameActor;
  const canReject = canApprove;
  const canInitiatePayment = approved && input.canExecute && !missingCreator && !sameActor;
  const approvalBlockedReason = !active ? null
    : missingCreator ? "CREATOR_IDENTITY_UNAVAILABLE"
      : sameActor ? "INDEPENDENT_APPROVER_REQUIRED"
        : pending && !input.canApprove ? "APPROVAL_PERMISSION_REQUIRED"
          : approved && !input.canExecute ? "PAYMENT_EXECUTION_PERMISSION_REQUIRED"
            : null;
  return { canApprove, canReject, canInitiatePayment, approvalBlockedReason, requiresIndependentApprover: active };
};
