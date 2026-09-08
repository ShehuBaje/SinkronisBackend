import { Worker } from "bullmq";
import { redisConnectionOptions } from "../config/redis";
import { processMyPlanLifecycle, processMyPlanRenewalNotifications } from "../modules/admin/admin.service";
import { NOTIFICATION_QUEUE_NAME } from "./index";
import { expireOrganizationExports, processPendingOrganizationExports } from "../modules/admin/organization-privacy.service";
import { expireAccountingExports, processPendingAccountingExports } from "../modules/accounting/accounting.service";

let workers: Worker[] = [];

export const initializeWorkers = () => {
  if (workers.length > 0) {
    return workers;
  }

  const notificationWorker = new Worker(
    NOTIFICATION_QUEUE_NAME,
    async (job) => {
      if (job.name === "subscription-renewal-reminders") return processMyPlanRenewalNotifications(new Date(), ["EMAIL", "IN_APP"]);
      if (job.name === "subscription-lifecycle") return processMyPlanLifecycle();
      if (job.name === "organization-privacy") return { fulfilled: await processPendingOrganizationExports(), expired: await expireOrganizationExports() };
      if (job.name === "accounting-exports") return { fulfilled: await processPendingAccountingExports(), expired: await expireAccountingExports() };
      throw new Error(`Unsupported notification job: ${job.name}`);
    },
    { connection: redisConnectionOptions, concurrency: 1 }
  );

  notificationWorker.on("failed", (job, error) => console.error(`[queue:notifications] Failed job ${job?.id ?? "unknown"}`, error));
  workers = [notificationWorker];
  return workers;
};

export const closeWorkers = async () => {
  await Promise.all(workers.map((worker) => worker.close()));
  workers = [];
};
