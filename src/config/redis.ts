import Redis from "ioredis";
import { env } from "./env";

export const redisConnectionOptions = {
  host: env.REDIS_HOST,
  port: env.REDIS_PORT,
  password: env.REDIS_PASSWORD || undefined,
  db: env.REDIS_DB,
  maxRetriesPerRequest: null,
  lazyConnect: true
};

export const redis = env.REDIS_URL
  ? new Redis(env.REDIS_URL, { maxRetriesPerRequest: null, lazyConnect: true })
  : new Redis(redisConnectionOptions);

redis.on("error", () => undefined);

export const connectRedis = async () => {
  if (redis.status === "wait") {
    await redis.connect();
  }

  await redis.ping();
};
