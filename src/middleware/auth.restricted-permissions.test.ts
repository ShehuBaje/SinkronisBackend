import assert from "node:assert/strict";
import test from "node:test";
import { resolveEffectivePermissions } from "../modules/auth/effective-permissions";
import { authorize } from "./rbac.middleware";

const restricted = "payroll:loans:confirm-legacy";

test("system Owner does not acquire restricted permissions through catalog expansion", () => {
  const permissions = resolveEffectivePermissions({ name: "Owner", isSystem: true, permissions: [] });
  assert.ok(permissions.includes("payroll:runs:approve"));
  assert.ok(!permissions.includes(restricted));
});

test("restricted permission is effective only after explicit role assignment", () => {
  const permissions = resolveEffectivePermissions({ name: "Owner", isSystem: true, permissions: [restricted] });
  assert.ok(permissions.includes(restricted));
});

test("non-Owner privileged role receives only persisted permissions", () => {
  assert.deepEqual(resolveEffectivePermissions({ name: "Super Admin", isSystem: true, permissions: ["payroll:loans:update"] }), ["payroll:loans:update"]);
});

test("decision-route authorization rejects expanded Owner and accepts explicit assignment", () => {
  const middleware = authorize(restricted as any);
  const invoke = (permissions: string[]) => {
    let result: unknown;
    middleware({ user: { permissions } } as any, {} as any, (error?: unknown) => { result = error ?? null; });
    return result as any;
  };
  const expandedOwner = resolveEffectivePermissions({ name: "Owner", isSystem: true, permissions: [] });
  assert.equal(invoke(expandedOwner)?.statusCode, 403);
  const assignedOwner = resolveEffectivePermissions({ name: "Owner", isSystem: true, permissions: [restricted] });
  assert.equal(invoke(assignedOwner), null);
});
