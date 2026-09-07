import assert from "node:assert/strict";
import test from "node:test";
import { deriveEffectiveUserModules, deriveInvitationStatus } from "./admin.service";
import { adminRouter } from "./admin.routes";

test("per-user module access is the intersection of role permission and explicit assignment", () => {
  const permissions = ["hris:employees:view", "payroll:runs:view", "admin:staff:view"];
  assert.deepEqual(deriveEffectiveUserModules(permissions, null), ["HRIS", "PAYROLL"]);
  assert.deepEqual(deriveEffectiveUserModules(permissions, ["PAYROLL"]), ["PAYROLL"]);
  assert.deepEqual(deriveEffectiveUserModules(permissions, ["ACCOUNTING"]), []);
});

test("pending invitation status is derived from its real expiry", () => {
  assert.equal(deriveInvitationStatus("PENDING", new Date(Date.now() + 60_000)), "PENDING");
  assert.equal(deriveInvitationStatus("PENDING", new Date(Date.now() - 60_000)), "EXPIRED");
  assert.equal(deriveInvitationStatus("EXPIRED", new Date(Date.now() + 60_000)), "EXPIRED");
});

test("Tenant Admin UI export routes are registered", () => {
  const routes = (adminRouter as any).stack.filter((layer: any) => layer.route).flatMap((layer: any) => Object.keys(layer.route.methods).map((method) => `${method.toUpperCase()} ${layer.route.path}`));
  assert.ok(routes.includes("GET /audit-log/export"));
  assert.ok(routes.includes("GET /my-plan/billing-history/export"));
  assert.ok(routes.includes("POST /general-settings/data-privacy/exports"));
  assert.ok(routes.includes("GET /general-settings/data-privacy/exports/:exportId"));
  assert.ok(routes.includes("GET /general-settings/data-privacy/exports/:exportId/download"));
});
