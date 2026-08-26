import assert from "node:assert/strict";
import test from "node:test";
import { loginAccountType } from "./auth.service";
import { acceptTenantInvitationSchema, refreshTokenSchema } from "./auth.schemas";

test("tenant invitation password setup is a dedicated strict flow", () => {
  const token = "a".repeat(64);
  assert.equal(acceptTenantInvitationSchema.safeParse({ token, password: "SecurePassword123!", confirmPassword: "SecurePassword123!" }).success, true);
  assert.equal(acceptTenantInvitationSchema.safeParse({ token, password: "SecurePassword123!", confirmPassword: "different-password" }).success, false);
  assert.equal(acceptTenantInvitationSchema.safeParse({ email: "admin@example.com", otp: "123456", password: "SecurePassword123!" }).success, false);
});

test("login account type is independent from organization-scoped role names", () => {
  assert.equal(loginAccountType(true), "PLATFORM_ADMIN");
  assert.equal(loginAccountType(false), "TENANT_USER");
});

test("refresh token exchange accepts only the issued refresh token field", () => {
  assert.equal(refreshTokenSchema.safeParse({ refreshToken: "signed-refresh-token" }).success, true);
  assert.equal(refreshTokenSchema.safeParse({ accessToken: "signed-access-token" }).success, false);
  assert.equal(refreshTokenSchema.safeParse({ refreshToken: "signed-refresh-token", userId: "other-user" }).success, false);
});
