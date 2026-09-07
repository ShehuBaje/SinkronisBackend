import assert from "node:assert/strict";
import test from "node:test";
import { deriveEffectiveUserModules, deriveInvitationStatus } from "./admin.service";

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
