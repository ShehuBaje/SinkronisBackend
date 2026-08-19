import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().min(1),
  API_PREFIX: z.string().startsWith("/").default("/api/v1"),
  APP_TOKEN_NAME: z.string().default("sinkronis-token"),
  REDIS_HOST: z.string().default("127.0.0.1"),
  REDIS_PORT: z.coerce.number().int().positive().default(6379),
  REDIS_PASSWORD: z.string().optional(),
  REDIS_DB: z.coerce.number().int().min(0).default(0),
  REDIS_URL: z.preprocess((value) => value === "" ? undefined : value, z.string().url().optional()),
  RATE_LIMIT_STORE: z.enum(["memory", "redis"]).default("memory"),
  BACKGROUND_JOBS_MODE: z.enum(["inline", "queue"]).default("queue"),
  CRON_SECRET: z.string().min(16).optional(),
  JWT_ACCESS_SECRET: z.string().min(24),
  JWT_REFRESH_SECRET: z.string().min(24),
  JWT_ACCESS_EXPIRES_IN: z.string().default("30m"),
  JWT_REFRESH_EXPIRES_IN: z.string().default("7d"),
  APP_NAME: z.string().default("Sinkronis"),
  EMAIL_FROM: z.string().email().default("no-reply@sinkronis.app"),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().positive().default(587),
  SMTP_SECURE: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  SMS_WEBHOOK_URL: z.string().url().optional(),
  SMS_WEBHOOK_BEARER_TOKEN: z.string().optional(),
  SMS_FROM: z.string().optional(),
  AUTH_ENFORCE_UNIQUE_EMAIL: z
    .enum(["true", "false"])
    .default("true")
    .transform((value) => value === "true"),
  CORS_ORIGIN: z.string().default("*"),
  STORAGE_PROVIDER: z.enum(["local", "vercel-blob"]).default("local"),
  BLOB_READ_WRITE_TOKEN: z.string().optional(),
  UPLOAD_DIR: z.string().default("uploads"),
  UPLOAD_PUBLIC_BASE_PATH: z.string().startsWith("/").default("/uploads"),
  UPLOAD_MAX_FILE_SIZE_MB: z.coerce.number().int().positive().default(5),
  DEFAULT_SUPER_ADMIN_EMAIL: z.string().email().default("admin@example.com"),
  DEFAULT_SUPER_ADMIN_PASSWORD: z.string().min(8).default("ChangeMe123!")
}).superRefine((value, context) => {
  if (value.NODE_ENV !== "production") return;
  if (value.CORS_ORIGIN.split(",").map((origin) => origin.trim()).includes("*")) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["CORS_ORIGIN"], message: "CORS_ORIGIN must be an explicit frontend origin in production" });
  }
  if (value.STORAGE_PROVIDER !== "vercel-blob" || !value.BLOB_READ_WRITE_TOKEN) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["BLOB_READ_WRITE_TOKEN"], message: "Vercel Blob storage must be configured in production" });
  }
  if (!value.CRON_SECRET) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["CRON_SECRET"], message: "CRON_SECRET is required in production" });
  }
  if (value.RATE_LIMIT_STORE !== "redis") {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["RATE_LIMIT_STORE"], message: "Distributed Redis rate limiting is required in production" });
  }
  if (value.RATE_LIMIT_STORE === "redis" && !value.REDIS_URL && value.REDIS_HOST === "127.0.0.1") {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["REDIS_URL"], message: "A remote Redis connection is required for distributed rate limiting" });
  }
});

export const env = envSchema.parse(process.env);
