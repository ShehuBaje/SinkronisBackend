import { Worker } from "bullmq";
import { redisConnectionOptions } from "../config/redis";
import { processMyPlanLifecycle, processMyPlanRenewalNotifications } from "../modules/admin/admin.service";
import { EXPORT_QUEUE_NAME, LIFECYCLE_QUEUE_NAME, NOTIFICATION_QUEUE_NAME, PAYROLL_QUEUE_NAME, SCHEDULED_JOBS } from "./index";
import { expireOrganizationExports, processPendingOrganizationExports } from "../modules/admin/organization-privacy.service";
import { expireAccountingExports, processPendingAccountingExports } from "../modules/accounting/accounting.service";
import { deliverQueuedNotificationEmail } from "../core/notifications";
import { failPayRunBatch, initializePayRunCalculation, processPayRunBatch, reconcileProcessingPayRuns } from "../modules/payroll/payroll.service";
import { reconcileStaleProviderSettlements } from "../core/provider-settlement";
import { retryPendingPaystackTransferWebhooks } from "../core/paystack-transfer-webhook";

let workers: Worker[] = [];

export const initializeWorkers = () => {
  if (workers.length > 0) {
    return workers;
  }

  const notificationWorker = new Worker(
    NOTIFICATION_QUEUE_NAME,
    async (job) => {
      if (job.name === "deliver-notification-email") return deliverQueuedNotificationEmail(String(job.data.notificationId));
      if (job.name === SCHEDULED_JOBS.subscriptionRenewalReminders.jobName) return processMyPlanRenewalNotifications(new Date(), ["EMAIL", "IN_APP"]);
      throw new Error(`Unsupported notification job: ${job.name}`);
    },
    { connection: redisConnectionOptions, concurrency: 1 }
  );

  notificationWorker.on("failed", (job, error) => console.error(`[queue:notifications] Failed job ${job?.id ?? "unknown"}`, error));
  const lifecycleWorker = new Worker(LIFECYCLE_QUEUE_NAME, async (job) => {
    if (job.name === SCHEDULED_JOBS.subscriptionLifecycle.jobName) return processMyPlanLifecycle();
    if (job.name === SCHEDULED_JOBS.paystackTransferReconciliation.jobName) return { settlements: await reconcileStaleProviderSettlements(), webhooks: await retryPendingPaystackTransferWebhooks() };
    throw new Error(`Unsupported lifecycle job: ${job.name}`);
  }, { connection: redisConnectionOptions, concurrency: 1 });
  const exportWorker = new Worker(EXPORT_QUEUE_NAME, async (job) => {
    if (job.name === SCHEDULED_JOBS.organizationPrivacy.jobName) return { fulfilled: await processPendingOrganizationExports(), expired: await expireOrganizationExports() };
    if (job.name === SCHEDULED_JOBS.accountingExports.jobName) return { fulfilled: await processPendingAccountingExports(), expired: await expireAccountingExports() };
    throw new Error(`Unsupported export job: ${job.name}`);
  }, { connection: redisConnectionOptions, concurrency: 2 });
  const payrollWorker = new Worker(PAYROLL_QUEUE_NAME, async (job) => {
    if (job.name === "initialize-pay-run") return initializePayRunCalculation(String(job.data.payrollRunId));
    if (job.name === "calculate-payroll-batch") return processPayRunBatch(String(job.data.batchId));
    if (job.name === SCHEDULED_JOBS.payrollRecovery.jobName) return reconcileProcessingPayRuns();
    throw new Error(`Unsupported payroll job: ${job.name}`);
  }, { connection: redisConnectionOptions, concurrency: 4, lockDuration: 120_000 });
  payrollWorker.on("failed", (job, error) => { if (job?.name === "calculate-payroll-batch" && job.attemptsMade >= (job.opts.attempts ?? 1)) void failPayRunBatch(String(job.data.batchId), error); console.error(`[queue:payroll] Failed job ${job?.id ?? "unknown"}`, error); });
  for (const worker of [lifecycleWorker, exportWorker]) worker.on("failed", (job, error) => console.error(`[queue:${worker.name}] Failed job ${job?.id ?? "unknown"}`, error));
  workers = [notificationWorker, lifecycleWorker, exportWorker, payrollWorker];
  return workers;
};

export const closeWorkers = async () => {
  await Promise.all(workers.map((worker) => worker.close()));
  workers = [];
};
