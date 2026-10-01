import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const serviceSource = readFileSync("src/modules/platform-admin/platform-admin.service.ts", "utf8");
const routeSource = readFileSync("src/modules/platform-admin/platform-admin.routes.ts", "utf8");

test("tenant creation and PLATFORM_TENANT_CREATED audit share one transaction", () => {
  const start = serviceSource.indexOf("export const createPlatformTenant");
  const transaction = serviceSource.indexOf("const created = await prisma.$transaction(async (tx)", start);
  const email = serviceSource.indexOf("sendTenantAdminInvitationEmail", transaction);
  const block = serviceSource.slice(transaction, email);
  assert.match(block, /tx\.organization\.create/);
  assert.match(block, /tx\.role\.create/);
  assert.match(block, /tx\.user\.create/);
  assert.match(block, /tx\.agentInvitation\.create/);
  assert.match(block, /tx\.organizationGeneralSettings\.create/);
  assert.match(block, /tx\.systemConfig\.create/);
  assert.match(block, /PLATFORM_TENANT_CREATED/);
  assert.match(block, /createAuditLog\([\s\S]*, tx\)/);
});

test("tenant SMTP failure is captured as truthful delivery metadata without rethrow", () => {
  const start = serviceSource.indexOf("export const createPlatformTenant");
  const end = serviceSource.indexOf("export const resendPlatformTenantOnboardingInvitation", start);
  const block = serviceSource.slice(start, end);
  assert.match(block, /deliveryStatus: "SENT"/);
  assert.match(block, /let deliveryStatus: "SENT" \| "FAILED" = "FAILED"/);
  assert.match(block, /safeEmailDeliveryError/);
  assert.match(block, /TENANT_ADMIN_INVITATION_DELIVERY_FAILED/);
  assert.doesNotMatch(block, /throw serviceUnavailable/);
});

test("Platform onboarding resend is permission-protected, tenant-scoped, token-rotating and audited", () => {
  assert.match(routeSource, /tenants\/:tenantId\/onboarding-invitation\/resend/);
  assert.match(routeSource, /authorize\("platform:tenants:users:manage"\)/);
  const start = serviceSource.indexOf("export const resendPlatformTenantOnboardingInvitation");
  const block = serviceSource.slice(start, serviceSource.indexOf("export const activatePlatformTenant", start));
  assert.match(block, /assertPlatformAdmin\(platformAdmin\)/);
  assert.match(block, /organizationId: tenant\.id/);
  assert.match(block, /crypto\.randomBytes\(32\)/);
  assert.match(block, /expiresAt/);
  assert.match(block, /INVITATION_CONCURRENTLY_UPDATED/);
  assert.match(block, /PLATFORM_TENANT_INVITATION_RESEND_REQUESTED/);
  assert.match(block, /createAuditLog\([\s\S]*, tx\)/);
});

test("legacy onboarding invitations remain recoverable and acceptance data remains compatible", () => {
  const start = serviceSource.indexOf("export const resendPlatformTenantOnboardingInvitation");
  const block = serviceSource.slice(start, serviceSource.indexOf("export const activatePlatformTenant", start));
  assert.match(block, /purpose: "TENANT_ADMIN"/);
  assert.match(block, /purpose: "WORKSPACE"/);
  assert.match(block, /role: \{ name: "Owner", isSystem: true \}/);
  assert.match(block, /status: "PENDING"/);
  assert.match(block, /purpose: "TENANT_ADMIN"/);
});
