import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { envSchema } from "../../config/env";
import { generateSixDigitOtp } from "./auth.service";

const source = (file: string) => fs.readFileSync(file, "utf8");
const productionBase = {
  NODE_ENV: "production", DATABASE_URL: "mysql://example.invalid/db", JWT_ACCESS_SECRET: "a".repeat(24), JWT_REFRESH_SECRET: "b".repeat(24),
  CORS_ORIGIN: "https://app.example.test", PUBLIC_BASE_URL: "https://api.example.test", RATE_LIMIT_STORE: "redis", REDIS_URL: "redis://cache.example.test:6379",
  CRON_SECRET: "c".repeat(24), BACKGROUND_JOBS_MODE: "inline", DEPLOYMENT_RUNTIME: "serverless", PAYSTACK_TRANSFERS_ENABLED: "false",
  SMTP_HOST: "smtp.example.test", SMTP_USER: "mailer", SMTP_PASS: "smtp-secret", EMAIL_FROM: "no-reply@example.test"
};

test("security OTP generation is cryptographic and preserves the six-digit contract", () => {
  const service = source("src/modules/auth/auth.service.ts");
  assert.match(service, /crypto\.randomInt\(100_000, 1_000_000\)/);
  assert.doesNotMatch(service, /generateSixDigitOtp[\s\S]{0,150}Math\.random/);
  for (let index = 0; index < 1_000; index += 1) assert.match(generateSixDigitOtp(), /^[1-9]\d{5}$/);
});

test("reset OTP verification does not disclose account existence or exhausted-attempt state", () => {
  const service = source("src/modules/auth/auth.service.ts");
  const verification = service.slice(service.indexOf("export const verifyResetOtp"), service.indexOf("export const resetPassword"));
  assert.doesNotMatch(verification, /No active account found|Maximum OTP attempts exceeded/);
  assert.ok((verification.match(/OTP is invalid or has expired/g) ?? []).length >= 4);
});

test("production requires complete SMTP configuration without exposing secret values", () => {
  assert.equal(envSchema.safeParse(productionBase).success, true);
  for (const key of ["SMTP_HOST", "SMTP_USER", "SMTP_PASS", "EMAIL_FROM"] as const) {
    const result = envSchema.safeParse({ ...productionBase, [key]: undefined });
    assert.equal(result.success, false);
    if (!result.success) {
      const rendered = JSON.stringify(result.error.issues);
      assert.match(rendered, new RegExp(key));
      assert.doesNotMatch(rendered, /smtp-secret/);
    }
  }
  assert.equal(envSchema.safeParse({ ...productionBase, NODE_ENV: "test", SMTP_HOST: undefined, SMTP_USER: undefined, SMTP_PASS: undefined, EMAIL_FROM: undefined }).success, true);
});

test("reusable OTPs and invitation or challenge tokens are not intentionally logged", () => {
  const mailer = source("src/modules/auth/auth.mailer.ts");
  const service = source("src/modules/auth/auth.service.ts");
  assert.doesNotMatch(mailer, /console\.log\([^\n]*(?:input\.otp|input\.setupUrl)/);
  const logStatements = service.match(/console\.log\([\s\S]*?\);/g)?.join("\n") ?? "";
  assert.doesNotMatch(logStatements, /challengeToken|otp=\$\{otp\}/);
});
