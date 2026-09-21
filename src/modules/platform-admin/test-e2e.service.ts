import crypto from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "../../core/prisma";
import { conflict, forbidden, notFound } from "../../core/http-error";
import type { AuthUser } from "../../types";
import { createAuditLog } from "../admin/admin.audit";
import { isOrganizationModuleEnabled } from "../billing/module-access.service";
import { env } from "../../config/env";
import { PaystackTransferProvider } from "../../core/paystack-transfer-provider";
import { assertPaystackTransferCredentialMode } from "../../core/settlement-provider";

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
      return tx.walletTransaction.create({ data: { organizationId: tenantId, walletAccountId: wallet.id, type: "TEST_E2E_CREDIT", direction: "CREDIT", amount: value, balanceBefore: wallet.balance, balanceAfter: updated.balance, reference: `TE2E-${crypto.randomUUID()}`, transferReference: input.reference, description: `NON-REAL TEST VALUE: ${input.reason}`, sourceType: "TEST_E2E_CREDIT", sourceId: input.reference, createdById: user.id } });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const replay = await prisma.walletTransaction.findFirst({ where: { organizationId: tenantId, transferReference: input.reference } });
      if (replay && replay.walletAccountId === input.walletAccountId && replay.type === "TEST_E2E_CREDIT" && replay.amount.equals(value)) return { transaction: replay, idempotentReplay: true };
      throw conflict("Test credit reference is already in use");
    }
    throw error;
  }
  await createAuditLog({ organizationId: tenantId, actorUserId: user.id, action: "PLATFORM_TEST_WALLET_CREDITED", resource: "WALLET_TRANSACTION", resourceId: transaction.id, summary: "Credited non-real TEST_E2E wallet value", metadata: { walletAccountId: input.walletAccountId, amount: input.amount, reference: input.reference, reason: input.reason, valueClassification: "NON_REAL_TEST_VALUE" } });
  return { transaction, idempotentReplay: false };
};

const diagnosticTenantId = "cmt3z13pp00013qmx28aeatfx";
const diagnosticWalletId = "cmubf9qr6000ac7sl3bcgaft8";

export const resolveTemporaryPaystackTestAccount = async (user: AuthUser) => {
  assertPlatformAdmin(user);
  if (env.PAYSTACK_TRANSFERS_ENABLED) throw conflict("Diagnostic requires outbound transfers to remain disabled", { errorCode: "TRANSFERS_MUST_REMAIN_DISABLED" });
  if (env.PAYSTACK_TRANSFERS_MODE !== "test") throw conflict("Diagnostic requires explicit Paystack test mode", { errorCode: "PAYSTACK_TEST_MODE_REQUIRED" });
  assertPaystackTransferCredentialMode(env.PAYSTACK_TRANSFERS_MODE, env.PAYSTACK_SECRET_KEY);
  const [tenant, wallet, paymentRequests, settlements, recipients, transactions] = await Promise.all([
    prisma.organization.findUnique({ where: { id: diagnosticTenantId }, select: { classification: true } }),
    prisma.walletAccount.findFirst({ where: { id: diagnosticWalletId, organizationId: diagnosticTenantId }, select: { balance: true, reservedBalance: true } }),
    prisma.paymentRequest.count({ where: { organizationId: diagnosticTenantId } }),
    prisma.financialSettlement.count({ where: { organizationId: diagnosticTenantId } }),
    prisma.providerTransferRecipient.count({ where: { organizationId: diagnosticTenantId } }),
    prisma.walletTransaction.count({ where: { organizationId: diagnosticTenantId } }),
  ]);
  if (tenant?.classification !== "TEST_E2E" || !wallet?.balance.isZero() || !wallet.reservedBalance.isZero() || paymentRequests || settlements || recipients || transactions) {
    throw conflict("Controlled TEST_E2E financial baseline is not pristine", { errorCode: "TEST_E2E_BASELINE_MISMATCH" });
  }
  try {
    const resolved = await new PaystackTransferProvider().resolveAccount({ bankCode: "057", accountNumber: "0000000000" });
    if (resolved.accountNumber !== "0000000000") throw conflict("Paystack returned an unexpected test destination", { errorCode: "TEST_DESTINATION_MISMATCH" });
    await createAuditLog({ organizationId: diagnosticTenantId, actorUserId: user.id, action: "PLATFORM_PAYSTACK_TEST_ACCOUNT_RESOLVED", resource: "PROVIDER_DIAGNOSTIC", resourceId: diagnosticTenantId, summary: "Resolved the documented Paystack TEST transfer account", metadata: { provider: "PAYSTACK", mode: "test", bankCode: "057", bankName: "Zenith Bank", maskedAccountNumber: "******0000", outcome: "SUCCESS" } });
    return { provider: "PAYSTACK", mode: "test", bankCode: "057", bankName: "Zenith Bank", accountNumber: "******0000", accountName: resolved.accountName, ...(resolved.bankId !== undefined ? { bankId: resolved.bankId } : {}) };
  } catch (error) {
    await createAuditLog({ organizationId: diagnosticTenantId, actorUserId: user.id, action: "PLATFORM_PAYSTACK_TEST_ACCOUNT_RESOLUTION_FAILED", resource: "PROVIDER_DIAGNOSTIC", resourceId: diagnosticTenantId, summary: "Paystack TEST account-resolution diagnostic failed", metadata: { provider: "PAYSTACK", mode: "test", bankCode: "057", bankName: "Zenith Bank", maskedAccountNumber: "******0000", outcome: "FAILED" } });
    throw error;
  }
};
