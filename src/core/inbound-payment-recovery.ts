import crypto from "node:crypto";
import { env } from "../config/env";
import { prisma } from "./prisma";

export const inboundRecoveryDelayMs = (attempt: number) => Math.min(6 * 60 * 60_000, 60_000 * (2 ** Math.max(0, attempt - 1)));

const lease = (now: Date) => new Date(now.getTime() + env.FINANCIAL_RECONCILIATION_LEASE_MS);

export const claimSubscriptionPaymentRecovery = async (id: string, now = new Date(), claimToken: string = crypto.randomUUID()) => {
  const leaseExpiresAt = lease(now);
  return prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<Array<{ status: string; provider: string; reconciliationDeadLetteredAt: Date | null; nextReconciliationAt: Date | null; reconciliationLeaseExpiresAt: Date | null }>>`SELECT status, provider, reconciliationDeadLetteredAt, nextReconciliationAt, reconciliationLeaseExpiresAt FROM SubscriptionPaymentAttempt WHERE id = ${id} FOR UPDATE`;
    const row = rows[0];
    if (!row || row.provider !== "PAYSTACK" || !["INITIALIZING", "INITIALIZED", "UNKNOWN"].includes(row.status) || row.reconciliationDeadLetteredAt || (row.nextReconciliationAt && row.nextReconciliationAt > now) || (row.reconciliationLeaseExpiresAt && row.reconciliationLeaseExpiresAt > now)) return null;
    await tx.subscriptionPaymentAttempt.update({ where: { id }, data: { reconciliationClaimToken: claimToken, reconciliationClaimedAt: now, reconciliationLeaseExpiresAt: leaseExpiresAt, reconciliationAttempts: { increment: 1 }, lastReconciliationError: null } });
    return { claimToken, leaseExpiresAt };
  }, { isolationLevel: "RepeatableRead", maxWait: 20_000, timeout: 20_000 });
};

export const claimWalletFundingRecovery = async (id: string, now = new Date(), claimToken: string = crypto.randomUUID()) => {
  const leaseExpiresAt = lease(now);
  return prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<Array<{ status: string; provider: string; reconciliationDeadLetteredAt: Date | null; nextReconciliationAt: Date | null; reconciliationLeaseExpiresAt: Date | null }>>`SELECT status, provider, reconciliationDeadLetteredAt, nextReconciliationAt, reconciliationLeaseExpiresAt FROM WalletFundingAttempt WHERE id = ${id} FOR UPDATE`;
    const row = rows[0];
    if (!row || row.provider !== "PAYSTACK" || !["PENDING", "INITIALIZING", "INITIALIZED", "UNKNOWN", "PROCESSING"].includes(row.status) || row.reconciliationDeadLetteredAt || (row.nextReconciliationAt && row.nextReconciliationAt > now) || (row.reconciliationLeaseExpiresAt && row.reconciliationLeaseExpiresAt > now)) return null;
    await tx.walletFundingAttempt.update({ where: { id }, data: { reconciliationClaimToken: claimToken, reconciliationClaimedAt: now, reconciliationLeaseExpiresAt: leaseExpiresAt, reconciliationAttempts: { increment: 1 }, lastReconciliationError: null } });
    return { claimToken, leaseExpiresAt };
  }, { isolationLevel: "RepeatableRead", maxWait: 20_000, timeout: 20_000 });
};

export const releaseSubscriptionPaymentRecovery = (id: string, claimToken: string, data: { error?: string; nextAttemptAt?: Date; deadLetteredAt?: Date } = {}) => prisma.subscriptionPaymentAttempt.updateMany({
  where: { id, reconciliationClaimToken: claimToken },
  data: { reconciliationClaimToken: null, reconciliationClaimedAt: null, reconciliationLeaseExpiresAt: null, lastReconciliationError: data.error?.slice(0, 2000) ?? null, nextReconciliationAt: data.nextAttemptAt ?? null, reconciliationDeadLetteredAt: data.deadLetteredAt ?? null },
});

export const releaseWalletFundingRecovery = (id: string, claimToken: string, data: { error?: string; nextAttemptAt?: Date; deadLetteredAt?: Date } = {}) => prisma.walletFundingAttempt.updateMany({
  where: { id, reconciliationClaimToken: claimToken },
  data: { reconciliationClaimToken: null, reconciliationClaimedAt: null, reconciliationLeaseExpiresAt: null, lastReconciliationError: data.error?.slice(0, 2000) ?? null, nextReconciliationAt: data.nextAttemptAt ?? null, reconciliationDeadLetteredAt: data.deadLetteredAt ?? null },
});
