import assert from "node:assert/strict";
import test from "node:test";
import jwt from "jsonwebtoken";
import { isIpAllowed, loginAccountType, signTokens } from "./auth.service";
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

test("IP restriction matches IPv4 and IPv6 CIDR ranges", () => {
  assert.equal(isIpAllowed("192.0.2.42", ["192.0.2.0/24"]), true);
  assert.equal(isIpAllowed("192.0.3.42", ["192.0.2.0/24"]), false);
  assert.equal(isIpAllowed("2001:db8::42", ["2001:db8::/32"]), true);
  assert.equal(isIpAllowed("2001:db9::42", ["2001:db8::/32"]), false);
});

test("new access and refresh tokens are bound to their revocable server session", () => {
  const tokens = signTokens({ id: "user-1", organizationId: "tenant-1" }, "session-1");
  assert.equal((jwt.decode(tokens.accessToken) as jwt.JwtPayload).sessionId, "session-1");
  assert.equal((jwt.decode(tokens.refreshToken) as jwt.JwtPayload).sessionId, "session-1");
});
