import assert from "node:assert/strict";
import test from "node:test";
import { acceptTenantInvitationSchema } from "./auth.schemas";

test("tenant invitation password setup is a dedicated strict flow", () => {
  const token = "a".repeat(64);
  assert.equal(acceptTenantInvitationSchema.safeParse({ token, password: "SecurePassword123!", confirmPassword: "SecurePassword123!" }).success, true);
  assert.equal(acceptTenantInvitationSchema.safeParse({ token, password: "SecurePassword123!", confirmPassword: "different-password" }).success, false);
  assert.equal(acceptTenantInvitationSchema.safeParse({ email: "admin@example.com", otp: "123456", password: "SecurePassword123!" }).success, false);
});
