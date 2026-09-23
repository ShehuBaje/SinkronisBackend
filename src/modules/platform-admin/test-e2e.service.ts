import crypto from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "../../core/prisma";
import { conflict, forbidden, notFound } from "../../core/http-error";
import type { AuthUser } from "../../types";
import { createAuditLog } from "../admin/admin.audit";
import { isOrganizationModuleEnabled } from "../billing/module-access.service";

const assertPlatformAdmin = (user: AuthUser) => {
  if (!user.isPlatformAdmin) throw forbidden("Platform Admin access is required");
};

export const classifyTestTenant = async (tenantId: string, input: { classification: "CUSTOMER" | "TEST_E2E" | "DEMO"; reason: string }, user: AuthUser) => {
  assertPlatformAdmin(user);
  const current = await prisma.organization.findFirst({ where: { id: tenantId, status: "ACTIVE", users: { none: { isPlatformAdmin: true } } }, select: { id: true, classification: true } });
  if (!current) throw notFound("Active tenant not found");
  if (current.classification === input.classification) return { organizationId: tenantId, classification: current.classification, idempotentReplay: true };
  const updated = await prisma.$transaction(async (tx) => {
    const row = await tx.organization.update({ where: { id: tenantId }, data: { classification: input.classification }, select: { id: true, classification: true, updatedAt: true } });
    if (input.classification !== "TEST_E2E") await tx.testModuleEntitlement.updateMany({ where: { organizationId: tenantId, active: true }, data: { active: false, revokedAt: new Date(), revokedByUserId: user.id, revocationReason: `Tenant classification changed: ${input.reason}` } });
    return row;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
  await createAuditLog({ organizationId: tenantId, actorUserId: user.id, action: "PLATFORM_TENANT_CLASSIFICATION_CHANGED", resource: "ORGANIZATION", resourceId: tenantId, summary: `Changed tenant classification from ${current.classification} to ${updated.classification}`, metadata: { previousClassification: current.classification, newClassification: updated.classification, reason: input.reason } });
  return { organizationId: tenantId, classification: updated.classification, idempotentReplay: false, updatedAt: updated.updatedAt };
};

export const setTestTenantEntitlement = async (tenantId: string, moduleKey: "hris" | "payroll" | "accounting", input: { active: boolean; reason: string; expiresAt?: Date }, user: AuthUser) => {
  assertPlatformAdmin(user);
  const tenant = await prisma.organization.findFirst({ where: { id: tenantId, status: "ACTIVE" }, select: { id: true, classification: true } });
  if (!tenant) throw notFound("Active tenant not found");
  if (tenant.classification !== "TEST_E2E") throw conflict("TEST_E2E entitlement requires a TEST_E2E tenant", { errorCode: "TEST_TENANT_REQUIRED" });
  const now = new Date();
  const entitlement = await prisma.testModuleEntitlement.upsert({
    where: { organizationId_moduleKey: { organizationId: tenantId, moduleKey } },
    create: { organizationId: tenantId, moduleKey, active: input.active, reason: input.reason, grantedByUserId: user.id, grantedAt: now, expiresAt: input.expiresAt, ...(!input.active ? { revokedByUserId: user.id, revokedAt: now, revocationReason: input.reason } : {}) },
    update: input.active
      ? { active: true, reason: input.reason, grantedByUserId: user.id, grantedAt: now, expiresAt: input.expiresAt ?? null, revokedByUserId: null, revokedAt: null, revocationReason: null }
      : { active: false, revokedByUserId: user.id, revokedAt: now, revocationReason: input.reason }
  });
  await createAuditLog({ organizationId: tenantId, actorUserId: user.id, action: input.active ? "PLATFORM_TEST_ENTITLEMENT_GRANTED" : "PLATFORM_TEST_ENTITLEMENT_REVOKED", resource: "TEST_MODULE_ENTITLEMENT", resourceId: entitlement.id, summary: `${input.active ? "Granted" : "Revoked"} TEST_E2E ${moduleKey} access`, metadata: { moduleKey, reason: input.reason, expiresAt: entitlement.expiresAt?.toISOString() ?? null } });
  return entitlement;
};

export const creditTestTenantWallet = async (tenantId: string, input: { walletAccountId: string; amount: string; reference: string; reason: string }, user: AuthUser) => {
  assertPlatformAdmin(user);
  const value = new Prisma.Decimal(input.amount);
  const existing = await prisma.walletTransaction.findFirst({ where: { organizationId: tenantId, transferReference: input.reference } });
  if (existing) {
    if (existing.walletAccountId !== input.walletAccountId || existing.type !== "TEST_E2E_CREDIT" || !existing.amount.equals(value)) throw conflict("Test credit reference is already in use");
    return { transaction: existing, idempotentReplay: true };
  }
  const tenant = await prisma.organization.findFirst({ where: { id: tenantId, status: "ACTIVE", classification: "TEST_E2E" }, select: { id: true } });
  if (!tenant) throw conflict("Test credit requires an active TEST_E2E tenant", { errorCode: "TEST_TENANT_REQUIRED" });
  if (!await isOrganizationModuleEnabled(tenantId, "accounting")) throw conflict("Accounting TEST_E2E entitlement is required", { errorCode: "TEST_ACCOUNTING_ENTITLEMENT_REQUIRED" });
  let transaction;
  try {
    transaction = await prisma.$transaction(async (tx) => {
      const wallet = await tx.walletAccount.findFirst({ where: { id: input.walletAccountId, organizationId: tenantId } });
      if (!wallet) throw notFound("Tenant wallet not found");
      const updated = await tx.walletAccount.update({ where: { id: wallet.id }, data: { balance: { increment: value } } });
      const transaction = await tx.walletTransaction.create({ data: { organizationId: tenantId, walletAccountId: wallet.id, type: "TEST_E2E_CREDIT", direction: "CREDIT", amount: value, balanceBefore: wallet.balance, balanceAfter: updated.balance, reference: `TE2E-${crypto.randomUUID()}`, transferReference: input.reference, description: `NON-REAL TEST VALUE: ${input.reason}`, sourceType: "TEST_E2E_CREDIT", sourceId: input.reference, createdById: user.id } });
      await createAuditLog({ organizationId: tenantId, actorUserId: user.id, action: "PLATFORM_TEST_WALLET_CREDITED", resource: "WALLET_TRANSACTION", resourceId: transaction.id, summary: "Credited non-real TEST_E2E wallet value", metadata: { walletAccountId: input.walletAccountId, amount: input.amount, reference: input.reference, reason: input.reason, valueClassification: "NON_REAL_TEST_VALUE" } }, tx);
      return transaction;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const replay = await prisma.walletTransaction.findFirst({ where: { organizationId: tenantId, transferReference: input.reference } });
      if (replay && replay.walletAccountId === input.walletAccountId && replay.type === "TEST_E2E_CREDIT" && replay.amount.equals(value)) return { transaction: replay, idempotentReplay: true };
      throw conflict("Test credit reference is already in use");
    }
    throw error;
  }
  return { transaction, idempotentReplay: false };
};
