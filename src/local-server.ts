import { env } from "./config/env";
import { prisma } from "./core/prisma";
import { app } from "./app";
import { connectRedis, redis } from "./config/redis";
import { closeQueues, initializeQueues, setQueueBackendAvailability } from "./queues";
import { closeWorkers, initializeWorkers } from "./queues/workers";

const server = app.listen(env.PORT, async () => {
  console.log(`root here we hare ${new Date()}`);
  console.log(`Server running on port ${env.PORT}`);
  console.log(`Example app listening at http://localhost:${env.PORT}`);
  console.log(env.APP_TOKEN_NAME);

  try {
    await connectRedis();
    setQueueBackendAvailability(true);
    initializeQueues();
    initializeWorkers();
    console.log("⏩ Connected to redis successfully");
  } catch (error) {
    setQueueBackendAvailability(false);
    console.error("Redis connection failed");
    console.error(error instanceof Error ? error.message : error);
    redis.disconnect();
  }
});

const shutdown = async () => {
  server.close(async () => {
    setQueueBackendAvailability(false);
    await closeWorkers();
    await closeQueues();
    redis.disconnect();
    await prisma.$disconnect();
    process.exit(0);
  });
};

process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());
