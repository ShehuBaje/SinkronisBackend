import crypto from "node:crypto";
import { Router } from "express";
import { env } from "../../config/env";
import { asyncHandler } from "../../core/async-handler";
import { unauthorized } from "../../core/http-error";
import { processMyPlanLifecycle, processMyPlanRenewalNotifications } from "../admin/admin.service";
import { snapshotTenantModuleUsage } from "../telemetry/telemetry.service";
import { expireOrganizationExports, processPendingOrganizationExports } from "../admin/organization-privacy.service";
import { runFinancialRecovery } from "../../core/financial-recovery";

export const internalRouter = Router();

internalRouter.use((req, _res, next) => {
  const expected = `Bearer ${env.CRON_SECRET ?? ""}`;
  const received = req.header("authorization") ?? "";
  const valid =
    expected.length > "Bearer ".length &&
    received.length === expected.length &&
    crypto.timingSafeEqual(Buffer.from(received), Buffer.from(expected));
  if (!valid) return next(unauthorized("Invalid cron authorization"));
  return next();
});

const runSubscriptionMaintenance = asyncHandler(async (_req, res) => {
    const lifecycle = await processMyPlanLifecycle();
    const notifications = await processMyPlanRenewalNotifications(new Date(), ["EMAIL", "IN_APP"]);
    const moduleUsageSnapshot = await snapshotTenantModuleUsage();
    const organizationExports = await processPendingOrganizationExports();
    const expiredOrganizationExports = await expireOrganizationExports();
    res.json({
      success: true,
      message: "Subscription lifecycle and renewal notifications processed",
      data: { lifecycle, notifications, moduleUsageSnapshot, organizationExports, expiredOrganizationExports, processedAt: new Date().toISOString() }
    });
  });

// Keep POST for existing operators while supporting Vercel Cron's GET invocation.
internalRouter.get("/cron/subscriptions", runSubscriptionMaintenance);
internalRouter.post("/cron/subscriptions", runSubscriptionMaintenance);

internalRouter.get(
  "/cron/financial-recovery",
  asyncHandler(async (_req, res) => {
    const run = await runFinancialRecovery({ trigger: "VERCEL_CRON" });
    res.json({
      success: true,
      message: "Bounded financial recovery completed",
      data: {
        runId: run.id,
        status: run.status,
        startedAt: run.startedAt,
        completedAt: run.completedAt,
        settlements: { scanned: run.settlementsScanned, claimed: run.settlementsClaimed, reconciled: run.settlementsReconciled, unresolved: run.settlementsUnresolved },
        webhooks: { scanned: run.webhookEventsScanned, claimed: run.webhookEventsClaimed, processed: run.webhookEventsProcessed, deadLettered: run.webhookEventsDeadLettered },
        subscriptions: { scanned: run.subscriptionAttemptsScanned, claimed: run.subscriptionAttemptsClaimed, reconciled: run.subscriptionAttemptsReconciled, unresolved: run.subscriptionAttemptsUnresolved },
        walletFunding: { scanned: run.walletFundingAttemptsScanned, claimed: run.walletFundingAttemptsClaimed, reconciled: run.walletFundingAttemptsReconciled, unresolved: run.walletFundingAttemptsUnresolved },
        inboundWebhooks: { processed: run.inboundWebhookEventsProcessed, deadLettered: run.inboundWebhookEventsDeadLettered },
        errors: run.errors,
      },
    });
  }),
);
