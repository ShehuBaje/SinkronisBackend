import assert from "node:assert/strict";
import test from "node:test";
import { sendWorkspaceInvitationEmail, workspaceInvitationSetupUrl } from "./auth.mailer";

const input = { to: "invitee@example.com", organizationName: "Example Tenant", roleName: "Employee", setupUrl: "https://app.example.com/setup-password?token=redacted", expiresAt: new Date("2026-09-12T00:00:00.000Z") };

test("workspace invitation awaits SMTP acceptance for the exact recipient", async () => {
  let message: Record<string, unknown> | undefined;
  const result = await sendWorkspaceInvitationEmail(input, { transport: { sendMail: async (value) => { message = value; return { messageId: "provider-message-1", accepted: [input.to] }; } }, nodeEnv: "test" });
  assert.equal(message?.to, input.to);
  assert.equal(result.messageId, "provider-message-1");
  assert.deepEqual(result.accepted, [input.to]);
});

test("workspace invitation rejects provider failure or recipient refusal", async () => {
  await assert.rejects(sendWorkspaceInvitationEmail(input, { transport: { sendMail: async () => { throw Object.assign(new Error("provider unavailable"), { code: "ESOCKET" }); } }, nodeEnv: "test" }), /provider unavailable/);
  await assert.rejects(sendWorkspaceInvitationEmail(input, { transport: { sendMail: async () => ({ messageId: "rejected", accepted: [] }) }, nodeEnv: "test" }), /did not accept invitation recipient/);
});

test("production invitation rejects missing mail configuration", async () => {
  await assert.rejects(sendWorkspaceInvitationEmail(input, { transport: null, nodeEnv: "production" }), /SMTP credentials are not configured/);
});

test("workspace invitation URL uses the configured frontend and encodes the token", () => {
  const url = new URL(workspaceInvitationSetupUrl("token with spaces"));
  assert.equal(url.pathname, "/setup-password");
  assert.equal(url.searchParams.get("token"), "token with spaces");
});
