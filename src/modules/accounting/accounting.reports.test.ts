import assert from "node:assert/strict";
import test from "node:test";
import { Prisma } from "@prisma/client";
import { openApiSpec } from "../../config/swagger";
import { prisma } from "../../core/prisma";
import { createPayslipPdf } from "../employee/employee.service";
import { buildAccountingReportCsv, buildAccountingReportPdfLines, reportInvoiceWhere, reportRows, resolveAccountingReportPdfContext } from "./accounting.service";
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

const summary = {
  totalRevenue: 750,
  outstanding: 250,
  overdue: 100,
  vatCollected: 50,
  totalExpenses: 200,
  netProfit: 550,
};

const reportRow = (invoiceNo = "INV-001", clientName = "Acme Limited") => ({
  id: invoiceNo,
  invoiceNo,
  status: "PARTIALLY_PAID",
  issueDate: new Date("2026-09-01T00:00:00.000Z"),
  dueDate: new Date("2026-09-30T00:00:00.000Z"),
  subtotal: new Prisma.Decimal(900),
  taxAmount: new Prisma.Decimal(100),
  total: new Prisma.Decimal(1000),
  whtApplicable: true,
  whtRate: new Prisma.Decimal("0.05"),
  whtAmount: new Prisma.Decimal(45),
  amountPayable: new Prisma.Decimal(955),
  client: { id: "client-1", name: clientName },
  assignedAgent: { id: "user-1", firstName: "Amina", lastName: "Yusuf" },
  project: { id: "project-1", name: "Implementation" },
  payments: [{ amount: new Prisma.Decimal(705) }],
  items: [],
});

test("Accounting report CSV keeps stable headers, canonical values, UTF-8 BOM, and formula protection", () => {
  const csv = buildAccountingReportCsv([reportRow("=SUM(A1:A2)", "+Unsafe Client")], summary);
  assert.ok(csv.startsWith("\uFEFF\"Invoice\",\"Client\",\"Agent\",\"Project\",\"Subtotal\",\"VAT\",\"Total\""));
  assert.match(csv, /"'=SUM\(A1:A2\)"/);
  assert.match(csv, /"'\+Unsafe Client"/);
  assert.match(csv, /"705"/);
  assert.match(csv, /"250"/);
  assert.match(csv, /\r\n/);
  assert.match(csv, /"Net Profit","550"/);
});

test("Accounting report row export ignores visible page and loads the complete filtered scope in batches", async () => {
  const original = prisma.invoice.findMany;
  const calls: any[] = [];
  (prisma.invoice as any).findMany = async (args: any) => {
    calls.push(args);
    return calls.length === 1
      ? Array.from({ length: 250 }, (_, index) => ({ id: `invoice-${index}` }))
      : [{ id: "invoice-250" }];
  };
  try {
    const rows = await reportRows("tenant-1", parse({ page: 9, limit: 1, clientId: "client-1" }));
    assert.equal(rows.length, 251);
    assert.equal(calls.length, 2);
    assert.equal(calls[0].take, 250);
    assert.equal(calls[0].skip, undefined);
    assert.equal(calls[1].cursor.id, "invoice-249");
    assert.equal(calls[0].where.organizationId, "tenant-1");
    assert.equal(calls[0].where.clientId, "client-1");
  } finally {
    (prisma.invoice as any).findMany = original;
  }
});

test("Accounting report PDF context resolves names only through tenant-scoped lookups", async () => {
  const delegates = [prisma.organization, prisma.client, prisma.user, prisma.accountingProject, prisma.accountingCatalogueItem] as any[];
  const originals = delegates.map((delegate, index) => delegate[index === 0 ? "findUnique" : "findFirst"]);
  const scopes: any[] = [];
  (prisma.organization as any).findUnique = async (args: any) => { scopes.push(args.where); return { name: "Sinkronis Demo", currency: "NGN" }; };
  (prisma.client as any).findFirst = async (args: any) => { scopes.push(args.where); return { name: "Acme Limited" }; };
  (prisma.user as any).findFirst = async (args: any) => { scopes.push(args.where); return { firstName: "Amina", lastName: "Yusuf" }; };
  (prisma.accountingProject as any).findFirst = async (args: any) => { scopes.push(args.where); return { name: "Implementation" }; };
  (prisma.accountingCatalogueItem as any).findFirst = async (args: any) => { scopes.push(args.where); return { name: "Consulting" }; };
  try {
    const context = await resolveAccountingReportPdfContext("tenant-1", parse({ clientId: "client-1", agentId: "user-1", projectId: "project-1", itemServiceId: "item-1", status: "PAID", fromDate: "2026-09-01", toDate: "2026-09-30", search: "INV" }));
    assert.equal(context.organizationName, "Sinkronis Demo");
    assert.deepEqual(context.filters, ["Client: Acme Limited", "Agent: Amina Yusuf", "Project: Implementation", "Item/Service: Consulting", "Status: PAID", "Date range: 2026-09-01 to 2026-09-30", "Search: INV"]);
    assert.deepEqual(scopes[0], { id: "tenant-1" });
    for (const scope of scopes.slice(1)) assert.equal(scope.organizationId, "tenant-1");
  } finally {
    (prisma.organization as any).findUnique = originals[0];
    (prisma.client as any).findFirst = originals[1];
    (prisma.user as any).findFirst = originals[2];
    (prisma.accountingProject as any).findFirst = originals[3];
    (prisma.accountingCatalogueItem as any).findFirst = originals[4];
  }
});

test("Accounting report PDF presents canonical summary, drill-in context, and invoice financial detail", () => {
  const generatedAt = new Date("2026-09-28T12:00:00.000Z");
  const lines = buildAccountingReportPdfLines(
    { organizationName: "Sinkronis Demo", currency: "NGN", filters: ["Client: Acme Limited", "Agent: Amina Yusuf", "Project: Implementation"] },
    summary,
    Array.from({ length: 5 }, (_, index) => reportRow(`INV-${index + 1}`)),
    generatedAt,
  );
  assert.ok(lines.includes("Total revenue: NGN 750.00"));
  assert.ok(lines.includes("Net profit: NGN 550.00"));
  assert.ok(lines.includes("Client: Acme Limited"));
  assert.ok(lines.includes("Agent: Amina Yusuf"));
  assert.ok(lines.includes("Project: Implementation"));
  assert.ok(lines.includes("WHT: NGN 45.00 | Payable: NGN 955.00 | Paid: NGN 705.00"));
  assert.ok(lines.includes("Outstanding: NGN 250.00"));
  const pdf = createPayslipPdf(lines).toString("latin1");
  assert.match(pdf, /^%PDF-1\.4/);
  assert.match(pdf, /\/Count [2-9]/);
});

test("Accounting report PDF makes UNASSIGNED drill-in context human-readable", async () => {
  const original = prisma.organization.findUnique;
  (prisma.organization as any).findUnique = async () => ({ name: "Sinkronis Demo", currency: "NGN" });
  try {
    const context = await resolveAccountingReportPdfContext("tenant-1", parse({ agentId: "UNASSIGNED", projectId: "UNASSIGNED" }));
    assert.deepEqual(context.filters, ["Agent: Unassigned", "Project: Unassigned"]);
  } finally {
    (prisma.organization as any).findUnique = original;
  }
});

test("Accounting report export Swagger documents full filters, complete rows, attachments, and PDF mapping", () => {
  for (const extension of ["csv", "pdf"] as const) {
    const operation = (openApiSpec as any).paths[`/api/v1/accounting/reports/export.${extension}`].get;
    assert.deepEqual(operation.parameters.map((parameter: any) => parameter.name), ["search", "clientId", "agentId", "projectId", "itemServiceId", "status", "fromDate", "toDate", "groupBy", "page", "limit", "sortBy", "sortOrder"]);
    assert.match(operation.description, /All matching invoices|complete filtered invoice set/);
    assert.match(operation.description, /page and limit/);
    assert.match(operation.description, /groupBy/);
    assert.ok(operation.responses["200"].headers["Content-Disposition"]);
    assert.ok(operation.responses["401"]);
    assert.ok(operation.responses["403"]);
  }
  assert.match((openApiSpec as any).paths["/api/v1/accounting/reports/export.pdf"].get.description, /Download Report and Download PDF/);
});
