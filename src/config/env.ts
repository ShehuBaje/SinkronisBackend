import "dotenv/config";
import { z } from "zod";

export const envSchema = z.object({
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
  DEPLOYMENT_RUNTIME: z.enum(["serverless", "persistent-worker"]).default("serverless"),
  CRON_SECRET: z.string().min(16).optional(),
  JWT_ACCESS_SECRET: z.string().min(24),
  JWT_REFRESH_SECRET: z.string().min(24),
  JWT_ACCESS_EXPIRES_IN: z.string().default("30m"),
  JWT_REFRESH_EXPIRES_IN: z.string().default("7d"),
  APP_NAME: z.string().default("Sinkronis"),
  EMAIL_FROM: z.string().email().optional(),
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
  FRONTEND_URL: z.string().url().optional(),
  PUBLIC_BASE_URL: z.preprocess((value) => value === "" ? undefined : value, z.string().url().optional()),
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(10).default(0),
  TRUST_PROXY_CIDRS: z.string().default(""),
  IP_GEOLOCATION_PROVIDER: z.enum(["NONE", "IPINFO"]).default("NONE"),
  IPINFO_TOKEN: z.preprocess((value) => value === "" ? undefined : value, z.string().min(1).optional()),
  IP_GEOLOCATION_TIMEOUT_MS: z.coerce.number().int().min(100).max(10000).default(1500),
  DEV_CLIENT_IP_OVERRIDE: z.preprocess((value) => value === "" ? undefined : value, z.string().ip().optional()),
  COMPANY_REGISTRY_PROVIDER: z.enum(["NONE", "CAC"]).default("NONE"),
  CAC_API_BASE_URL: z.preprocess((value) => value === "" ? undefined : value, z.string().url().optional()),
  CAC_API_KEY: z.preprocess((value) => value === "" ? undefined : value, z.string().min(1).optional()),
  CAC_API_TIMEOUT_MS: z.coerce.number().int().min(100).max(30000).default(5000),
  PAYSTACK_SECRET_KEY: z.preprocess((value) => value === "" ? undefined : value, z.string().regex(/^sk_(test|live)_[A-Za-z0-9]+$/).optional()),
  PAYSTACK_PUBLIC_KEY: z.preprocess((value) => value === "" ? undefined : value, z.string().regex(/^pk_(test|live)_[A-Za-z0-9]+$/).optional()),
  PAYSTACK_CALLBACK_URL: z.preprocess((value) => value === "" ? undefined : value, z.string().url().optional()),
  PAYSTACK_SUBSCRIPTION_CALLBACK_URL: z.preprocess((value) => value === "" ? undefined : value, z.string().url().optional()),
  PAYSTACK_TRANSFERS_ENABLED: z.enum(["true", "false"]).default("false").transform((value) => value === "true"),
  PAYSTACK_TRANSFERS_MODE: z.enum(["test", "live"]).optional(),
  PAYSTACK_TRANSFER_STALE_MS: z.coerce.number().int().min(60_000).max(86_400_000).default(900_000),
  PAYSTACK_TRANSFER_RECONCILIATION_BATCH_SIZE: z.coerce.number().int().min(1).max(100).default(25),
  FINANCIAL_RECONCILIATION_LEASE_MS: z.coerce.number().int().min(30_000).max(900_000).default(120_000),
  FINANCIAL_WEBHOOK_RECOVERY_BATCH_SIZE: z.coerce.number().int().min(1).max(100).default(25),
  FINANCIAL_WEBHOOK_PROCESSING_LEASE_MS: z.coerce.number().int().min(30_000).max(900_000).default(120_000),
  FINANCIAL_WEBHOOK_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(20).default(5),
  FINANCIAL_RECOVERY_FRESHNESS_MINUTES: z.coerce.number().int().min(1).max(1440).default(15),
  FINANCIAL_INTEGRITY_FRESHNESS_MINUTES: z.coerce.number().int().min(1).max(10080).default(1440),
  PAYROLL_CRON_RUN_LIMIT: z.coerce.number().int().min(1).max(20).default(5),
  PAYROLL_CRON_BATCH_LIMIT: z.coerce.number().int().min(1).max(20).default(5),
  SUBSCRIPTION_CRON_BATCH_LIMIT: z.coerce.number().int().min(1).max(500).default(100),
  APPLICATION_VERSION: z.string().max(191).optional(),
  STORAGE_PROVIDER: z.enum(["local", "vercel-blob"]).default("local"),
  BLOB_READ_WRITE_TOKEN: z.string().optional(),
  PRIVATE_FILE_MIGRATION_MODE: z.enum(["CROSS_STORE", "SAME_STORE"]).optional(),
  SOURCE_BLOB_READ_WRITE_TOKEN: z.preprocess((value) => value === "" ? undefined : value, z.string().min(1).optional()),
  DESTINATION_BLOB_READ_WRITE_TOKEN: z.preprocess((value) => value === "" ? undefined : value, z.string().min(1).optional()),
  UPLOAD_DIR: z.string().default("uploads"),
  UPLOAD_PUBLIC_BASE_PATH: z.string().startsWith("/").default("/uploads"),
  UPLOAD_MAX_FILE_SIZE_MB: z.coerce.number().int().positive().default(5),
  DEFAULT_SUPER_ADMIN_EMAIL: z.string().email().default("admin@example.com"),
  DEFAULT_SUPER_ADMIN_PASSWORD: z.string().min(8).default("ChangeMe123!")
}).superRefine((value, context) => {
  if (value.NODE_ENV === "production" && value.DEV_CLIENT_IP_OVERRIDE) context.addIssue({ code: z.ZodIssueCode.custom, path: ["DEV_CLIENT_IP_OVERRIDE"], message: "DEV_CLIENT_IP_OVERRIDE is forbidden in production" });
  if (value.NODE_ENV !== "production") return;
  if (value.CORS_ORIGIN.split(",").map((origin) => origin.trim()).includes("*")) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["CORS_ORIGIN"], message: "CORS_ORIGIN must be an explicit frontend origin in production" });
  }
  if (value.STORAGE_PROVIDER === "vercel-blob" && !value.BLOB_READ_WRITE_TOKEN) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["BLOB_READ_WRITE_TOKEN"], message: "The selected Vercel Blob provider requires BLOB_READ_WRITE_TOKEN" });
  }
  if (!value.CRON_SECRET) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["CRON_SECRET"], message: "CRON_SECRET is required in production" });
  }
  for (const key of ["SMTP_HOST", "SMTP_USER", "SMTP_PASS", "EMAIL_FROM"] as const) {
    if (!value[key]?.trim()) context.addIssue({ code: z.ZodIssueCode.custom, path: [key], message: `${key} is required in production` });
  }
  if (value.DEPLOYMENT_RUNTIME === "serverless" && value.BACKGROUND_JOBS_MODE === "queue") {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["BACKGROUND_JOBS_MODE"], message: "Serverless production must use inline background delivery; durable Cron paths handle correctness-critical recovery" });
  }
  if (value.PAYSTACK_TRANSFERS_ENABLED && !value.PAYSTACK_TRANSFERS_MODE) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["PAYSTACK_TRANSFERS_MODE"], message: "Enabled Paystack transfers require an explicit transfer mode" });
  }
  if (value.PAYSTACK_TRANSFERS_ENABLED && !value.PAYSTACK_SECRET_KEY) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["PAYSTACK_SECRET_KEY"], message: "Enabled Paystack transfers require configured provider credentials" });
  }
  if (value.TRUST_PROXY_HOPS > 0 && !value.TRUST_PROXY_CIDRS.trim()) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["TRUST_PROXY_CIDRS"], message: "Production proxy trust requires explicit trusted proxy CIDRs; numeric hop trust is permitted only outside production" });
  }
  if (!value.PUBLIC_BASE_URL) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["PUBLIC_BASE_URL"], message: "PUBLIC_BASE_URL is required in production" });
  }
  if (value.RATE_LIMIT_STORE !== "redis") {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["RATE_LIMIT_STORE"], message: "Distributed Redis rate limiting is required in production" });
  }
  if (value.RATE_LIMIT_STORE === "redis" && !value.REDIS_URL && value.REDIS_HOST === "127.0.0.1") {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["REDIS_URL"], message: "A remote Redis connection is required for distributed rate limiting" });
  }
}).transform((value) => ({ ...value, EMAIL_FROM: value.EMAIL_FROM ?? "no-reply@sinkronis.app" }));

export const env = envSchema.parse(process.env);
