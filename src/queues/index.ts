import { Queue } from "bullmq";
import { serviceUnavailable } from "../core/http-error";
import { redisConnectionOptions } from "../config/redis";

export const NOTIFICATION_QUEUE_NAME = "notifications";
export const LIFECYCLE_QUEUE_NAME = "lifecycle";
export const EXPORT_QUEUE_NAME = "exports";
export const PAYROLL_QUEUE_NAME = "payroll-calculation";

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
  void notificationQueue.upsertJobScheduler(
    "subscription-renewal-reminders-daily",
    { pattern: "0 * * * *", tz: "UTC" },
    { name: "subscription-renewal-reminders", data: {} }
  ).catch((error) => console.error("[queue:notifications] Could not schedule renewal reminders", error));
  void lifecycleQueue.upsertJobScheduler(
    "subscription-lifecycle-hourly", { pattern: "0 * * * *", tz: "UTC" },
    { name: "subscription-lifecycle", data: {} }
  ).catch((error) => console.error("[queue:notifications] Could not schedule subscription lifecycle", error));
  void exportQueue.upsertJobScheduler(
    "organization-privacy-hourly", { pattern: "15 * * * *", tz: "UTC" },
    { name: "organization-privacy", data: {} }
  ).catch((error) => console.error("[queue:notifications] Could not schedule organization privacy jobs", error));
  void exportQueue.upsertJobScheduler(
    "accounting-exports-five-minutes", { pattern: "*/5 * * * *", tz: "UTC" },
    { name: "accounting-exports", data: {} }
  ).catch((error) => console.error("[queue:notifications] Could not schedule Accounting exports", error));
  void payrollQueue.upsertJobScheduler(
    "payroll-recovery-five-minutes", { pattern: "*/5 * * * *", tz: "UTC" },
    { name: "payroll-recovery", data: {} }
  ).catch((error) => console.error("[queue:payroll] Could not schedule payroll recovery", error));

  queues = [notificationQueue, lifecycleQueue, exportQueue, payrollQueue];
  queueMap = {
    [NOTIFICATION_QUEUE_NAME]: notificationQueue,
    [LIFECYCLE_QUEUE_NAME]: lifecycleQueue,
    [EXPORT_QUEUE_NAME]: exportQueue,
    [PAYROLL_QUEUE_NAME]: payrollQueue
  };

  return queues;
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
