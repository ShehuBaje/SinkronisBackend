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
    /^PATCH \/api\/v1\/hris\/leave-requests\/\{\}\/(approve|reject)$/.test(operation) ||
    /^(GET|PATCH|DELETE) \/api\/v1\/hris\/attendance\/\{\}$/.test(operation) ||
    operation === "POST /api/v1/hris/attendance" ||
    operation === "DELETE /api/v1/hris/employees/{}";
  const implementedPayroll = (operation: string) => operation === "GET /api/v1/payroll/dashboard"
    || operation.includes(" /api/v1/payroll/settings")
    || operation.includes(" /api/v1/payroll/employees")
    || operation.includes(" /api/v1/payroll/payees")
    || operation.includes(" /api/v1/payroll/pay-runs")
    || operation.includes(" /api/v1/payroll/payslips")
    || operation.includes(" /api/v1/payroll/deductions")
    || operation.includes(" /api/v1/payroll/wallet")
    || operation.includes(" /api/v1/payroll/tax")
    || operation.includes(" /api/v1/payroll/pension")
    || operation.includes(" /api/v1/payroll/reports");
  const implementedAccounting = (operation: string) => operation === "GET /api/v1/accounting/dashboard"
    || operation.includes(" /api/v1/accounting/customers")
    || operation.includes(" /api/v1/accounting/items-services")
    || operation.includes(" /api/v1/accounting/projects")
    || operation.includes(" /api/v1/accounting/invoices")
    || operation.includes(" /api/v1/accounting/agents")
    || operation.includes(" /api/v1/accounting/payment-requests")
    || operation.includes(" /api/v1/accounting/expenses")
    || operation.includes(" /api/v1/accounting/reminders")
    || operation.includes(" /api/v1/accounting/exports")
    || operation.includes(" /api/v1/accounting/reports")
    || operation.includes(" /api/v1/accounting/wallet/")
    || operation.includes(" /api/v1/accounting/paystack/webhook")
    || operation.includes(" /api/v1/accounting/settings/");
  const ignored = (operation: string) =>
    operation === "GET /" ||
    /\/(docs|docs\.json)(\/|$)|favicon/.test(operation) ||
    operation.includes(" /api/v1/internal/") ||
    (operation.includes(" /api/v1/accounting/") && !implementedAccounting(operation)) ||
    (operation.includes(" /api/v1/payroll/") && !implementedPayroll(operation)) ||
    excludedLegacyCrud(operation);

  const undocumented = [...runtime].filter((operation) => !documented.has(operation) && !ignored(operation)).sort();
  const stale = [...documented].filter((operation) => !runtime.has(operation)).sort();
  const forbidden = [...documented].filter((operation) =>
    (operation.includes(" /api/v1/accounting/") && !implementedAccounting(operation)) || (operation.includes(" /api/v1/payroll/") && !implementedPayroll(operation))
  ).sort();

  assert.deepEqual(undocumented, [], `Undocumented runtime operations:\n${undocumented.join("\n")}`);
  assert.deepEqual(stale, [], `Documented but unregistered operations:\n${stale.join("\n")}`);
  assert.deepEqual(forbidden, [], `Unimplemented Accounting/Payroll operations must not be published:\n${forbidden.join("\n")}`);
  assert.equal(runtime.has("PATCH /api/v1/subscriptions/current/seats"), false);
  assert.equal(documented.has("PATCH /api/v1/subscriptions/current/seats"), false);
  assert.equal(documented.has("PATCH /api/v1/hris/leave-requests/{}/approve"), false);
  assert.equal(documented.has("PATCH /api/v1/hris/leave-requests/{}/reject"), false);
  assert.equal(documented.has("PATCH /api/v1/hris/leaves/{}/approve"), true);
  assert.equal(documented.has("PATCH /api/v1/hris/leaves/{}/reject"), true);
});

test("HRIS appraisal mutations publish their complete frontend contract", () => {
  const paths = (openApiSpec as any).paths;
  const bodyOperations = [
    ["/api/v1/hris/appraisals/cycles", "post"],
    ["/api/v1/hris/appraisals/{appraisalId}/goals", "post"],
    ["/api/v1/hris/appraisals/{appraisalId}/goals/{goalId}", "patch"],
    ["/api/v1/hris/appraisals/{appraisalId}/self-assessment", "post"],
    ["/api/v1/hris/appraisals/{appraisalId}/manager-review", "post"],
    ["/api/v1/hris/appraisals/{appraisalId}/hr-approval", "post"]
  ];
  for (const [path, method] of bodyOperations) {
    assert.equal(paths[path][method].requestBody.required, true, `${method.toUpperCase()} ${path} must document its required JSON body`);
    assert.ok(paths[path][method].requestBody.content["application/json"].schema);
  }
  for (const path of ["/api/v1/hris/appraisals/cycles/{cycleId}/launch", "/api/v1/hris/appraisals/cycles/{cycleId}/complete", "/api/v1/hris/appraisals/{appraisalId}/goals/complete"]) {
    assert.equal(paths[path].post.requestBody, undefined, `POST ${path} is an action command and must remain bodyless`);
    assert.ok(paths[path].post.parameters.some((parameter: any) => parameter.in === "path" && parameter.required));
  }
});
