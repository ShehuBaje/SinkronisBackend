import crypto from "node:crypto";
import { Router } from "express";
import { env } from "../../config/env";
import { asyncHandler } from "../../core/async-handler";
import { unauthorized } from "../../core/http-error";
import { processMyPlanLifecycle, processMyPlanRenewalNotifications } from "../admin/admin.service";
import { snapshotTenantModuleUsage } from "../telemetry/telemetry.service";

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

internalRouter.get(
  "/cron/subscriptions",
  asyncHandler(async (_req, res) => {
    const lifecycle = await processMyPlanLifecycle();
    const notifications = await processMyPlanRenewalNotifications(new Date(), ["EMAIL", "IN_APP"]);
    const moduleUsageSnapshot = await snapshotTenantModuleUsage();
    res.json({
      success: true,
      message: "Subscription lifecycle and renewal notifications processed",
      data: { lifecycle, notifications, moduleUsageSnapshot, processedAt: new Date().toISOString() }
    });
  })
);
