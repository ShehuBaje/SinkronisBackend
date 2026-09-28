import assert from "node:assert/strict";
import test from "node:test";
import { openApiSpec } from "../../config/swagger";
import { reportInvoiceWhere } from "./accounting.service";
import { accountingReportQuerySchema } from "./accounting.validation";

const parse = (query: Record<string, unknown>) => accountingReportQuerySchema.parse(query);

test("Accounting Reports query exposes the approved defaults, pagination, and sorting", () => {
  const query = parse({});
  assert.deepEqual(query, { status: "ALL", page: 1, limit: 20, sortBy: "createdAt", sortOrder: "desc" });
  assert.equal(accountingReportQuerySchema.safeParse({ page: 0 }).success, false);
  assert.equal(accountingReportQuerySchema.safeParse({ limit: 101 }).success, false);
  assert.equal(accountingReportQuerySchema.safeParse({ sortBy: "client" }).success, false);
  assert.equal(accountingReportQuerySchema.safeParse({ sortOrder: "newest" }).success, false);
});

test("Accounting Reports accepts only the approved Client, Agent, and Project groupings", () => {
  for (const groupBy of ["CLIENT", "AGENT", "PROJECT"] as const) assert.equal(parse({ groupBy }).groupBy, groupBy);
  for (const groupBy of ["ITEM", "STATUS", "DATE", "client"]) assert.equal(accountingReportQuerySchema.safeParse({ groupBy }).success, false);
});

test("Accounting Reports rejects unknown query parameters", () => {
  assert.equal(accountingReportQuerySchema.safeParse({ dateFrom: "2026-09-01" }).success, false);
  assert.equal(accountingReportQuerySchema.safeParse({ itemId: "item-1" }).success, false);
  assert.equal(accountingReportQuerySchema.safeParse({ tenantId: "other-tenant" }).success, false);
});

test("Accounting Reports normalizes UTC calendar-date bounds inclusively and preserves timestamps", () => {
  const calendar = parse({ fromDate: "2026-09-28", toDate: "2026-09-28" });
  assert.equal(calendar.fromDate?.toISOString(), "2026-09-28T00:00:00.000Z");
  assert.equal(calendar.toDate?.toISOString(), "2026-09-28T23:59:59.999Z");
  const timestamps = parse({ fromDate: "2026-09-28T08:15:00.000Z", toDate: "2026-09-28T16:45:00.000Z" });
  assert.equal(timestamps.fromDate?.toISOString(), "2026-09-28T08:15:00.000Z");
  assert.equal(timestamps.toDate?.toISOString(), "2026-09-28T16:45:00.000Z");
  assert.equal(accountingReportQuerySchema.safeParse({ fromDate: "2026-02-30" }).success, false);
  assert.equal(accountingReportQuerySchema.safeParse({ fromDate: "2026-09-29", toDate: "2026-09-28" }).success, false);
});

test("Accounting Reports combines Client, Agent, Item, Project, Status, and date filters", () => {
  const query = parse({
    clientId: "client-1", agentId: "user-1", itemServiceId: "item-1", projectId: "project-1",
    status: "PAID", fromDate: "2026-09-01", toDate: "2026-09-30", page: "2", limit: "50",
    sortBy: "total", sortOrder: "asc",
  });
  const where = reportInvoiceWhere("tenant-1", query);
  assert.equal(where.organizationId, "tenant-1");
  assert.equal(where.clientId, "client-1");
  assert.equal(where.assignedAgentId, "user-1");
  assert.equal(where.projectId, "project-1");
  assert.deepEqual(where.items, { some: { catalogueItemId: "item-1" } });
  assert.equal(where.status, "PAID");
  assert.deepEqual(where.issueDate, { gte: query.fromDate, lte: query.toDate });
  assert.equal(query.page, 2);
  assert.equal(query.limit, 50);
  assert.equal(query.sortBy, "total");
  assert.equal(query.sortOrder, "asc");
});

test("Accounting Reports applies OVERDUE to unpaid due invoices", () => {
  const where = reportInvoiceWhere("tenant-1", parse({ status: "OVERDUE" }));
  assert.deepEqual((where.status as { in: string[] }).in, ["SENT", "PARTIALLY_PAID", "OVERDUE"]);
  assert.ok((where.dueDate as { lt: Date }).lt instanceof Date);
});

test("Accounting Reports makes returned unassigned Agent and Project groups drillable", () => {
  assert.equal(reportInvoiceWhere("tenant-1", parse({ agentId: "UNASSIGNED" })).assignedAgentId, null);
  assert.equal(reportInvoiceWhere("tenant-1", parse({ projectId: "UNASSIGNED" })).projectId, null);
});

test("Accounting Reports Swagger publishes the complete approved filter, drill, and response contract", () => {
  const operation = (openApiSpec as any).paths["/api/v1/accounting/reports"].get;
  const parameters = new Map<string, any>(operation.parameters.map((parameter: any) => [parameter.name, parameter]));
  assert.deepEqual([...parameters.keys()], ["search", "clientId", "agentId", "projectId", "itemServiceId", "status", "fromDate", "toDate", "groupBy", "page", "limit", "sortBy", "sortOrder"]);
  assert.deepEqual(parameters.get("groupBy").schema.enum, ["CLIENT", "AGENT", "PROJECT"]);
  assert.deepEqual(parameters.get("status").schema.enum, ["ALL", "DRAFT", "SENT", "PARTIALLY_PAID", "PAID", "OVERDUE", "VOID"]);
  assert.equal(parameters.get("page").schema.default, 1);
  assert.equal(parameters.get("limit").schema.maximum, 100);
  assert.match(parameters.get("agentId").description, /User\.id/);
  assert.match(parameters.get("itemServiceId").description, /catalogue item\/service ID/);
  assert.match(parameters.get("fromDate").description, /Invoice\.issueDate/);
  const data = operation.responses["200"].content["application/json"].schema.properties.data;
  assert.ok(data.properties.appliedFilters);
  assert.ok(data.properties.summary);
  assert.ok(data.properties.groups);
  assert.ok(data.properties.invoices);
  assert.ok(data.properties.pagination);
  assert.deepEqual(data.properties.groups.items.required, ["id", "name", "invoiceCount", "invoiceValue", "revenuePaid", "outstanding", "vatCharged"]);
});
