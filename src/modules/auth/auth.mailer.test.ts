import assert from "node:assert/strict";
import test from "node:test";
import { sendWorkspaceInvitationEmail, workspaceInvitationSetupUrl } from "./auth.mailer";
import { escapeEmailHtml, safeEmailDeliveryError, SMTP_TIMEOUTS, smtpTransportOptions } from "../../core/email-security";

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

test("workspace invitation safely escapes tenant and role values while preserving readable text", async () => {
  let message: Record<string, unknown> | undefined;
  const unsafe = { ...input, organizationName: "R&D <script>alert(1)</script> 日本", roleName: '<img src=x onerror=alert(1)>' };
  await sendWorkspaceInvitationEmail(unsafe, { transport: { sendMail: async (value) => { message = value; return { accepted: [unsafe.to] }; } }, nodeEnv: "test" });
  const html = String(message?.html);
  assert.match(html, /R&amp;D &lt;script&gt;alert\(1\)&lt;\/script&gt; 日本/);
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.doesNotMatch(html, /<script>|<img src=x/);
  assert.match(String(message?.text), /R&D <script>alert\(1\)<\/script> 日本/);
});

test("email HTML escaping and SMTP options preserve TLS verification and set bounded timeouts", () => {
  assert.equal(escapeEmailHtml(`<script>"O'Brien"</script>`), "&lt;script&gt;&quot;O&#39;Brien&quot;&lt;/script&gt;");
  const options = smtpTransportOptions({ host: "smtp.example.test", port: 587, secure: false, user: "user", pass: "secret" });
  assert.deepEqual({ connectionTimeout: options.connectionTimeout, greetingTimeout: options.greetingTimeout, socketTimeout: options.socketTimeout }, SMTP_TIMEOUTS);
  assert.equal("tls" in options, false);
  assert.equal(JSON.stringify(options).includes("rejectUnauthorized"), false);
});

test("provider errors retain safe classification without persisting provider details", () => {
  assert.deepEqual(safeEmailDeliveryError(Object.assign(new Error("535 password=secret rejected recipient@example.com"), { code: "EAUTH" })), { code: "EAUTH", message: "Email delivery failed (EAUTH)" });
  assert.deepEqual(safeEmailDeliveryError(new Error("token=secret")), { code: "EMAIL_DELIVERY_FAILED", message: "Email delivery failed (EMAIL_DELIVERY_FAILED)" });
});
