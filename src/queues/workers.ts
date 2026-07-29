import { Worker } from "bullmq";
import { redisConnectionOptions } from "../config/redis";
import { generatePayslips } from "../modules/payroll/payroll.service";
import { processMyPlanLifecycle, processMyPlanRenewalNotifications } from "../modules/admin/admin.service";
import { NOTIFICATION_QUEUE_NAME, PAYROLL_QUEUE_NAME } from "./index";

export const PAYROLL_GENERATE_PAYSLIPS_JOB = "generate-payslips";

type PayrollGeneratePayslipsJobData = {
  organizationId: string;
  payrollRunId: string;
  requestedByUserId?: string;
};

let workers: Worker[] = [];

export const initializeWorkers = () => {
  if (workers.length > 0) {
    return workers;
  }

  const payrollWorker = new Worker(
    PAYROLL_QUEUE_NAME,
    async (job) => {
      if (job.name !== PAYROLL_GENERATE_PAYSLIPS_JOB) {
        throw new Error(`Unsupported payroll job: ${job.name}`);
      }

      const data = job.data as PayrollGeneratePayslipsJobData;
      const result = await generatePayslips(data.organizationId, data.payrollRunId);

      return {
        payrollRunId: data.payrollRunId,
        generatedCount: result.count
      };
    },
    {
      connection: redisConnectionOptions,
      concurrency: 2
    }
  );

  const notificationWorker = new Worker(
    NOTIFICATION_QUEUE_NAME,
    async (job) => {
      if (job.name === "subscription-renewal-reminders") return processMyPlanRenewalNotifications(new Date(), ["EMAIL", "IN_APP"]);
      if (job.name === "subscription-lifecycle") return processMyPlanLifecycle();
      throw new Error(`Unsupported notification job: ${job.name}`);
    },
    { connection: redisConnectionOptions, concurrency: 1 }
  );

  payrollWorker.on("completed", (job) => {
    console.log(`[queue:payroll] Completed job ${job.id}`);
  });

  payrollWorker.on("failed", (job, error) => {
    console.error(`[queue:payroll] Failed job ${job?.id ?? "unknown"}`);
    console.error(error instanceof Error ? error.message : error);
  });

  notificationWorker.on("failed", (job, error) => console.error(`[queue:notifications] Failed job ${job?.id ?? "unknown"}`, error));
  workers = [payrollWorker, notificationWorker];
  return workers;
};

export const closeWorkers = async () => {
  await Promise.all(workers.map((worker) => worker.close()));
  workers = [];
};
