import { Queue } from "bullmq";
import { serviceUnavailable } from "../core/http-error";
import { redisConnectionOptions } from "../config/redis";

export const NOTIFICATION_QUEUE_NAME = "notifications";
export const LIFECYCLE_QUEUE_NAME = "lifecycle";
export const EXPORT_QUEUE_NAME = "exports";
export const PAYROLL_QUEUE_NAME = "payroll-calculation";

export const SCHEDULED_JOBS = {
  subscriptionRenewalReminders: { schedulerId: "subscription-renewal-reminders-daily", queueName: NOTIFICATION_QUEUE_NAME, jobName: "subscription-renewal-reminders", pattern: "0 * * * *" },
  subscriptionLifecycle: { schedulerId: "subscription-lifecycle-hourly", queueName: LIFECYCLE_QUEUE_NAME, jobName: "subscription-lifecycle", pattern: "0 * * * *" },
  organizationPrivacy: { schedulerId: "organization-privacy-hourly", queueName: EXPORT_QUEUE_NAME, jobName: "organization-privacy", pattern: "15 * * * *" },
  accountingExports: { schedulerId: "accounting-exports-five-minutes", queueName: EXPORT_QUEUE_NAME, jobName: "accounting-exports", pattern: "*/5 * * * *" },
  payrollRecovery: { schedulerId: "payroll-recovery-five-minutes", queueName: PAYROLL_QUEUE_NAME, jobName: "payroll-recovery", pattern: "*/5 * * * *" },
  paystackTransferReconciliation: { schedulerId: "paystack-transfer-reconciliation-five-minutes", queueName: LIFECYCLE_QUEUE_NAME, jobName: "paystack-transfer-reconciliation", pattern: "*/5 * * * *" }
} as const;

export const scheduledQueueNameForJob = (jobName: string): QueueName => {
  const definition = Object.values(SCHEDULED_JOBS).find((candidate) => candidate.jobName === jobName);
  if (!definition) throw new Error(`Unsupported scheduled job: ${jobName}`);
  return definition.queueName;
};

const LEGACY_NOTIFICATION_SCHEDULER_IDS = [
  SCHEDULED_JOBS.subscriptionLifecycle.schedulerId,
  SCHEDULED_JOBS.organizationPrivacy.schedulerId,
  SCHEDULED_JOBS.accountingExports.schedulerId
] as const;
const LEGACY_NOTIFICATION_JOB_NAMES = new Set<string>([
  SCHEDULED_JOBS.subscriptionLifecycle.jobName,
  SCHEDULED_JOBS.organizationPrivacy.jobName,
  SCHEDULED_JOBS.accountingExports.jobName
]);

const removePendingLegacyNotificationJobs = async (queue: Queue) => {
  for (const state of ["wait", "delayed", "prioritized"] as const) {
    let start = 0;
    while (true) {
      const jobs = await queue.getJobs([state], start, start + 99, true);
      if (!jobs.length) break;
      const legacyJobs = jobs.filter((job) => LEGACY_NOTIFICATION_JOB_NAMES.has(job.name));
      await Promise.all(legacyJobs.map((job) => job.remove()));
      if (jobs.length < 100) break;
      if (legacyJobs.length === 0) start += jobs.length;
    }
  }
};

type QueueName = typeof NOTIFICATION_QUEUE_NAME | typeof LIFECYCLE_QUEUE_NAME | typeof EXPORT_QUEUE_NAME | typeof PAYROLL_QUEUE_NAME;

let queues: Queue[] = [];
let queueMap: Partial<Record<QueueName, Queue>> = {};
let queueBackendAvailable = false;

export const setQueueBackendAvailability = (available: boolean) => {
  queueBackendAvailable = available;
};

export const isQueueBackendAvailable = () => queueBackendAvailable;

export const initializeQueues = () => {
  if (queues.length > 0) {
    return queues;
  }

  const notificationQueue = new Queue(NOTIFICATION_QUEUE_NAME, {
    connection: redisConnectionOptions
  });
  const lifecycleQueue = new Queue(LIFECYCLE_QUEUE_NAME, { connection: redisConnectionOptions });
  const exportQueue = new Queue(EXPORT_QUEUE_NAME, { connection: redisConnectionOptions });
  const payrollQueue = new Queue(PAYROLL_QUEUE_NAME, { connection: redisConnectionOptions });
  queues = [notificationQueue, lifecycleQueue, exportQueue, payrollQueue];
  queueMap = {
    [NOTIFICATION_QUEUE_NAME]: notificationQueue,
    [LIFECYCLE_QUEUE_NAME]: lifecycleQueue,
    [EXPORT_QUEUE_NAME]: exportQueue,
    [PAYROLL_QUEUE_NAME]: payrollQueue
  };

  return queues;
};

export const reconcileQueueSchedulers = async () => {
  if (queues.length === 0) initializeQueues();
  const notificationQueue = queueMap[NOTIFICATION_QUEUE_NAME]!;

  // These exact scheduler IDs were historically registered on notifications.
  // Removing them is safe and idempotent; failed job records remain available for diagnosis.
  await Promise.all(LEGACY_NOTIFICATION_SCHEDULER_IDS.map((schedulerId) => notificationQueue.removeJobScheduler(schedulerId)));
  await removePendingLegacyNotificationJobs(notificationQueue);

  const registrations = Object.values(SCHEDULED_JOBS).map((definition) =>
    queueMap[definition.queueName]!.upsertJobScheduler(
      definition.schedulerId,
      { pattern: definition.pattern, tz: "UTC" },
      { name: definition.jobName, data: {} }
    )
  );
  await Promise.all(registrations);
};

export const getQueues = () => queues;

export const getQueueByName = (name: QueueName) => {
  if (!queueBackendAvailable) {
    throw serviceUnavailable("Background job queues are unavailable because Redis is not connected")
  }

  if (queues.length === 0) {
    initializeQueues();
  }

  return queueMap[name]!;
};

export const closeQueues = async () => {
  await Promise.all(queues.map((queue) => queue.close()));
  queues = [];
  queueMap = {};
};
