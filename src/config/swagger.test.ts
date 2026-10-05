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
    || operation.includes(" /api/v1/accounting/financial-settlements")
    || operation.includes(" /api/v1/accounting/expenses")
    || operation.includes(" /api/v1/accounting/reminders")
    || operation.includes(" /api/v1/accounting/exports")
    || operation.includes(" /api/v1/accounting/reports")
    || operation.includes(" /api/v1/accounting/wallet/")
    || operation.includes(" /api/v1/accounting/paystack/webhook")
    || operation.includes(" /api/v1/accounting/paystack/transfer-approval")
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

test("Payroll mixed-run schemas preserve participant and financial compatibility semantics", () => {
  const spec = openApiSpec as any;
  const payRun = spec.components.schemas.PayrollPayRun;
  const totals = spec.components.schemas.PayrollPayRunTotals;

  for (const field of ["participantCount", "permanentEmployeeCount", "externalPayeeCount", "employeeCount"]) {
    assert.equal(payRun.properties[field].type, "integer");
  }
  assert.match(payRun.description, /participantCount equals permanentEmployeeCount plus externalPayeeCount/);
  assert.match(payRun.properties.employeeCount.description, /backward-compatible Permanent employee count/);

  assert.equal(totals.properties.wht.type, "number");
  assert.equal(totals.properties.permanentNetPay.type, "number");
  assert.equal(totals.properties.externalNetPay.type, "number");
  assert.match(totals.properties.wht.description, /Contract WHT total only/);
  assert.match(totals.properties.paye.description, /Contract WHT is excluded/);
  assert.match(totals.properties.permanentNetPay.description, /PayrollRun\.totalPermanentNetPay/);
  assert.match(totals.properties.externalNetPay.description, /PayrollRun\.totalExternalNetPay/);

  const listSchema = spec.paths["/api/v1/payroll/pay-runs"].get.responses["200"].content["application/json"].schema;
  assert.equal(listSchema.properties.data.items.$ref, "#/components/schemas/PayrollPayRun");
  const detailSchema = spec.paths["/api/v1/payroll/pay-runs/{payRunId}"].get.responses["200"].content["application/json"].schema;
  assert.equal(detailSchema.properties.data.properties.payRun.$ref, "#/components/schemas/PayrollPayRun");
});

test("P2.3 payroll history and mixed export document the runtime contracts", () => {
  const spec = openApiSpec as any;
  const history = spec.paths["/api/v1/payroll/pay-runs"].get;
  const parameters = Object.fromEntries(history.parameters.map((parameter: any) => [parameter.name, parameter]));
  assert.deepEqual(Object.keys(parameters), ["page", "limit", "search", "status", "from", "to", "sortBy", "sortOrder"]);
  assert.equal(parameters.page.schema.default, 1);
  assert.equal(parameters.limit.schema.default, 20);
  assert.equal(parameters.limit.schema.maximum, 100);
  assert.equal(parameters.status.schema.$ref, "#/components/schemas/PayrollPayRunStatus");
  assert.deepEqual(parameters.sortBy.schema.enum, ["period", "createdAt", "employees", "gross", "netPay", "paye", "status"]);
  assert.equal(parameters.sortBy.schema.default, "createdAt");
  assert.deepEqual(parameters.sortOrder.schema.enum, ["asc", "desc"]);
  assert.equal(parameters.sortOrder.schema.default, "desc");
  assert.match(parameters.from.description, /inclusive/i);
  assert.match(parameters.to.description, /inclusive/i);
  const statusValues = spec.components.schemas.PayrollPayRunStatus.enum;
  for (const status of ["DRAFT", "PROCESSING", "PENDING_APPROVAL", "APPROVED", "REJECTED_FOR_REWORK", "PENDING_DISBURSEMENT", "DISBURSING", "DISBURSED", "FAILED", "PAID", "CANCELLED"]) assert.ok(statusValues.includes(status));
  const historyResponse = history.responses["200"].content["application/json"].schema;
  assert.equal(historyResponse.properties.data.items.$ref, "#/components/schemas/PayrollPayRun");
  assert.deepEqual(historyResponse.properties.pagination.required, ["page", "limit", "total", "totalPages"]);

  const exported = spec.paths["/api/v1/payroll/pay-runs/{payRunId}/export"].get;
  assert.match(exported.summary, /mixed payroll results/i);
  assert.match(exported.description, /PERMANENT.*Payslip/s);
  assert.match(exported.description, /CONTRACT and CONSULTANT.*PayeePayment/s);
  assert.match(exported.description, /never reconstructed from current mutable/i);
  assert.match(exported.description, /PAYE is Permanent payroll tax/i);
  assert.match(exported.description, /WHT is Contract withholding tax/i);
  assert.match(exported.description, /Consultant.*EXEMPT/i);
  assert.match(exported.description, /formula-injection/i);
  assert.ok(exported.responses["200"].content["text/csv"]);
  assert.match(exported.responses["200"].description, /ParticipantType.*ResultType.*BaseCompensation.*Bonus.*PAYE.*WHT.*NSITF.*NetPay/s);
  assert.match(spec.components.schemas.PayrollMixedResult.properties.nsitf.description, /employer-side.*never deducted/i);
  const process = spec.paths["/api/v1/payroll/pay-runs/{payRunId}/process"].post;
  assert.match(process.description, /PAYROLL_DEDUCTIONS_EXCEED_GROSS/);
  assert.match(process.description, /NSITF.*employer-side.*excluded/s);
});

test("P2.3 templated paths declare exactly their required path parameters", () => {
  const spec = openApiSpec as any;
  const operations: Array<[string, string]> = [
    ["/api/v1/payroll/pay-runs/{payRunId}", "get"],
    ["/api/v1/payroll/pay-runs/{payRunId}/results/{participantId}", "get"],
    ["/api/v1/payroll/pay-runs/{payRunId}/approve", "post"],
    ["/api/v1/payroll/pay-runs/{payRunId}/reject", "post"],
    ["/api/v1/payroll/pay-runs/{payRunId}/replacement", "post"],
    ["/api/v1/payroll/pay-runs/{payRunId}/export", "get"],
  ];
  for (const [path, method] of operations) {
    const templateVariables = [...path.matchAll(/\{([^}]+)\}/g)].map((match) => match[1]).sort();
    const pathParameters = (spec.paths[path][method].parameters ?? [])
      .filter((parameter: any) => parameter.in === "path" && parameter.required === true)
      .map((parameter: any) => parameter.name)
      .sort();
    assert.deepEqual(pathParameters, templateVariables, `${method.toUpperCase()} ${path}`);
  }
  assert.deepEqual(spec.paths["/api/v1/payroll/pay-runs/{payRunId}/results/{participantId}"].get.parameters.map((parameter: any) => parameter.name), ["payRunId", "participantId"]);
  for (const path of ["/api/v1/payroll/pay-runs/{payRunId}/approve", "/api/v1/payroll/pay-runs/{payRunId}/reject", "/api/v1/payroll/pay-runs/{payRunId}/replacement"]) {
    assert.deepEqual(spec.paths[path].post.parameters.map((parameter: any) => parameter.name), ["payRunId"]);
  }
});

test("Accounting create contracts publish runtime-valid bodies and the invoice catalogue dependency", () => {
  const paths = (openApiSpec as any).paths;
  const catalogue = paths["/api/v1/accounting/items-services"].post;
  const project = paths["/api/v1/accounting/projects"].post;
  const invoice = paths["/api/v1/accounting/invoices"].post;

  for (const operation of [catalogue, project, invoice]) {
    assert.equal(operation.requestBody.required, true);
    assert.ok(operation.requestBody.content["application/json"].schema);
    assert.ok(operation.requestBody.content["application/json"].schema.example);
  }

  assert.deepEqual(catalogue.requestBody.content["application/json"].schema.required, ["name", "type", "unitPrice", "unit"]);
  assert.match(catalogue.responses["201"].content["application/json"].example.data.id, /^cm1catalogueitem$/);
  assert.deepEqual(project.requestBody.content["application/json"].schema.required, ["name", "clientId", "value", "startDate"]);

  const invoiceLine = invoice.requestBody.content["application/json"].schema.properties.items.items;
  assert.deepEqual(invoiceLine.required, ["quantity"]);
  assert.deepEqual(invoiceLine.oneOf, [{ required: ["catalogueItemId"] }, { required: ["description", "unitPrice"] }]);
  assert.match(invoiceLine.properties.catalogueItemId.description, /POST\/GET items-services/);
});

test("Payment Request creation and approval publish the exact runtime bodies", () => {
  const paths = (openApiSpec as any).paths;
  const create = paths["/api/v1/accounting/payment-requests"].post;
  const approve = paths["/api/v1/accounting/payment-requests/{id}/approve"].post;
  const createJson = create.requestBody.content["application/json"];
  const approveJson = approve.requestBody.content["application/json"];

  assert.equal(create.requestBody.required, true);
  assert.equal(createJson.schema.additionalProperties, false);
  assert.deepEqual(createJson.schema.required, ["title", "amount"]);
  assert.deepEqual(Object.keys(createJson.example).sort(), ["amount", "description", "title"]);
  assert.equal(createJson.schema.properties.amount.oneOf[0].pattern, "^\\d+(\\.\\d{1,2})?$");
  for (const serverOwned of ["organizationId", "bankName", "bankCode", "accountNumber", "accountName", "status"])
    assert.equal(createJson.schema.properties[serverOwned], undefined);

  assert.equal(approve.requestBody.required, true);
  assert.equal(approveJson.schema.additionalProperties, false);
  assert.equal(approveJson.schema.maxProperties, 0);
  assert.deepEqual(approveJson.example, {});
});

test("TEST_E2E and zero-balance wallet operations publish guarded contracts", () => {
  const paths = (openApiSpec as any).paths;
  const classification = paths["/api/v1/platform-admin/test-infrastructure/tenants/{tenantId}/classification"].patch;
  const entitlement = paths["/api/v1/platform-admin/test-infrastructure/tenants/{tenantId}/entitlements/{module}"].put;
  const credit = paths["/api/v1/platform-admin/test-infrastructure/tenants/{tenantId}/wallet-credits"].post;
  const wallet = paths["/api/v1/accounting/wallet/accounts"].post;
  for (const operation of [classification, entitlement, credit, wallet]) assert.equal(operation.requestBody.required, true);
  assert.match(entitlement.description, /without creating an ACTIVE subscription/);
  assert.match(credit.description, /neither manual external funding nor Paystack funding/);
  assert.equal(wallet.requestBody.content["application/json"].schema.properties.balance, undefined);
  assert.equal(wallet.requestBody.content["application/json"].schema.properties.reservedBalance, undefined);
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

test("mutation contracts provide usable request and success response examples", () => {
  const paths = (openApiSpec as any).paths;
  for (const [path, pathItem] of Object.entries<any>(paths)) {
    for (const method of ["post", "put", "patch", "delete"]) {
      const operation = pathItem[method];
      if (!operation) continue;
      const request = operation.requestBody?.content?.["application/json"];
      if (request) {
        assert.notEqual(request.example, undefined, `${method.toUpperCase()} ${path} must publish a JSON request example`);
        assert.doesNotMatch(JSON.stringify(request.example), /:"string"/i, `${method.toUpperCase()} ${path} still contains an unusable Swagger string placeholder`);
      }
      const success = Object.entries<any>(operation.responses ?? {}).find(([status]) => /^2\d\d$/.test(status) && status !== "204")?.[1];
      if (!success) continue;
      const json = success.content?.["application/json"];
      assert.ok(json?.example !== undefined || json?.examples, `${method.toUpperCase()} ${path} must publish a JSON success response example`);
    }
  }
});

test("appraisal cycle examples follow the documented date and workflow rules", () => {
  const operation = (openApiSpec as any).paths["/api/v1/hris/appraisals/cycles"].post;
  const request = operation.requestBody.content["application/json"].example;
  assert.equal(request.launchMode, "SAVE_AS_DRAFT");
  assert.ok(request.templateId.startsWith("template_"));
  assert.ok(new Date(request.periodFrom) < new Date(request.periodTo));
  assert.ok(new Date(request.periodTo) < new Date(request.submissionDeadline));
  const response = operation.responses["201"].content["application/json"].example;
  assert.equal(response.success, true);
  assert.equal(response.data.status, "DRAFT");
  assert.equal(response.data.cycleName, request.cycleName);
});

test("appraisal UI routes publish role, filter, detail, and employee action contracts", () => {
  const paths = (openApiSpec as any).paths;
  const list = paths["/api/v1/hris/appraisals"].get;
  for (const parameter of ["page", "limit", "search", "cycleId", "departmentId", "quarter", "year", "status"]) assert.ok(list.parameters.some((item: any) => item.name === parameter), `missing appraisal filter ${parameter}`);
  for (const path of ["/api/v1/hris/appraisals/{appraisalId}", "/api/v1/employee/appraisal/{appraisalId}", "/api/v1/employee/appraisal/history/{appraisalId}"]) {
    const response = paths[path].get.responses["200"].content["application/json"];
    assert.ok(response.schema, `${path} detail response schema missing`);
    assert.equal(response.example.data.cycle.name, "Q4 2026 Performance Review");
    assert.ok(response.example.data.ratingScale.length > 0);
    assert.ok(response.example.data.workflowHistory.length > 0);
  }
  assert.ok(paths["/api/v1/employee/appraisal/{appraisalId}/goals"].post.requestBody.content["application/json"].example.title);
  assert.equal(paths["/api/v1/employee/appraisal/{appraisalId}/goals/confirm"].post.requestBody, undefined);
  assert.equal(paths["/api/v1/employee/appraisal/{appraisalId}/self-assessment/draft"].put.requestBody.content["application/json"].example.sections[0].objectives[0].keyResults[0].achieved, undefined);
  assert.equal(paths["/api/v1/employee/appraisal/{appraisalId}/self-assessment/submit"].post.responses["200"].content["application/json"].example.data.status, "SUBMITTED");
  assert.equal(paths["/api/v1/employee/appraisal/{appraisalId}/acknowledge"].post.responses["200"].content["application/json"].example.data.stage, "COMPLETED");
});

test("Paystack settlement OTP finalization is documented as a sensitive non-conclusive operation", () => {
  const operation = (openApiSpec as any).paths["/api/v1/accounting/financial-settlements/{id}/finalize-otp"].post;
  assert.deepEqual(operation.security, [{ bearerAuth: [] }]);
  const schema = operation.requestBody.content["application/json"].schema;
  assert.deepEqual(schema.required, ["otp"]);
  assert.deepEqual(Object.keys(schema.properties), ["otp"]);
  assert.equal(schema.properties.otp.writeOnly, true);
  assert.match(operation.description, /never persisted or logged/i);
  assert.match(operation.responses["200"].description, /does not mean.*paid/i);
});

test("Notifications and Alerts examples match their runtime field types", () => {
  const paths = (openApiSpec as any).paths;
  const preference = paths["/api/v1/admin/notifications-alerts/preferences/{channelKey}"].get;
  assert.deepEqual(preference.parameters.find((item: any) => item.name === "channelKey").schema.enum, ["IN_APP", "EMAIL"]);
  const example = preference.responses["200"].content["application/json"].example;
  assert.equal(example.data.channel.name, "In-App Notifications");
  assert.equal(typeof example.data.modules[0].entitled, "boolean");
  assert.equal(typeof example.data.modules[0].controlsEnabled, "boolean");
  assert.equal(typeof example.data.modules[0].notifications[0].enabled, "boolean");
  assert.doesNotMatch(JSON.stringify(example), /Q4 2026 Performance Review/);
  const overview = paths["/api/v1/admin/notifications-alerts/overview"].get.responses["200"].content["application/json"].example;
  assert.equal(typeof overview.data.unreadAnnouncementCount, "number");
  assert.doesNotMatch(JSON.stringify(overview), /Q4 2026 Performance Review/);
});

test("generated examples do not leak appraisal copy or generic placeholders across modules", () => {
  const paths = (openApiSpec as any).paths;
  const nonAppraisalOperations = Object.fromEntries(Object.entries(paths).filter(([path]) => !path.includes("appraisal")));
  assert.doesNotMatch(JSON.stringify(nonAppraisalOperations), /Q4 2026 Performance Review|Quarterly business performance review|Performance is on track against the agreed objectives\.|Sample value/);
  assert.doesNotMatch(JSON.stringify(paths), /Sample value/);

  const payee = paths["/api/v1/payroll/payees"].post.requestBody.content["application/json"].example;
  assert.equal(typeof payee.accountNumber, "string");
  assert.equal(typeof payee.accountName, "string");
  const organization = paths["/api/v1/admin/organization"].patch.requestBody.content["application/json"].example;
  assert.equal(organization.country, "NG");
  const payment = paths["/api/v1/accounting/invoices/{id}/payment"].post.requestBody.content["application/json"].example;
  assert.equal(typeof payment.amount, "string");
});

test("R4 Payroll dashboard and summary publish mixed frozen-result semantics", () => {
  const schemas = (openApiSpec as any).components.schemas;
  const dashboard = (openApiSpec as any).paths["/api/v1/payroll/dashboard"].get;
  const summary = (openApiSpec as any).paths["/api/v1/payroll/reports/summary"].get;
  const reportExport = (openApiSpec as any).paths["/api/v1/payroll/reports/{report}/export"].get;
  for (const field of ["participants", "permanentEmployees", "externalPayees", "permanentNetPay", "externalNetPay", "paye", "wht"]) assert.ok(schemas.PayrollMixedOverviewTotals.properties[field], `missing mixed overview field ${field}`);
  for (const field of ["participantCount", "permanentEmployeeCount", "externalPayeeCount", "cashGross", "netPay"]) assert.ok(schemas.PayrollPayeeGroupDistributionItem.properties[field], `missing group distribution field ${field}`);
  assert.match(dashboard.description, /Payslip.*PayeePayment/);
  assert.match(dashboard.description, /REJECTED_FOR_REWORK never inflate/);
  assert.match(dashboard.description, /PAYE is Permanent-only, WHT is Contract-only/);
  assert.deepEqual(summary.parameters.map((item: any) => item.name), ["year", "period"]);
  assert.equal(summary.responses["200"].content["application/json"].schema.$ref, "#/components/schemas/PayrollReportSummaryResponse");
  assert.match(summary.description, /Rejected and pre-approval revisions are excluded/);
  assert.match(reportExport.description, /synchronous mixed CSV/);
  assert.match(reportExport.description, /formula-injection protection/);
  assert.deepEqual(reportExport.parameters[0].schema.enum, ["summary", "department", "variance", "bank", "ytd"]);
});

test("R4 specialized Payroll reports explicitly preserve Permanent-only semantics", () => {
  const paths = (openApiSpec as any).paths;
  for (const path of ["/api/v1/payroll/reports/department-cost", "/api/v1/payroll/reports/monthly-variance", "/api/v1/payroll/reports/bank-payment-schedule", "/api/v1/payroll/reports/ytd-earnings"]) assert.match(paths[path].get.description, /Permanent/);
});

test("R5 Swagger exposes Active/Inactive lifecycle and excludes obsolete Pending/invite semantics", () => {
  const paths = (openApiSpec as any).paths;
  const schemas = (openApiSpec as any).components.schemas;
  const list = paths["/api/v1/payroll/payees"].get;
  const lifecycle = list.parameters.find((item: any) => item.name === "lifecycleStatus");
  assert.equal(lifecycle.schema.$ref, "#/components/schemas/PayrollPayeeLifecycleStatus");
  assert.deepEqual(schemas.PayrollPayeeLifecycleStatus.enum, ["ACTIVE", "INACTIVE"]);
  assert.ok(schemas.PayrollPayee.properties.payrollLifecycleStatus);
  assert.match(list.description, /no PENDING Payee lifecycle/i);
  assert.match(list.description, /PayrollEnrollment/);
  const toggle = paths["/api/v1/payroll/payees/{payeeId}/toggle-payroll"].patch;
  assert.match(toggle.description, /ON_LEAVE, SUSPENDED, TERMINATED or EXITED/);
  assert.match(toggle.description, /atomically sets raw ACTIVE/);
  const remove = paths["/api/v1/payroll/payees/{payeeId}"].delete;
  assert.match(remove.description, /Archive is not client lifecycle INACTIVE/);
  assert.doesNotMatch(JSON.stringify({ list, toggle, remove }), /Payee (dashboard|self-signup|self-onboarding)/i);
});
