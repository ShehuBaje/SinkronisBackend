import { Queue } from "bullmq";
import { serviceUnavailable } from "../core/http-error";
import { redisConnectionOptions } from "../config/redis";

export const NOTIFICATION_QUEUE_NAME = "notifications";

type QueueName = typeof NOTIFICATION_QUEUE_NAME;

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
  void notificationQueue.upsertJobScheduler(
    "subscription-renewal-reminders-daily",
    { pattern: "0 * * * *", tz: "UTC" },
    { name: "subscription-renewal-reminders", data: {} }
  ).catch((error) => console.error("[queue:notifications] Could not schedule renewal reminders", error));
  void notificationQueue.upsertJobScheduler(
    "subscription-lifecycle-hourly", { pattern: "0 * * * *", tz: "UTC" },
    { name: "subscription-lifecycle", data: {} }
  ).catch((error) => console.error("[queue:notifications] Could not schedule subscription lifecycle", error));
  void notificationQueue.upsertJobScheduler(
    "organization-privacy-hourly", { pattern: "15 * * * *", tz: "UTC" },
    { name: "organization-privacy", data: {} }
  ).catch((error) => console.error("[queue:notifications] Could not schedule organization privacy jobs", error));
  void notificationQueue.upsertJobScheduler(
    "accounting-exports-five-minutes", { pattern: "*/5 * * * *", tz: "UTC" },
    { name: "accounting-exports", data: {} }
  ).catch((error) => console.error("[queue:notifications] Could not schedule Accounting exports", error));

  queues = [notificationQueue];
  queueMap = {
    [NOTIFICATION_QUEUE_NAME]: notificationQueue
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
