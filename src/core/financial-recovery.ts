import type { SettlementProvider } from "./settlement-provider";
import { env } from "../config/env";
import { prisma } from "./prisma";
import { PaystackTransferProvider } from "./paystack-transfer-provider";
import { reconcileStaleProviderSettlements } from "./provider-settlement";
import { retryPendingPaystackTransferWebhooks } from "./paystack-transfer-webhook";
import { reconcileStaleSubscriptionPayments } from "../modules/admin/admin.service";
import { reconcileStaleWalletFundingAttempts, retryPendingPaystackInboundWebhooks } from "../modules/accounting/accounting.service";

export type FinancialRecoveryTrigger = "VERCEL_CRON" | "BULLMQ" | "TEST";

export const runFinancialRecovery = async (input: { trigger: FinancialRecoveryTrigger; provider?: SettlementProvider }) => {
  const startedAt = new Date();
  const staleRunCutoff = new Date(startedAt.getTime() - Math.max(env.FINANCIAL_RECONCILIATION_LEASE_MS, env.FINANCIAL_WEBHOOK_PROCESSING_LEASE_MS) * 2);
  await prisma.financialReconciliationRun.updateMany({
    where: { status: "RUNNING", heartbeatAt: { lt: staleRunCutoff } },
    data: { status: "FAILED", completedAt: startedAt, failureReason: "Recovery process ended without completing its durable run record" },
  });
  const run = await prisma.financialReconciliationRun.create({
    data: { trigger: input.trigger, applicationVersion: env.APPLICATION_VERSION ?? process.env.VERCEL_GIT_COMMIT_SHA ?? null },
  });
  const provider = input.provider ?? new PaystackTransferProvider();
  try {
    const settlements = await reconcileStaleProviderSettlements(provider);
    await prisma.financialReconciliationRun.update({ where: { id: run.id }, data: { heartbeatAt: new Date(), settlementsScanned: settlements.inspected, settlementsClaimed: settlements.claimed, settlementsReconciled: settlements.reconciled, settlementsUnresolved: settlements.unresolved, errors: settlements.errors } });
    const webhooks = await retryPendingPaystackTransferWebhooks();
    await prisma.financialReconciliationRun.update({ where: { id: run.id }, data: { heartbeatAt: new Date(), webhookEventsScanned: webhooks.inspected, webhookEventsClaimed: webhooks.claimed, webhookEventsProcessed: webhooks.processed, webhookEventsDeadLettered: webhooks.deadLettered, errors: settlements.errors + webhooks.errors } });
    const subscriptions = await reconcileStaleSubscriptionPayments();
    await prisma.financialReconciliationRun.update({ where: { id: run.id }, data: { heartbeatAt: new Date(), subscriptionAttemptsScanned: subscriptions.inspected, subscriptionAttemptsClaimed: subscriptions.claimed, subscriptionAttemptsReconciled: subscriptions.reconciled, subscriptionAttemptsUnresolved: subscriptions.unresolved } });
    const funding = await reconcileStaleWalletFundingAttempts();
    await prisma.financialReconciliationRun.update({ where: { id: run.id }, data: { heartbeatAt: new Date(), walletFundingAttemptsScanned: funding.inspected, walletFundingAttemptsClaimed: funding.claimed, walletFundingAttemptsReconciled: funding.reconciled, walletFundingAttemptsUnresolved: funding.unresolved } });
    const inboundWebhooks = await retryPendingPaystackInboundWebhooks();
    const errors = settlements.errors + webhooks.errors + subscriptions.errors + funding.errors + inboundWebhooks.errors;
    const status = errors ? "PARTIAL" : "COMPLETED";
    return await prisma.financialReconciliationRun.update({
      where: { id: run.id },
      data: { status, heartbeatAt: new Date(), completedAt: new Date(), inboundWebhookEventsProcessed: inboundWebhooks.processed, inboundWebhookEventsDeadLettered: inboundWebhooks.deadLettered, errors },
    });
  } catch (error) {
    await prisma.financialReconciliationRun.update({ where: { id: run.id }, data: { status: "FAILED", heartbeatAt: new Date(), completedAt: new Date(), errors: { increment: 1 }, failureReason: (error instanceof Error ? error.message : "Financial recovery failed").slice(0, 2000) } });
    throw error;
  }
};

export const getFinancialRecoveryLiveness = async () => {
  const [lastStarted, lastSuccessful, lastFailed] = await Promise.all([
    prisma.financialReconciliationRun.findFirst({ orderBy: { startedAt: "desc" } }),
    prisma.financialReconciliationRun.findFirst({ where: { status: { in: ["COMPLETED", "PARTIAL"] } }, orderBy: { completedAt: "desc" } }),
    prisma.financialReconciliationRun.findFirst({ where: { status: "FAILED" }, orderBy: { completedAt: "desc" } }),
  ]);
  return { lastStarted, lastSuccessful, lastFailed };
};
