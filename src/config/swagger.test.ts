import assert from "node:assert/strict";
import test from "node:test";
import app from "../app";
import { openApiSpec } from "./swagger";

const normalizePath = (path: string) => {
  const normalized = path
    .replace(/:([A-Za-z0-9_]+)/g, "{}")
    .replace(/\{[A-Za-z0-9_]+\}/g, "{}")
    .replace(/\/$/, "");
  return normalized || "/";
};

const mountPath = (layer: any) => layer.regexp.source
  .replace(/^\^/, "")
  .replace(/\\\/\?\(\?=\\\/\|\$\)$/, "")
  .replace(/\\\//g, "/");

const collectRuntimeOperations = (stack: any[], base = "", operations: string[] = []) => {
  for (const layer of stack) {
    if (layer.route) {
      const paths = Array.isArray(layer.route.path) ? layer.route.path : [layer.route.path];
      for (const path of paths) {
        for (const method of Object.keys(layer.route.methods)) {
          operations.push(`${method.toUpperCase()} ${normalizePath(base + path)}`);
        }
      }
    } else if (layer.name === "router" && layer.handle.stack) {
      collectRuntimeOperations(layer.handle.stack, base + mountPath(layer), operations);
    }
  }
  return operations;
};

test("Swagger is a complete UI-aligned contract for implemented modules", () => {
  const runtime = new Set(collectRuntimeOperations((app as any)._router.stack));
  const paths = (openApiSpec as { paths?: Record<string, Record<string, unknown>> }).paths ?? {};
  const documented = new Set(Object.entries(paths).flatMap(([path, item]) =>
    Object.keys(item)
      .filter((method) => ["get", "post", "put", "patch", "delete", "options", "head"].includes(method))
      .map((method) => `${method.toUpperCase()} ${normalizePath(path)}`)
  ));
  const excludedLegacyCrud = (operation: string) =>
    /^\w+ \/api\/v1\/admin\/(staff|teams|system-config)(\/\{\})?$/.test(operation) ||
    /^\w+ \/api\/v1\/hris\/leave(\/\{\})?$/.test(operation) ||
    /^(GET|PATCH|DELETE) \/api\/v1\/hris\/attendance\/\{\}$/.test(operation) ||
    operation === "POST /api/v1/hris/attendance" ||
    operation === "DELETE /api/v1/hris/employees/{}";
  const implementedPayroll = (operation: string) => operation === "GET /api/v1/payroll/dashboard" || operation.includes(" /api/v1/payroll/employees");
  const ignored = (operation: string) =>
    operation === "GET /" ||
    /\/(docs|docs\.json)(\/|$)|favicon/.test(operation) ||
    operation.includes(" /api/v1/internal/") ||
    operation.includes(" /api/v1/accounting/") ||
    (operation.includes(" /api/v1/payroll/") && !implementedPayroll(operation)) ||
    excludedLegacyCrud(operation);

  const undocumented = [...runtime].filter((operation) => !documented.has(operation) && !ignored(operation)).sort();
  const stale = [...documented].filter((operation) => !runtime.has(operation)).sort();
  const forbidden = [...documented].filter((operation) =>
    operation.includes(" /api/v1/accounting/") || (operation.includes(" /api/v1/payroll/") && !implementedPayroll(operation))
  ).sort();

  assert.deepEqual(undocumented, [], `Undocumented runtime operations:\n${undocumented.join("\n")}`);
  assert.deepEqual(stale, [], `Documented but unregistered operations:\n${stale.join("\n")}`);
  assert.deepEqual(forbidden, [], `Unimplemented Accounting/Payroll operations must not be published:\n${forbidden.join("\n")}`);
  assert.equal(runtime.has("PATCH /api/v1/subscriptions/current/seats"), false);
  assert.equal(documented.has("PATCH /api/v1/subscriptions/current/seats"), false);
});
