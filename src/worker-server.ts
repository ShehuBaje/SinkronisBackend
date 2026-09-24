import { env } from "./config/env";
import { connectRedis, redis } from "./config/redis";
import { prisma } from "./core/prisma";
import { closeQueues, initializeQueues, reconcileQueueSchedulers, setQueueBackendAvailability } from "./queues";
import { closeWorkers, initializeWorkers } from "./queues/workers";

if (env.DEPLOYMENT_RUNTIME !== "persistent-worker" || env.BACKGROUND_JOBS_MODE !== "queue") {
  throw new Error("The worker process requires DEPLOYMENT_RUNTIME=persistent-worker and BACKGROUND_JOBS_MODE=queue");
}

let closing = false;

const shutdown = async (signal: string) => {
  if (closing) return;
  closing = true;
  console.log(`Worker shutdown requested (${signal})`);
  setQueueBackendAvailability(false);
  await closeWorkers();
  await closeQueues();
  redis.disconnect();
  await prisma.$disconnect();
};

const start = async () => {
  await connectRedis();
  initializeQueues();
  await reconcileQueueSchedulers();
  initializeWorkers();
  setQueueBackendAvailability(true);
  console.log("Persistent background workers started");
};

process.once("SIGINT", () => void shutdown("SIGINT").finally(() => process.exit(0)));
process.once("SIGTERM", () => void shutdown("SIGTERM").finally(() => process.exit(0)));

void start().catch(async (error) => {
  console.error("Persistent worker startup failed", error instanceof Error ? error.message : "Unknown error");
  await shutdown("startup-failure");
  process.exit(1);
});
